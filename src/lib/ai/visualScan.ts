/**
 * Looking at the picture.
 *
 * Two separate things go by the name "vision" here and they are worth keeping
 * apart:
 *
 *   1. Measurement — shot changes, movement and brightness, computed from the
 *      pixels in the browser. No model, no key, no network. Always available,
 *      always true.
 *   2. Sight — a handful of frames handed to a model that can actually look at
 *      them. Only some models can, so this half is allowed to be unavailable
 *      and must say so rather than inventing a description.
 *
 * The measurement half lives here as pure functions so it can be tested
 * without a browser; scanVideo is the one part that needs a document.
 */

export interface VisualSample {
  /** Seconds into the video. */
  tS:         number;
  /** Mean luma, 0 (black) to 1 (white). */
  brightness: number;
  /** How much changed since the previous sample, 0 (still) to 1. */
  motion:     number;
}

export interface VisualScan {
  durationS: number;
  samples:   VisualSample[];
  /** Times where the picture changed completely — a cut in the source. */
  cuts:      number[];
}

export interface Keyframe {
  tS:      number;
  /** A small JPEG, as a data URL, ready to hand to a model that can see. */
  dataUrl: string;
}

/* ── sampling plan ─────────────────────────────────────────────────────── */

/**
 * When to look. Fine enough to catch a cut, coarse enough that a long video
 * does not take a minute to scan: roughly 120 looks, never closer than a
 * quarter of a second, never further apart than two.
 */
export function sampleTimes(durationS: number, maxSamples = 120): number[] {
  if (!(durationS > 0)) return [];
  const step = Math.min(2, Math.max(0.25, durationS / maxSamples));
  const out: number[] = [];
  for (let t = 0; t < durationS && out.length < maxSamples * 2; t += step) {
    out.push(Number(t.toFixed(3)));
  }
  return out;
}

/* ── per-frame measurements ────────────────────────────────────────────── */

const BINS = 4;                       // per channel, so 64 buckets in total

/** Colour histogram of an RGBA buffer, normalised so the bins sum to 1. */
export function histogram(rgba: ArrayLike<number>): number[] {
  const bins = new Array<number>(BINS * BINS * BINS).fill(0);
  const px   = Math.floor(rgba.length / 4);
  if (!px) return bins;

  for (let i = 0; i < rgba.length; i += 4) {
    const r = Math.min(BINS - 1, (rgba[i]     / 256) * BINS | 0);
    const g = Math.min(BINS - 1, (rgba[i + 1] / 256) * BINS | 0);
    const b = Math.min(BINS - 1, (rgba[i + 2] / 256) * BINS | 0);
    bins[r * BINS * BINS + g * BINS + b] += 1;
  }
  return bins.map(n => n / px);
}

/** 0 when two histograms match, 1 when they share nothing. */
export function histDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - (b[i] ?? 0));
  return Math.min(1, sum / 2);
}

/** Mean luma of an RGBA buffer, 0..1. */
export function brightnessOf(rgba: ArrayLike<number>): number {
  const px = Math.floor(rgba.length / 4);
  if (!px) return 0;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return sum / px / 255;
}

/** How much of the picture changed between two frames, 0..1. */
export function frameMotion(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0, px = 0;
  for (let i = 0; i < n; i += 4) {
    const la = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
    const lb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    sum += Math.abs(la - lb);
    px  += 1;
  }
  return px ? Math.min(1, sum / px / 255) : 0;
}

/**
 * A cut is a frame that shares almost nothing with the one before it. The
 * threshold is deliberately high: calling a fast pan a cut would scatter
 * false shot boundaries through a single continuous take.
 */
export function detectCuts(hists: number[][], times: number[], threshold = 0.45): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < hists.length; i++) {
    if (histDistance(hists[i], hists[i - 1]) >= threshold) cuts.push(times[i]);
  }
  return cuts;
}

/* ── reading the scan ──────────────────────────────────────────────────── */

/** The shots, as [start, end] pairs, from the cut list. */
export function shots(scan: VisualScan): [number, number][] {
  const edges = [0, ...scan.cuts.filter(t => t > 0 && t < scan.durationS), scan.durationS];
  const out: [number, number][] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1] - edges[i] > 0.2) out.push([edges[i], edges[i + 1]]);
  }
  return out;
}

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Average movement inside a span. */
export function motionBetween(scan: VisualScan, startS: number, endS: number): number {
  return mean(scan.samples.filter(s => s.tS >= startS && s.tS < endS).map(s => s.motion));
}

