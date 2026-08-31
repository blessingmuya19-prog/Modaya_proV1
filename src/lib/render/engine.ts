/**
 * Preview engine — canvas compositor + transport.
 *
 * What a bare <video> could not do, and this does:
 *   • plays a *sequence*, skipping cut sections instead of the raw file
 *   • composites: fit/scale/offset, colour effects, text overlays, background
 *   • double-buffers the source so a clip boundary doesn't stall on a seek
 *   • frame-accurate scrubbing — a seek paints one composited frame
 *   • one clock only: the media element drives time while it plays, so the
 *     renderer never fights the decoder (that was the old stutter)
 *   • exposes a canvas stream, so export can record exactly what you see
 */
import {
  Sequence, SequenceClip,
  videoClipAt, overlaysAt, sourceTimeFor, resolveGap, nextBoundary,
  fitRect, filterFor,
} from './sequence';

export interface EngineStats {
  drawn:      number;
  dropped:    number;
  decoded:    number;
  activeClip: string | null;
  buffering:  boolean;
}

type TimeListener  = (t: number) => void;
type StateListener = (playing: boolean) => void;

const SEEK_EPSILON = 0.04;   // ~1 frame at 25fps

export class PreviewEngine {
  private canvas:  HTMLCanvasElement | null = null;
  private ctx:     CanvasRenderingContext2D | null = null;
  private seq:     Sequence | null = null;
  private sources = new Map<string, string>();     // sourceId → object URL

  /** Two elements per source: one on screen, one pre-rolling the next clip. */
  private pool: HTMLVideoElement[] = [];
  private active = 0;

  private _time     = 0;
  private _playing  = false;
  private raf       = 0;
  private destroyed = false;
  private currentClipId: string | null = null;

  private timeListeners  = new Set<TimeListener>();
  private stateListeners = new Set<StateListener>();

  stats: EngineStats = { drawn: 0, dropped: 0, decoded: 0, activeClip: null, buffering: false };

