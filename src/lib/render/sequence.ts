/**
 * Sequence model — the "programme" the preview renders.
 *
 * A real editor doesn't play a file, it plays a *sequence*: an ordered set of
 * clips, each of which points at a range of some source media and occupies a
 * range of timeline time. The two are not the same — trimming a clip changes
 * where it reads from the source without moving it on the timeline, and
 * cutting a section leaves a gap that playback must handle.
 *
 * Everything here is pure so it can be reasoned about and tested without a
 * browser; the DOM side lives in engine.ts.
 */

export type ClipKind = 'video' | 'audio' | 'text' | 'subtitle';

export interface Transform {
  /** How the source is mapped into the frame. */
  fit:      'contain' | 'cover' | 'stretch';
  scale:    number;      // 1 = as fitted
  offsetX:  number;      // fraction of frame width,  + = right
  offsetY:  number;      // fraction of frame height, + = down
  rotation: number;      // degrees
}

export interface Effects {
  brightness: number;    // 1 = unchanged
  contrast:   number;
  saturation: number;
  blurPx:     number;
  opacity:    number;    // 0..1
}

export interface SequenceClip {
  id:          string;
  trackId:     string;
  kind:        ClipKind;
  label:       string;
  /** Position on the programme timeline. */
  timelineIn:  number;
  timelineOut: number;
  /** Which source this reads from, and where in that source it starts. */
  sourceId:    string;
  sourceIn:    number;
  transform:   Transform;
  effects:     Effects;
  /** Higher wins when clips overlap on different tracks. */
  z:           number;
  muted:       boolean;
}

export interface Sequence {
  durationS: number;
  width:     number;
  height:    number;
  clips:     SequenceClip[];
}

export const DEFAULT_TRANSFORM: Transform = {
  fit: 'contain', scale: 1, offsetX: 0, offsetY: 0, rotation: 0,
};

export const DEFAULT_EFFECTS: Effects = {
  brightness: 1, contrast: 1, saturation: 1, blurPx: 0, opacity: 1,
};

/** Track stacking order, bottom to top. */
const Z_BY_TRACK: Record<string, number> = {
  video: 0, aud1: 0, aud2: 0, overlay: 10, subs: 20, text: 30,
};

export interface EditorClipLike {
  id: string; trackId: string; label: string;
  startS: number; endS: number; type: ClipKind;
}

/**
 * Build a sequence from the editor's clip list.
 *
 * The editor's clips carry timeline positions only; because an AI cut removes
 * a span and leaves the surrounding clips where they are, each clip reads from
 * the source at its own timeline position — so sourceIn === timelineIn here.
 * Once trimming/moving exists, only this function needs to change.
 */
export function buildSequence(
  clips: EditorClipLike[],
  opts: { durationS: number; width: number; height: number; sourceId: string },
): Sequence {
  const usable = (clips ?? []).filter(c => c.endS > c.startS);

  const seqClips: SequenceClip[] = usable.map(c => ({
    id:          c.id,
    trackId:     c.trackId,
    kind:        c.type,
    label:       c.label,
    timelineIn:  Math.max(0, c.startS),
    timelineOut: Math.min(opts.durationS || c.endS, c.endS),
    sourceId:    opts.sourceId,
    sourceIn:    Math.max(0, c.startS),
    transform:   { ...DEFAULT_TRANSFORM },
    effects:     { ...DEFAULT_EFFECTS },
    z:           Z_BY_TRACK[c.trackId] ?? 5,
    muted:       c.type === 'text' || c.type === 'subtitle',
  }));

  // Nothing analysed yet — play the whole source as one clip so the preview
  // works from the moment the media is available.
  if (seqClips.length === 0 && opts.durationS > 0) {
    seqClips.push({
      id: 'base', trackId: 'video', kind: 'video', label: 'Video',
      timelineIn: 0, timelineOut: opts.durationS,
      sourceId: opts.sourceId, sourceIn: 0,
      transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS },
      z: 0, muted: false,
    });
  }

  seqClips.sort((a, b) => a.timelineIn - b.timelineIn || a.z - b.z);

  return {
    durationS: opts.durationS,
    width:     opts.width  || 1920,
    height:    opts.height || 1080,
    clips:     seqClips,
  };
}

const isVisual = (c: SequenceClip) => c.kind !== 'audio';