/**
 * The busiest stretches of picture, longest first by score. Used on its own
 * for "find the action", and mixed with loudness for highlight picking.
 */
export function busiestSpans(
  scan: VisualScan, count: number, spanS: number,
): { startS: number; endS: number; motion: number }[] {
  if (!scan.samples.length || spanS <= 0) return [];

  const out: { startS: number; endS: number; motion: number }[] = [];
  const step = Math.max(0.5, spanS / 4);

  for (let t = 0; t + spanS <= scan.durationS + 0.001; t += step) {
    out.push({ startS: Number(t.toFixed(2)), endS: Number((t + spanS).toFixed(2)),
               motion: motionBetween(scan, t, t + spanS) });
  }
  out.sort((a, b) => b.motion - a.motion);

  // Don't hand back four overlapping versions of the same moment.
  const picked: typeof out = [];
  for (const span of out) {
    if (picked.length >= count) break;
    if (picked.some(p => span.startS < p.endS && span.endS > p.startS)) continue;
    picked.push(span);
  }
  return picked.sort((a, b) => a.startS - b.startS);
}

/** Spans dark enough to look like a fade, a lens cap or a black slate. */
export function darkSpans(scan: VisualScan, threshold = 0.06): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;

  scan.samples.forEach((s, i) => {
    const dark = s.brightness <= threshold;
    if (dark && start === null) start = s.tS;
    if (!dark && start !== null) { out.push([start, s.tS]); start = null; }
    if (dark && i === scan.samples.length - 1 && start !== null) {
      out.push([start, scan.durationS]); start = null;
    }
  });
  return out.filter(([a, b]) => b - a >= 0.4);
}

const fmt = (s: number) => `${s.toFixed(1)}s`;

/**
 * What the measurements say, in a few lines a model can use. This goes into
 * every request, with or without a model that can see, because it is cheap
 * and it is fact rather than impression.
 */
export function summariseVisual(scan: VisualScan | null): string {
  if (!scan || !scan.samples.length) return '';

  const lines: string[] = [];
  const cuts = scan.cuts.filter(t => t > 0 && t < scan.durationS);

  lines.push(cuts.length
    ? `${cuts.length} shot change${cuts.length === 1 ? '' : 's'}, at ` +
      `${cuts.slice(0, 12).map(fmt).join(', ')}${cuts.length > 12 ? ' and more' : ''}`
    : 'one continuous shot, no cuts in the footage');

  const busiest = busiestSpans(scan, 3, Math.min(4, Math.max(1, scan.durationS / 6)));
  if (busiest.length) {
    /* Three windows that run into each other are one busy stretch, and
       reading them out separately makes a single moment look like three. */
    const merged: [number, number][] = [];
    for (const b of busiest) {
      const last = merged[merged.length - 1];
      if (last && b.startS - last[1] < 0.51) last[1] = b.endS;
      else merged.push([b.startS, b.endS]);
    }
    lines.push('most movement around ' +
      merged.map(([a, b]) => `${fmt(a)}-${fmt(b)}`).join(', '));
  }

  const still = scan.samples.filter(s => s.motion < 0.01).length;
  if (still > scan.samples.length * 0.5) {
    lines.push(`${Math.round(still / scan.samples.length * 100)}% of the frames barely move`);
  }

  const bright = mean(scan.samples.map(s => s.brightness));
  lines.push(`average brightness ${bright.toFixed(2)} ` +
    (bright < 0.25 ? '(dark footage)' : bright > 0.7 ? '(bright footage)' : '(mid)'));

  const dark = darkSpans(scan);
  if (dark.length) {
    lines.push('black or near-black at ' +
      dark.slice(0, 4).map(([a, b]) => `${fmt(a)}-${fmt(b)}`).join(', '));
  }

  return lines.join('\n');
}

/**
 * Which frames to hand a model that can see: the middle of each shot, so the
 * six pictures describe six different things rather than six moments of the
 * same one.
 */
