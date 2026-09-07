/**
 * Reference keyframes — the lost signal.
 *
 * The reference-matching rebuild hypothesis: the model has never SEEN the
 * reference. `analyseReference` samples its frames to compute metrics and
 * throws the pixels away; the model gets a rule card. This module recovers
 * a handful of reference frames (with their timestamps) so the edit request
 * can attach them next to the user's footage — reason by comparison, not by
 * paraphrase.
 *
 * Pure parts (picker math) are unit-tested; the browser part is deliberately
 * small and fails to `[]` so a reference never blocks an edit.
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** One reference frame, small enough to travel with the request. */
export interface ReferenceKeyframe {
  /** Absolute time in the reference (seconds) — not rebased to the window. */
  tS:      number;
  dataUrl: string;
}

const MAX_KEYFRAMES = 8;
const JPEG_QUALITY  = 0.5;

/**
 * Pick `count` evenly spaced absolute times inside the reference (or inside
 * [startS, endS] when a range is given). Deterministic, clamped, deduped:
 *  - count clamped to 3..MAX_KEYFRAMES;  - times never exceed the source;
 *  - the first frame is the window start (or 1% in for readability).
 */
export function pickReferenceFrameTimes(
  durationS: number,
  count: number,
  range?: { startS: number; endS: number } | null,
): number[] {
  const dur = Math.max(0.1, durationS);
  const start = Math.max(0, Math.min(range?.startS ?? 0, dur - 0.05));
  const end = Math.max(start + 0.1, Math.min(range?.endS ?? dur, dur));
  const span = end - start;
  const n = Math.max(3, Math.min(MAX_KEYFRAMES, Math.round(count)));
  if (n === 1) return [Number((start + span * 0.1).toFixed(3))];
  const step = span / n;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    /* Start slightly inside the window so a 0.0s frame isn't a black pre-roll. */
    const t = Math.min(end - 0.05, start + i * step + Math.min(0.4, step * 0.15));
    const prev = times[times.length - 1];
    if (prev !== undefined && t - prev < 0.2) continue;   // dedupe seeks
    times.push(Number(t.toFixed(3)));
  }
  return times;
}

/**
 * Sample `count` reference frames as low-res JPEG data URLs.
 * Never throws — a video that won't decode yields `[]`.
 */
export async function sampleReferenceKeyframes(
  url: string,
  durationS: number,
  count: number,
  range?: { startS: number; endS: number } | null,
): Promise<ReferenceKeyframe[]> {
  const times = pickReferenceFrameTimes(durationS, count, range);
  if (!times.length) return [];

  const video = document.createElement('video');
  video.src = url; video.muted = true; video.playsInline = true; video.preload = 'auto';
  video.load();

  const once = (ev: string, ms: number) => new Promise<boolean>(res => {
    const to = setTimeout(() => { cleanup(); res(false); }, ms);
    const ok = () => { cleanup(); res(true); };
    const no = () => { cleanup(); res(false); };
    const cleanup = () => {
      clearTimeout(to);
      video.removeEventListener(ev, ok);
      video.removeEventListener('error', no);
    };
    video.addEventListener(ev, ok, { once: true });
    video.addEventListener('error', no, { once: true });
  });

  try {
    if (video.readyState < 2) {
      await Promise.race([
        once('loadeddata', 2000), once('canplay', 2000), once('loadedmetadata', 2000),
      ]);
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) return [];

    /* Fixed small canvas: composition-readable, transmission-cheap. */
    const W = 512;
    const H = 288;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    const out: ReferenceKeyframe[] = [];
    for (const t of times) {
      const target = Math.min(video.duration - 0.05, t);
      if (typeof video.fastSeek === 'function') {
        try { video.fastSeek(target); } catch { video.currentTime = target; }
      } else {
        video.currentTime = target;
      }
      if (Math.abs(video.currentTime - target) > 0.3) {
        await once('seeked', 400);
      }
      try {
        ctx.drawImage(video, 0, 0, W, H);
        out.push({ tS: target, dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY) });
      } catch { /* not ready / tainted — skip this one */ }
      await new Promise(r => setTimeout(r, 4));   // yield so the tab stays alive
    }
    return out;
  } finally {
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* cleanup */ }
  }
}