/** Clips of a given kind that cover time `t`. */
export function clipsAt(seq: Sequence, t: number, kind?: ClipKind): SequenceClip[] {
  return seq.clips.filter(c =>
    (kind ? c.kind === kind : true) && t >= c.timelineIn && t < c.timelineOut);
}

/** The visual clip that should be on screen at `t` (topmost by z). */
export function videoClipAt(seq: Sequence, t: number): SequenceClip | null {
  const hits = seq.clips.filter(c =>
    c.kind === 'video' && t >= c.timelineIn && t < c.timelineOut);
  if (!hits.length) return null;
  return hits.reduce((top, c) => (c.z >= top.z ? c : top));
}

/** Text / subtitle clips visible at `t`, in draw order. */
export function overlaysAt(seq: Sequence, t: number): SequenceClip[] {
  return seq.clips
    .filter(c => (c.kind === 'text' || c.kind === 'subtitle')
              && t >= c.timelineIn && t < c.timelineOut)
    .sort((a, b) => a.z - b.z);
}

/** Where to read the source for a clip at timeline time `t`. */
export function sourceTimeFor(clip: SequenceClip, t: number): number {
  return clip.sourceIn + (t - clip.timelineIn);
}

/** Start of the next visual clip at or after `t`, or null past the end. */
export function nextClipStart(seq: Sequence, t: number): number | null {
  const starts = seq.clips
    .filter(isVisual)
    .map(c => c.timelineIn)
    .filter(s => s > t)
    .sort((a, b) => a - b);
  return starts.length ? starts[0] : null;
}

/**
 * Playback over a hole in the timeline.
 *
 * A gap means "this footage was cut". Rather than sitting on black, the
 * preview jumps to the next clip — which is what makes the preview show the
 * edit rather than the raw file.
 */
export function resolveGap(seq: Sequence, t: number): { inGap: boolean; jumpTo: number | null } {
  if (videoClipAt(seq, t)) return { inGap: false, jumpTo: null };
  const next = nextClipStart(seq, t);
  return { inGap: true, jumpTo: next };
}

/** The next moment the composition changes — used to preload the next clip. */
export function nextBoundary(seq: Sequence, t: number): number | null {
  const edges: number[] = [];
  for (const c of seq.clips) {
    if (c.timelineIn  > t) edges.push(c.timelineIn);
    if (c.timelineOut > t) edges.push(c.timelineOut);
  }
  if (!edges.length) return null;
  return Math.min(...edges);
}

/** Total playable time, i.e. excluding gaps. */
export function playableDuration(seq: Sequence): number {
  const spans = seq.clips.filter(isVisual)
    .map(c => [c.timelineIn, c.timelineOut] as const)
    .sort((a, b) => a[0] - b[0]);

  let total = 0, cursor = -Infinity;
  for (const [s, e] of spans) {
    const start = Math.max(s, cursor);
    if (e > start) { total += e - start; cursor = e; }
  }
  return total;
}

/**
 * Fit a source rectangle into the frame.
 * Returns the destination rect for drawImage, in canvas pixels.
 */
export function fitRect(
  srcW: number, srcH: number, frameW: number, frameH: number, tr: Transform,
): { x: number; y: number; w: number; h: number } {
  if (!srcW || !srcH) return { x: 0, y: 0, w: frameW, h: frameH };

  const srcAR   = srcW / srcH;
  const frameAR = frameW / frameH;

  let w: number, h: number;
  if (tr.fit === 'stretch') {
    w = frameW; h = frameH;
  } else if ((tr.fit === 'cover') === (srcAR > frameAR)) {
    // cover + wider source, or contain + taller source → match height
    h = frameH; w = h * srcAR;
  } else {
    w = frameW; h = w / srcAR;
  }

  w *= tr.scale;
  h *= tr.scale;

  return {
    x: (frameW - w) / 2 + tr.offsetX * frameW,
    y: (frameH - h) / 2 + tr.offsetY * frameH,
    w, h,
  };
}

/** CSS filter string for a clip's colour effects. */
export function filterFor(fx: Effects): string {
  const parts: string[] = [];
  if (fx.brightness !== 1) parts.push(`brightness(${fx.brightness})`);
  if (fx.contrast   !== 1) parts.push(`contrast(${fx.contrast})`);
  if (fx.saturation !== 1) parts.push(`saturate(${fx.saturation})`);
  if (fx.blurPx      >  0) parts.push(`blur(${fx.blurPx}px)`);
  return parts.length ? parts.join(' ') : 'none';
}