export function keyframeTimes(scan: VisualScan | null, max = 6): number[] {
  if (!scan || scan.durationS <= 0) return [];

  const list = shots(scan);
  const middles = list.map(([a, b]) => (a + b) / 2);

  if (middles.length >= max) {
    // Spread the choice across the whole video rather than the first shots.
    const step = middles.length / max;
    return Array.from({ length: max }, (_, i) => middles[Math.floor(i * step)])
      .map(t => Number(t.toFixed(2)));
  }

  const out = new Set(middles.map(t => Number(t.toFixed(2))));
  for (let i = 0; out.size < max && i < max * 2; i++) {
    const t = (scan.durationS * (i + 0.5)) / max;
    out.add(Number(t.toFixed(2)));
  }
  return [...out].sort((a, b) => a - b).slice(0, max);
}

/* ── the browser half ──────────────────────────────────────────────────── */

const SCAN_W = 64;      // measurement only needs a thumbnail
const SCAN_H = 36;
const FRAME_W = 384;    // what a model gets to look at

/** Seek and wait, with a ceiling so one bad seek cannot hang the scan. */
function seek(video: HTMLVideoElement, t: number, timeoutMs = 2000): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; cleanup(); resolve(); } };
    const cleanup = () => {
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
    };
    const timer = setTimeout(finish, timeoutMs);
    video.addEventListener('seeked', finish);
    try { video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.05)); }
    catch { finish(); }
  });
}

export interface ScanResult { scan: VisualScan; keyframes: Keyframe[] }

/**
 * Walk the video once, measuring as it goes and keeping a few frames.
 *
 * Runs off the main render path and is happy to be abandoned: every await
 * checks the abort signal, because a user who closes the project should not
 * be paying for a scan they will never see.
 */
export async function scanVideo(
  src: Blob | string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ScanResult | null> {
  if (typeof document === 'undefined') return null;

  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  const release = () => {
    video.removeAttribute('src');
    video.load?.();
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  };

  try {
    const ready = await new Promise<boolean>(resolve => {
      const ok = () => resolve(true);
      const no = () => resolve(false);
      video.addEventListener('loadedmetadata', ok, { once: true });
      video.addEventListener('error', no, { once: true });
      setTimeout(no, 10000);
    });
    if (!ready || !isFinite(video.duration) || video.duration <= 0) { release(); return null; }

    const durationS = video.duration;
    const times     = sampleTimes(durationS);
    const small     = document.createElement('canvas');
    small.width = SCAN_W; small.height = SCAN_H;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) { release(); return null; }

    const samples: VisualSample[] = [];
    const hists:   number[][]     = [];
    let previous:  Uint8ClampedArray | null = null;

    for (let i = 0; i < times.length; i++) {
      if (opts.signal?.aborted) { release(); return null; }
      await seek(video, times[i]);
      sctx.drawImage(video, 0, 0, SCAN_W, SCAN_H);
      const { data } = sctx.getImageData(0, 0, SCAN_W, SCAN_H);

      samples.push({
        tS:         times[i],
        brightness: Number(brightnessOf(data).toFixed(4)),
        motion:     Number((previous ? frameMotion(previous, data) : 0).toFixed(4)),
      });
      hists.push(histogram(data));
      previous = new Uint8ClampedArray(data);
      opts.onProgress?.(i + 1, times.length);
    }

    const scan: VisualScan = { durationS, samples, cuts: detectCuts(hists, times) };

    /* Keyframes, at a size worth looking at. */
    const wide = document.createElement('canvas');
    const ratio = (video.videoHeight || 9) / (video.videoWidth || 16);
    wide.width  = FRAME_W;
    wide.height = Math.max(1, Math.round(FRAME_W * ratio));
    const wctx = wide.getContext('2d');

    const keyframes: Keyframe[] = [];
    if (wctx) {
      for (const t of keyframeTimes(scan)) {
        if (opts.signal?.aborted) break;
        await seek(video, t);
        wctx.drawImage(video, 0, 0, wide.width, wide.height);
        keyframes.push({ tS: t, dataUrl: wide.toDataURL('image/jpeg', 0.55) });
      }
    }

    release();
    return { scan, keyframes };
  } catch {
    release();
    return null;
  }
}

/** Trim a scan down to something sane to post with every message. */
export function compactScan(scan: VisualScan, maxSamples = 300): VisualScan {
  if (scan.samples.length <= maxSamples) return scan;
  const step = Math.ceil(scan.samples.length / maxSamples);
  return {
    ...scan,
    samples: scan.samples.filter((_, i) => i % step === 0),
  };
}
