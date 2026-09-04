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
  videoClipsAt, baseClipAt, cutawayClipAt, overlaysAt,
  sourceTimeFor, resolveGap, nextBoundary,
  fitRect, filterFor,
} from './sequence';
import { getTrackedPositionAt } from '@/lib/ai/motionTracker';
import { getAutoReframeOffset } from './autoReframe';
import { extractTimedWords, getWordAnimationState } from './captionStyler';

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

/* Fonts the browser already has. Nothing is fetched, so a caption can never
   render in a substitute face while a webfont loads — or fail to change at
   all because the requested font was never available. */
const FONT_STACKS: Record<string, string> = {
  sans:        "'Inter',system-ui,-apple-system,sans-serif",
  serif:       "Georgia, 'Times New Roman', Times, serif",
  mono:        "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  display:     "Impact, Haettenschweiler, 'Arial Black', sans-serif",
  handwritten: "'Segoe Script', 'Bradley Hand', 'Brush Script MT', cursive",
};

/** Break a line at word boundaries so long captions stay inside the frame. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0];

  for (const w of words.slice(1)) {
    const next = `${line} ${w}`;
    if (ctx.measureText(next).width <= maxW) line = next;
    else { lines.push(line); line = w; }
    if (lines.length >= 3) break;              // never more than four lines
  }
  lines.push(line);
  return lines;
}

export class PreviewEngine {
  private canvas:  HTMLCanvasElement | null = null;
  private ctx:     CanvasRenderingContext2D | null = null;
  private seq:     Sequence | null = null;
  private sources = new Map<string, string>();     // sourceId → object URL

  /** Two elements per source: one on screen, one pre-rolling the next clip. */
  private pool: HTMLVideoElement[] = [];
  private active = 0;
  /** One extra element for a B-roll cutaway, drawn on top and muted. */
  private overlayEl: HTMLVideoElement | null = null;
  /** The cutaway currently painted (so we only re-point the element when it changes). */
  private cutawayClip: SequenceClip | null = null;

  private _time     = 0;
  private _playing  = false;
  private raf       = 0;
  private destroyed = false;
  private currentClipId: string | null = null;

  private timeListeners  = new Set<TimeListener>();
  private stateListeners = new Set<StateListener>();
  private endListeners   = new Set<() => void>();

  stats: EngineStats = { drawn: 0, dropped: 0, decoded: 0, activeClip: null, buffering: false };

  /* ─────────── wiring ─────────── */

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d') ?? canvas.getContext('2d', { willReadFrequently: false });
    if (this.ctx) {
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'medium';
    }
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
    if (this.overlayEl && !this.overlayEl.parentNode) host.appendChild(this.overlayEl);
  }

  /**
   * Set the programme. `cap` is the longest edge in pixels the canvas is
   * rendered at. Preview keeps it small (1280) for speed; export passes the
   * target resolution (e.g. 1920/1080) and never upscales beyond the source.
   */
  setSequence(seq: Sequence, cap = 1280) {
    this.seq = seq;
    if (this.canvas) {
      const scale = Math.min(1, cap / Math.max(seq.width, seq.height));
      this.canvas.width  = Math.max(2, Math.round(seq.width  * scale));
      this.canvas.height = Math.max(2, Math.round(seq.height * scale));
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'medium';
      }
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

  private lastEmitMs = 0;

  private ensurePool() {
    if (this.pool.length) return;
    const onReady = () => { if (!this._playing && !this.destroyed) this.renderFrame(); };
    const onBuffer = () => { this.stats.buffering = true; };
    const onResume = () => {
      this.stats.buffering = false;
      if (this._playing && !this.destroyed) this.renderFrame();
    };

    this.pool = [0, 1].map(() => {
      const v = document.createElement('video');
      v.playsInline  = true;
      v.preload      = 'auto';
      v.crossOrigin  = 'anonymous';
      v.setAttribute('playsinline', 'true');
      v.setAttribute('webkit-playsinline', 'true');
      v.setAttribute('disablepictureinpicture', 'true');
      v.setAttribute('disableremoteplayback', 'true');
      v.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
      v.addEventListener('loadeddata', onReady);
      v.addEventListener('seeked', onReady);
      v.addEventListener('waiting', onBuffer);
      v.addEventListener('stalled', onBuffer);
      v.addEventListener('canplay', onResume);
      v.addEventListener('playing', onResume);
      return v;
    });
    if (!this.overlayEl) {
      const ov = document.createElement('video');
      ov.playsInline = true;
      ov.preload     = 'auto';
      ov.crossOrigin = 'anonymous';
      ov.muted       = true;      // a cutaway never carries audio
      ov.setAttribute('playsinline', 'true');
      ov.setAttribute('webkit-playsinline', 'true');
      ov.setAttribute('disablepictureinpicture', 'true');
      ov.setAttribute('disableremoteplayback', 'true');
      ov.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
      ov.addEventListener('loadeddata', onReady);
      ov.addEventListener('seeked', onReady);
      ov.addEventListener('waiting', onBuffer);
      ov.addEventListener('stalled', onBuffer);
      ov.addEventListener('canplay', onResume);
      ov.addEventListener('playing', onResume);
      this.overlayEl = ov;
    }
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
  /**
   * Fired only when playback stops because the programme finished — never on a
   * user pause. The two need different handling: reaching the end rewinds, a
   * pause must stay exactly where it is.
   */
  onEnd(fn: () => void) { this.endListeners.add(fn); return () => this.endListeners.delete(fn); }

  private emitTime(force = false) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && this._playing && now - this.lastEmitMs < 50) {
      return;
    }
    this.lastEmitMs = now;
    this.timeListeners.forEach(fn => { try { fn(this._time); } catch {} });
  }

  /** Stop at the very end of the programme and say so. */
  private finish() {
    if (!this.seq) return;
    this._time = this.seq.durationS;
    this.emitTime(true);
    this.pause();
    this.endListeners.forEach(fn => { try { fn(); } catch {} });
  }

  async play() {
    if (this._playing || !this.seq) return;
    this._playing = true;
    this.stateListeners.forEach(fn => fn(true));

    // Starting inside a cut section? Jump to the next real clip first.
    const gap = resolveGap(this.seq, this._time);
    if (gap.inGap) {
      if (gap.jumpTo == null) { this.finish(); return; }
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
    this.emitTime(true);
    this.stateListeners.forEach(fn => fn(false));
    this.renderFrame();
  }

  /** Move the playhead. Repaints one composited frame even while paused. */
  seek(t: number, fast = false) {
    if (!this.seq) { this._time = Math.max(0, t); this.emitTime(true); return; }
    const clamped = Math.max(0, Math.min(this.seq.durationS, t));
    this._time = clamped;
    this.syncSource(false);

    const clip = baseClipAt(this.seq, clamped);
    const v    = this.el();
    if (clip && v.src) {
      const want = sourceTimeFor(clip, clamped);
      if (Math.abs(v.currentTime - want) > SEEK_EPSILON) {
        if (fast && 'fastSeek' in v && typeof (v as any).fastSeek === 'function') {
          try { (v as any).fastSeek(want); } catch { try { v.currentTime = want; } catch {} }
        } else {
          try { v.currentTime = want; } catch {}
        }
      }
    }
    this.emitTime(true);
    this.renderFrame();
  }

  /* ─────────── source management ─────────── */

  /** Point the active element at the clip under the playhead, and pre-roll the
   *  next clip on the spare element so the cut doesn't stall. */
  private syncSource(force: boolean) {
    if (!this.seq) return;
    const clip = baseClipAt(this.seq, this._time);
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
    if (edge != null && edge - this._time < 2.2) {
      const upcoming = baseClipAt(this.seq, edge + 0.001);
      if (upcoming && upcoming.id !== clip.id) {
        const nextUrl = this.sources.get(upcoming.sourceId);
        const spare   = this.other();
        if (nextUrl) {
          if (spare.src !== nextUrl) { spare.src = nextUrl; try { spare.load(); } catch {} }
          spare.muted = true;
          const want = sourceTimeFor(upcoming, edge);
          if (Math.abs(spare.currentTime - want) > 0.15) {
            try { spare.currentTime = want; } catch {}
          }
        }
      }
    }
  }

  /* ─────────── playback loop ─────────── */

  private loop = () => {
    if (this.destroyed || !this._playing || !this.seq) return;

    const clip = baseClipAt(this.seq, this._time);
    const v    = this.el();

    if (clip) {
      // Auto-recover if video paused unexpectedly due to buffer underrun in long video
      if (this._playing && v.paused && !v.ended && v.readyState >= 2) {
        void v.play().catch(() => {});
      }

      // The element owns the clock while it is running — we only read it.
      const srcT = v.currentTime;
      const tlT  = clip.timelineIn + (srcT - clip.sourceIn);

      if (tlT >= clip.timelineOut - 0.001) {
        // Clip finished — hand over to next clip
        this.advancePastClip(clip);
      } else {
        this._time = Math.max(clip.timelineIn, Math.min(clip.timelineOut, tlT));
        this.emitTime();
      }
      this.stats.buffering = v.readyState < 3;
    } else {
      const gap = resolveGap(this.seq, this._time);
      if (gap.jumpTo == null) { this.finish(); return; }
      this.seek(gap.jumpTo);
      void this.el().play().catch(() => {});
    }

    this.renderFrame();
    this.raf = requestAnimationFrame(this.loop);
  };

  private advancePastClip(clip: SequenceClip) {
    if (!this.seq) return;
    const t    = clip.timelineOut + 0.001;
    const next = baseClipAt(this.seq, t);

    if (!next) {
      const gap = resolveGap(this.seq, t);
      if (gap.jumpTo == null) {           // end of programme
        this.finish();
        return;
      }
      this.seek(gap.jumpTo);
      void this.el().play().catch(() => {});
      return;
    }

    // Check if next clip is continuous in the same video source (zero-gap uninterrupted playback)
    const outgoing = this.el();
    const nextUrl = this.sources.get(next.sourceId);
    const isSameSource = outgoing.src === nextUrl;
    const isContinuous = isSameSource && Math.abs(outgoing.currentTime - next.sourceIn) < 0.15;

    if (isContinuous) {
      this._time = next.timelineIn;
      this.currentClipId = next.id;
      this.stats.activeClip = next.id;
      outgoing.muted = next.muted;
      this.emitTime(true);
      return;
    }

    // Swap to the spare element, which has already been seeked to this point
    const spare   = this.other();
    if (nextUrl && spare.src === nextUrl && spare.readyState >= 2) {
      this.active = this.active === 0 ? 1 : 0;
      try { outgoing.pause(); } catch {}
      spare.muted = next.muted;
      void spare.play().catch(() => {});
    } else if (isSameSource) {
      try { outgoing.currentTime = next.sourceIn; } catch {}
      outgoing.muted = next.muted;
      if (outgoing.paused && this._playing) {
        void outgoing.play().catch(() => {});
      }
    } else if (nextUrl) {
      if (spare.src !== nextUrl) { spare.src = nextUrl; try { spare.load(); } catch {} }
      spare.muted = next.muted;
      this.active = this.active === 0 ? 1 : 0;
      try { outgoing.pause(); } catch {}
      try { spare.currentTime = next.sourceIn; } catch {}
      void spare.play().catch(() => {});
    }

    this._time         = next.timelineIn;
    this.currentClipId = null;    // force a re-sync onto the new clip
    this.syncSource(false);
    this.emitTime(true);
  }

  /* ─────────── B-roll cutaway ─────────── */

  /** Point the overlay element at the cutaway on screen, if any. It is muted
   *  and only scrubbed/played silently; the base element owns the clock. */
  private syncCutaway() {
    if (!this.seq) return;
    const ov = this.overlayEl;
    if (!ov) return;
    const cut = cutawayClipAt(this.seq, this._time);
    this.cutawayClip = cut;

    if (!cut) {
      if (!ov.paused) { try { ov.pause(); } catch {} }
      return;
    }
    const url = this.sources.get(cut.sourceId);
    if (url && ov.src !== url) { ov.src = url; try { ov.load(); } catch {} }
    ov.muted = true;
    const want = sourceTimeFor(cut, this._time);
    if (Math.abs(ov.currentTime - want) > 0.12) {
      try { ov.currentTime = want; } catch {}
    }
    if (ov.paused && this._playing) { void ov.play().catch(() => {}); }
  }

  /* ─────────── compositor ─────────── */

  renderFrame() {
    const ctx = this.ctx, canvas = this.canvas, seq = this.seq;
    if (!ctx || !canvas || !seq) return;

    this.syncCutaway();

    const W = canvas.width, H = canvas.height;

    const clips = videoClipsAt(seq, this._time);
    const hasReadyVideo = clips.some(clip => {
      const v = clip === this.cutawayClip ? this.overlayEl : this.el();
      return v && v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2;
    });

    // Frame preservation: If the video is momentarily seeking or buffering between frames,
    // retain the previously rendered frame on canvas instead of blanking to solid black!
    if (!hasReadyVideo && this.stats.drawn > 0 && (this._playing || this.stats.buffering)) {
      return;
    }

    ctx.save();
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Draw every video clip on screen, lowest z first — so a B-roll cutaway
    // (higher z, muted) paints over the base talk track while the base keeps
    // owning the audio clock.
    for (const clip of clips) {
      const v = clip === this.cutawayClip ? this.overlayEl : this.el();
      if (!v) continue;
      const w = v.videoWidth, h = v.videoHeight;
      if (w && h && v.readyState >= 2) {
        let tr = clip.transform;
        if (seq.autoReframe?.enabled && seq.autoReframe.keyframes.length > 0) {
          const rf = getAutoReframeOffset(seq.autoReframe.keyframes, this._time);
          tr = {
            ...tr,
            fit: 'cover',
            offsetX: tr.offsetX + rf.offsetX,
            offsetY: tr.offsetY + rf.offsetY,
            scale: tr.scale * rf.scale,
          };
        }
        const r = fitRect(w, h, W, H, tr);
        const filterStr = filterFor(clip.effects);
        if (filterStr && filterStr !== 'none') {
          ctx.filter = filterStr;
        } else if (ctx.filter !== 'none') {
          ctx.filter = 'none';
        }
        if (clip.effects.opacity < 1) {
          ctx.globalAlpha = clip.effects.opacity;
        }
        try { ctx.drawImage(v, r.x, r.y, r.w, r.h); this.stats.drawn++; } catch {}
        if (ctx.filter !== 'none') ctx.filter = 'none';
        if (ctx.globalAlpha !== 1) ctx.globalAlpha = 1;
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
    const style = clip.textStyle ?? {};
    const raw   = clip.label ?? '';
    const text  = style.uppercase ? raw.toUpperCase() : raw;
    if (!text) return;

    /* Where in the frame. Older projects have no textPosition — they encoded
       it as the clip kind and the track — so fall back to reading those. */
    const where = clip.textPosition
      ?? (clip.kind === 'subtitle' || clip.trackId === 'subs' ? 'lower' : 'centre');

    let trackX = 0.5, trackY = 0.5, trackScale = 1.0, trackRot = 0;
    if (clip.motionTrack && clip.motionTrack.enabled) {
      const tracked = getTrackedPositionAt(this._time, clip.motionTrack);
      trackX = tracked.x;
      trackY = tracked.y;
      trackScale = tracked.scale;
      trackRot = tracked.rotation;
    }

    const scale = style.size === 'small' ? 0.034 : style.size === 'large' ? 0.075 : 0.048;
    const size  = Math.round(H * scale * trackScale);
    const weight = style.bold === false ? 400 : 700;
    const fontStyle = style.italic ? 'italic ' : '';

    /* Which side of the frame. Centred unless a corner was asked for. */
    const side = clip.motionTrack?.enabled ? 'centre' : (clip.textAlign ?? 'centre');

    ctx.save();
    if (trackRot !== 0) {
      ctx.translate(trackX * W, trackY * H);
      ctx.rotate((trackRot * Math.PI) / 180);
      ctx.translate(-trackX * W, -trackY * H);
    }

    ctx.font         = `${fontStyle}${weight} ${size}px ${FONT_STACKS[style.font ?? 'sans']}`;
    ctx.textAlign    = side === 'left' ? 'left' : side === 'right' ? 'right' : 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha  = clip.effects.opacity;

    /* Long lines are wrapped rather than run off both edges of the frame. */
    const maxW  = W * 0.86;
    const lines = wrapText(ctx, text, maxW);
    if (!lines.length) { ctx.restore(); return; }
    const lineH = Math.round(size * 1.22);
    const block = lineH * lines.length;

    const margin = Math.round(H * 0.08);
    const firstBaseline = clip.motionTrack?.enabled
      ? Math.round(trackY * H - block / 2) + size
      : (where === 'top'   ? margin + size
      : where === 'lower' ? H - margin - block + size
      :                     Math.round(H / 2 - block / 2) + size);

    const bg   = style.background ?? 'box';
    const padX = size * 0.5, padY = size * 0.32;

    /* The x the text is drawn from, honouring the side margin so a corner
       caption never touches the edge of the frame. */
    const sideMargin = Math.round(W * 0.05);
    const x = clip.motionTrack?.enabled
      ? Math.round(trackX * W)
      : (side === 'left'  ? sideMargin
      : side === 'right' ? W - sideMargin
      : W / 2);

    if (bg === 'box') {
      const widest = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
      const boxX = side === 'left'  ? x - padX
                 : side === 'right' ? x - widest - padX
                 : x - widest / 2 - padX;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(boxX, firstBaseline - size - padY * 0.4,
                   widest + padX * 2, block + padY * 1.4 - (lineH - size));
    }

    if (bg === 'shadow') {
      ctx.shadowColor   = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur    = Math.round(size * 0.35);
      ctx.shadowOffsetY = Math.round(size * 0.06);
    }

    const hasKaraoke = (style.animation && style.animation !== 'none') || Boolean(style.highlightColour);

    if (hasKaraoke && lines.length === 1) {
      // Word-level kinetic rendering for single-line captions (standard for shorts / reels)
      const timedWords = extractTimedWords(lines[0], clip.timelineIn, clip.timelineOut, style.words);
      const spaceW = ctx.measureText(' ').width;
      const wordWidths = timedWords.map(w => ctx.measureText(w.word).width);
      const totalTextW = wordWidths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, timedWords.length - 1);

      let curX = side === 'left' ? x : side === 'right' ? x - totalTextW : x - totalTextW / 2;

      for (let i = 0; i < timedWords.length; i++) {
        const tw = timedWords[i];
        const wW = wordWidths[i];
        const animState = getWordAnimationState(tw, this._time, style.animation ?? 'karaoke_pop');

        ctx.save();
        const wordCenterX = curX + wW / 2;
        const wordCenterY = firstBaseline - size / 3;

        if (animState.scale !== 1.0) {
          ctx.translate(wordCenterX, wordCenterY);
          ctx.scale(animState.scale, animState.scale);
          ctx.translate(-wordCenterX, -wordCenterY);
        }

        if (animState.opacity < 1.0) {
          ctx.globalAlpha *= animState.opacity;
        }

        // Pill box for active word if karaoke_box
        if (animState.isActive && style.animation === 'karaoke_box') {
          ctx.fillStyle = style.boxColour ?? 'rgba(0,0,0,0.85)';
          const pillPadX = size * 0.25;
          const pillPadY = size * 0.15;
          ctx.fillRect(curX - pillPadX, firstBaseline - size - pillPadY, wW + pillPadX * 2, size * 1.3);
        }

        // Glow effect
        if (animState.isActive && style.animation === 'karaoke_glow') {
          ctx.shadowColor = style.highlightColour ?? '#38BDF8';
          ctx.shadowBlur = Math.round(size * 0.6);
        }

        // Outline stroke
        if (style.outlineColour) {
          ctx.strokeStyle = style.outlineColour;
          ctx.lineWidth = style.outlineWidth ?? Math.max(2, Math.round(size * 0.08));
          ctx.lineJoin = 'round';
          ctx.strokeText(tw.word, curX, firstBaseline);
        }

        // Fill text with highlight or base colour
        ctx.fillStyle = animState.isActive ? (style.highlightColour ?? '#FACC15') : (style.colour ?? '#FFFFFF');
        ctx.fillText(tw.word, curX, firstBaseline);
        ctx.restore();

        curX += wW + spaceW;
      }
    } else {
      if (style.outlineColour) {
        ctx.strokeStyle = style.outlineColour;
        ctx.lineWidth = style.outlineWidth ?? Math.max(2, Math.round(size * 0.08));
        ctx.lineJoin = 'round';
        lines.forEach((line, i) => ctx.strokeText(line, x, firstBaseline + i * lineH));
      }
      ctx.fillStyle = style.colour ?? '#fff';
      lines.forEach((line, i) => ctx.fillText(line, x, firstBaseline + i * lineH));
    }

    ctx.restore();
  }

  /* ─────────── export hook ─────────── */

  /** Live stream of exactly what the preview shows — for MediaRecorder export. */
  captureStream(fps = 30): MediaStream | null {
    const c = this.canvas as (HTMLCanvasElement & { captureStream?: (f: number) => MediaStream }) | null;
    return c?.captureStream ? c.captureStream(fps) : null;
  }

  /**
   * Tap the media elements' audio for export with multi-track mixing & ducking.
   * The source nodes are connected ONLY to the supplied destination (a
   * MediaStreamAudioDestinationNode), never to the speakers — so a real-time
   * export records the audio without playing it out loud. Each element may only
   * ever be wrapped once; this is used on an export-only engine with its own
   * fresh video pool. Returns an unwire function.
   */
  wireAudio(ctx: AudioContext, dest: MediaStreamAudioDestinationNode): () => void {
    const audioMix = this.seq?.audioMix;
    const masterGain = ctx.createGain();
    masterGain.gain.value = audioMix ? (audioMix.master.muted ? 0 : audioMix.master.volume) : 1.0;
    masterGain.connect(dest);

    const voiceGain = ctx.createGain();
    const voiceVol = audioMix ? (audioMix.voice.muted ? 0 : audioMix.voice.volume * (audioMix.voiceEnhance ? 1.08 : 1.0)) : 1.0;
    voiceGain.gain.value = voiceVol;
    voiceGain.connect(masterGain);

    const baseNodes = this.pool.map(v => {
      const src = ctx.createMediaElementSource(v);
      src.connect(voiceGain);
      return src;
    });
    this.pool.forEach(v => { v.muted = false; });

    let overlayNode: MediaElementAudioSourceNode | null = null;
    let brollGain: GainNode | null = null;

    if (this.overlayEl) {
      if (audioMix && !audioMix.broll.muted && audioMix.broll.volume > 0.01) {
        brollGain = ctx.createGain();
        brollGain.gain.value = audioMix.broll.volume;
        brollGain.connect(masterGain);
        overlayNode = ctx.createMediaElementSource(this.overlayEl);
        overlayNode.connect(brollGain);
        this.overlayEl.muted = false;
      } else {
        this.overlayEl.muted = true;
      }
    }

    return () => {
      baseNodes.forEach(n => { try { n.disconnect(); } catch {} });
      if (overlayNode) { try { overlayNode.disconnect(); } catch {} }
      if (brollGain) { try { brollGain.disconnect(); } catch {} }
      try { voiceGain.disconnect(); } catch {}
      try { masterGain.disconnect(); } catch {}
    };
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
    if (this.overlayEl) {
      try { this.overlayEl.pause(); } catch {}
      this.overlayEl.removeAttribute('src');
      try { this.overlayEl.load(); } catch {}
      this.overlayEl.parentNode?.removeChild(this.overlayEl);
      this.overlayEl = null;
      this.cutawayClip = null;
    }
    this.timeListeners.clear();
    this.stateListeners.clear();
  }
}
