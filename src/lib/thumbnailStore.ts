/**
 * Generates and caches thumbnail frames from a video blob URL.
 * Uses an offscreen <video> + <canvas> to seek to timestamps and capture frames.
 * Results are stored as data URLs keyed by `${projectId}:${frameIndex}`.
 */

const cache = new Map<string, string>(); // key → dataURL

export interface ThumbnailSet {
  frames:  string[];   // array of data URLs
  width:   number;
  height:  number;
}

/**
 * Extract `count` evenly-spaced frames from a video.
 *
 * Runs several decoders in parallel and reports frames as they arrive, so the
 * timeline can paint a partial strip immediately instead of waiting for the
 * whole pass. Sequential extraction of a long clip took many seconds; this
 * cuts wall-clock time by roughly the worker count.
 */
export async function extractFrames(
  videoUrl: string,
  durationS: number,
  count: number,
  thumbW = 96,
  thumbH = 54,
  onProgress?: (frames: string[]) => void,
): Promise<string[]> {
  if (!videoUrl || count <= 0) return [];

  const frames: string[] = new Array(count).fill('');
  const WORKERS = Math.min(6, count);          // parallel decoders
  let settled = 0;

  const timeFor = (i: number) => (i / Math.max(1, count - 1)) * durationS * 0.92;

  const runWorker = (startIdx: number) => new Promise<void>(resolve => {
    const video = document.createElement('video');
    video.src         = videoUrl;
    video.muted       = true;
    video.playsInline = true;
    video.preload     = 'auto';

    const canvas  = document.createElement('canvas');
    canvas.width  = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d')!;

    let idx = startIdx;
    const finish = () => { video.src = ''; video.removeAttribute('src'); resolve(); };
    const guard  = setTimeout(finish, 20000);   // never hang the editor

    const next = () => {
      if (idx >= count) { clearTimeout(guard); finish(); return; }
      video.currentTime = Math.min(timeFor(idx), Math.max(0, durationS - 0.05));
    };

    video.onseeked = () => {
      try {
        ctx.drawImage(video, 0, 0, thumbW, thumbH);
        frames[idx] = canvas.toDataURL('image/jpeg', 0.5);
      } catch { /* leave blank */ }
      settled++;
      onProgress?.(frames);                      // stream partial results
      idx += WORKERS;                            // interleave across workers
      next();
    };

    video.onerror         = () => { clearTimeout(guard); finish(); };
    video.onloadeddata    = () => next();
    video.load();
  });

  await Promise.all(Array.from({ length: WORKERS }, (_, w) => runWorker(w)));
  if (settled === 0) return [];
  return frames;
}

/** Store pre-extracted thumbnails for a project */
const projectFrames = new Map<string, string[]>();

export function setProjectFrames(projectId: string, frames: string[]) {
  projectFrames.set(projectId, frames);
}

export function getProjectFrames(projectId: string): string[] {
  return projectFrames.get(projectId) ?? [];
}

/* ────────────── POSTER FRAMES ────────────── */

const POSTER_KEY = (projectId: string) => `modaya:poster:${projectId}`;

/** Persist a poster locally so it survives refreshes even if the server misses it. */
export function savePoster(projectId: string, dataUrl: string) {
  try { localStorage.setItem(POSTER_KEY(projectId), dataUrl); } catch { /* quota */ }
}

export function loadPoster(projectId: string): string {
  try { return localStorage.getItem(POSTER_KEY(projectId)) ?? ''; } catch { return ''; }
}

/** True when a captured frame is essentially blank (all black / all one colour). */
function isBlankFrame(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    let min = 255, max = 0;
    // Sample every 40th pixel — enough to spot a flat frame cheaply
    for (let i = 0; i < data.length; i += 160) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    return max < 12 || (max - min) < 6;
  } catch {
    return false; // tainted canvas — assume usable
  }
}

/**
 * Capture a poster frame from a video, preserving its real aspect ratio.
 *
 * Tries several timestamps because the first frame of a clip is often black
 * (fade-ins, leader frames). Returns a JPEG data URL (~20-40 KB) or '' if the
 * video can't be decoded at all.
 */
export async function capturePoster(
  videoUrl: string,
  atS = 1,
  maxW = 480,
): Promise<string> {
  if (!videoUrl) return '';

  const video = document.createElement('video');
  video.src         = videoUrl;
  video.muted       = true;
  video.playsInline = true;
  video.preload     = 'auto';
  // crossOrigin breaks some blob: sources — only set it for remote URLs
  if (!videoUrl.startsWith('blob:')) video.crossOrigin = 'anonymous';

  const waitFor = (event: string, timeoutMs: number) =>
    new Promise<boolean>(resolve => {
      const t = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      const ok = () => { cleanup(); resolve(true); };
      const fail = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        clearTimeout(t);
        video.removeEventListener(event, ok);
        video.removeEventListener('error', fail);
      };
      video.addEventListener(event, ok,   { once: true });
      video.addEventListener('error', fail, { once: true });
    });

  try {
    video.load();
    if (!(await waitFor('loadeddata', 8000))) return '';

    const vw = video.videoWidth  || 16;
    const vh = video.videoHeight || 9;
    const w  = Math.min(maxW, vw);
    const h  = Math.max(1, Math.round((w / vw) * vh));   // true aspect ratio

    const canvas  = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    // A few candidate timestamps — skip black intros, never run past the end
    const targets = dur
      ? [Math.min(atS, dur * 0.25), dur * 0.5, dur * 0.1, 0]
      : [0];

    let fallback = '';
    for (const t of targets) {
      video.currentTime = Math.max(0, Math.min(t, dur ? dur - 0.05 : 0));
      if (!(await waitFor('seeked', 5000))) continue;

      try {
        ctx.drawImage(video, 0, 0, w, h);
      } catch {
        continue;
      }

      const url = canvas.toDataURL('image/jpeg', 0.62);
      if (!isBlankFrame(ctx, w, h)) return url;   // good frame
      fallback = url;                              // blank, but keep as last resort
    }
    return fallback;
  } catch {
    return '';
  } finally {
    video.src = '';
    video.removeAttribute('src');
  }
}