  /* ─────────── wiring ─────────── */

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d', { alpha: false });
    this.ensurePool();
    this.renderFrame();
  }

  /** Host element the (hidden) media elements live in — keeps autoplay policy
   *  and the debug overlay happy. */
  mount(host: HTMLElement) {
    this.ensurePool();
    for (const v of this.pool) {
      if (!v.parentNode) host.appendChild(v);
    }
  }

  setSequence(seq: Sequence) {
    this.seq = seq;
    if (this.canvas) {
      // Render at the sequence resolution, capped so preview stays cheap
      const cap   = 1280;
      const scale = Math.min(1, cap / Math.max(seq.width, seq.height));
      this.canvas.width  = Math.max(2, Math.round(seq.width  * scale));
      this.canvas.height = Math.max(2, Math.round(seq.height * scale));
    }
    this.syncSource(true);
    this.renderFrame();
  }

  setSource(sourceId: string, url: string) {
    if (this.sources.get(sourceId) === url) return;
    this.sources.set(sourceId, url);
    this.syncSource(true);
    this.renderFrame();
  }

  private ensurePool() {
    if (this.pool.length) return;
    this.pool = [0, 1].map(() => {
      const v = document.createElement('video');
      v.playsInline  = true;
      v.preload      = 'auto';
      v.crossOrigin  = 'anonymous';
      v.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
      return v;
    });
  }

  private el(i = this.active): HTMLVideoElement {
    this.ensurePool();
    return this.pool[i];
  }

  private other(): HTMLVideoElement { return this.el(this.active === 0 ? 1 : 0); }

  /* ─────────── transport ─────────── */

  get time()    { return this._time; }
  get playing() { return this._playing; }

  onTime (fn: TimeListener)  { this.timeListeners.add(fn);  return () => this.timeListeners.delete(fn); }
  onState(fn: StateListener) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }

  private emitTime() { this.timeListeners.forEach(fn => { try { fn(this._time); } catch {} }); }

  async play() {
    if (this._playing || !this.seq) return;
    this._playing = true;
    this.stateListeners.forEach(fn => fn(true));

    // Starting inside a cut section? Jump to the next real clip first.
    const gap = resolveGap(this.seq, this._time);
    if (gap.inGap) {
      if (gap.jumpTo == null) { this.pause(); return; }
      this.seek(gap.jumpTo);
    }

    this.syncSource(false);
    try { await this.el().play(); } catch { /* autoplay blocked — stay paused visually */ }
    this.loop();
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    this.pool.forEach(v => { try { v.pause(); } catch {} });
    cancelAnimationFrame(this.raf);
    this.stateListeners.forEach(fn => fn(false));
    this.renderFrame();
  }

  /** Move the playhead. Repaints one composited frame even while paused. */
  seek(t: number) {
    if (!this.seq) { this._time = Math.max(0, t); return; }
    const clamped = Math.max(0, Math.min(this.seq.durationS, t));
    this._time = clamped;
    this.syncSource(false);

    const clip = videoClipAt(this.seq, clamped);
    const v    = this.el();
    if (clip && v.src) {
      const want = sourceTimeFor(clip, clamped);
      if (Math.abs(v.currentTime - want) > SEEK_EPSILON) {
        try { v.currentTime = want; } catch {}
      }
    }
    this.renderFrame();
  }

  /* ─────────── source management ─────────── */

  /** Point the active element at the clip under the playhead, and pre-roll the
   *  next clip on the spare element so the cut doesn't stall. */
  private syncSource(force: boolean) {
    if (!this.seq) return;
    const clip = videoClipAt(this.seq, this._time);
    if (!clip) return;

    const url = this.sources.get(clip.sourceId);
    if (!url) return;

    const v = this.el();
    if (force || v.src !== url) {
      if (v.src !== url) { v.src = url; try { v.load(); } catch {} }
    }
    v.muted = clip.muted;

    if (this.currentClipId !== clip.id) {
      this.currentClipId    = clip.id;
      this.stats.activeClip = clip.id;
      const want = sourceTimeFor(clip, this._time);
      if (Math.abs(v.currentTime - want) > SEEK_EPSILON) {
        try { v.currentTime = want; } catch {}
      }
    }

    // Pre-roll whatever comes after this clip
    const edge = nextBoundary(this.seq, this._time);
    if (edge != null && edge - this._time < 2) {
      const upcoming = videoClipAt(this.seq, edge + 0.001);
      if (upcoming && upcoming.id !== clip.id) {
        const nextUrl = this.sources.get(upcoming.sourceId);
        const spare   = this.other();
        if (nextUrl) {
          if (spare.src !== nextUrl) { spare.src = nextUrl; try { spare.load(); } catch {} }
          spare.muted = true;
          const want = sourceTimeFor(upcoming, edge);
          if (Math.abs(spare.currentTime - want) > 0.2) {
            try { spare.currentTime = want; } catch {}
          }
        }
      }
    }
  }

  /* ─────────── playback loop ─────────── */

  private loop = () => {
    if (this.destroyed || !this._playing || !this.seq) return;

    const clip = videoClipAt(this.seq, this._time);
    const v    = this.el();

    if (clip) {
      // The element owns the clock while it is running — we only read it.
      const srcT = v.currentTime;
      const tlT  = clip.timelineIn + (srcT - clip.sourceIn);

      if (tlT >= clip.timelineOut - 0.001) {
        // Clip finished — hand over to the pre-rolled element
        this.advancePastClip(clip);
      } else {
        this._time = tlT;
        this.emitTime();
      }
      this.stats.buffering = v.readyState < 3;
    } else {
      const gap = resolveGap(this.seq, this._time);
      if (gap.jumpTo == null) { this.pause(); this.emitTime(); return; }
      this.seek(gap.jumpTo);
      void this.el().play().catch(() => {});
    }

    this.renderFrame();
    this.raf = requestAnimationFrame(this.loop);
  };

  private advancePastClip(clip: SequenceClip) {
    if (!this.seq) return;
    const t    = clip.timelineOut + 0.001;
    const next = videoClipAt(this.seq, t);

    if (!next) {
      const gap = resolveGap(this.seq, t);
      if (gap.jumpTo == null) {           // end of programme
        this._time = this.seq.durationS;
        this.emitTime();
        this.pause();
        return;
      }
      this.seek(gap.jumpTo);
      void this.el().play().catch(() => {});
      return;
    }

    // Swap to the spare element, which has already been seeked to this point
    const spare   = this.other();
    const nextUrl = this.sources.get(next.sourceId);
    if (nextUrl && spare.src === nextUrl) {
      const outgoing = this.el();
      this.active = this.active === 0 ? 1 : 0;
      try { outgoing.pause(); } catch {}
      spare.muted = next.muted;
      void spare.play().catch(() => {});
    }

    this._time         = next.timelineIn;
    this.currentClipId = null;    // force a re-sync onto the new clip
    this.syncSource(false);
    this.emitTime();
  }

  /* ─────────── compositor ─────────── */

  renderFrame() {
    const ctx = this.ctx, canvas = this.canvas, seq = this.seq;
    if (!ctx || !canvas || !seq) return;

    const W = canvas.width, H = canvas.height;

    ctx.save();
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const clip = videoClipAt(seq, this._time);
    if (clip) {
      const v = this.el();
      const w = v.videoWidth, h = v.videoHeight;
      if (w && h && v.readyState >= 2) {
        const r = fitRect(w, h, W, H, clip.transform);
        ctx.filter      = filterFor(clip.effects);
        ctx.globalAlpha = clip.effects.opacity;
        try { ctx.drawImage(v, r.x, r.y, r.w, r.h); this.stats.drawn++; } catch {}
        ctx.filter      = 'none';
        ctx.globalAlpha = 1;
      }
    }

    for (const ov of overlaysAt(seq, this._time)) this.drawText(ctx, ov, W, H);

    ctx.restore();

    try {
      const q = (this.el() as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number };
      }).getVideoPlaybackQuality?.();
      if (q) { this.stats.dropped = q.droppedVideoFrames; this.stats.decoded = q.totalVideoFrames; }
    } catch { /* not supported */ }
  }

  private drawText(ctx: CanvasRenderingContext2D, clip: SequenceClip, W: number, H: number) {
    const text = clip.label ?? '';
    if (!text) return;

    const size = Math.round(H * (clip.kind === 'subtitle' ? 0.045 : 0.06));
    ctx.font         = `700 ${size}px 'Inter Tight', Inter, system-ui, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha  = clip.effects.opacity;

    const y = clip.kind === 'subtitle' ? H - Math.round(H * 0.08) : Math.round(H * 0.5);
    const m = ctx.measureText(text);
    const padX = size * 0.5, padY = size * 0.32;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W / 2 - m.width / 2 - padX, y - size - padY * 0.4,
                 m.width + padX * 2, size + padY * 1.4);

    ctx.fillStyle = '#fff';
    ctx.fillText(text, W / 2, y);
    ctx.globalAlpha = 1;
  }

  /* ─────────── export hook ─────────── */

  /** Live stream of exactly what the preview shows — for MediaRecorder export. */
  captureStream(fps = 30): MediaStream | null {
    const c = this.canvas as (HTMLCanvasElement & { captureStream?: (f: number) => MediaStream }) | null;
    return c?.captureStream ? c.captureStream(fps) : null;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.pool.forEach(v => {
      try { v.pause(); } catch {}
      v.removeAttribute('src');
      try { v.load(); } catch {}
      v.parentNode?.removeChild(v);
    });
    this.pool = [];
    this.timeListeners.clear();
    this.stateListeners.clear();
  }
}
