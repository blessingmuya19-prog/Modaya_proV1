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

/** Extract `count` evenly-spaced frames from a video URL */
export async function extractFrames(
  videoUrl: string,
  durationS: number,
  count: number,
  thumbW = 120,
  thumbH = 68,
): Promise<string[]> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.src      = videoUrl;
    video.muted    = true;
    video.preload  = 'metadata';
    video.crossOrigin = 'anonymous';

    const canvas  = document.createElement('canvas');
    canvas.width  = thumbW;
    canvas.height = thumbH;
    const ctx     = canvas.getContext('2d')!;

    const frames: string[] = [];
    let idx = 0;

    const seekNext = () => {
      if (idx >= count) { resolve(frames); return; }
      // Spread frames across 90% of the duration so we don't hit black frames at the end
      const t = (idx / Math.max(1, count - 1)) * durationS * 0.9;
      video.currentTime = t;
    };

    video.onseeked = () => {
      try {
        ctx.drawImage(video, 0, 0, thumbW, thumbH);
        frames.push(canvas.toDataURL('image/jpeg', 0.6));
      } catch {
        frames.push(''); // cross-origin or decode error — blank
      }
      idx++;
      seekNext();
    };

    video.onerror = () => resolve(frames);

    video.onloadedmetadata = () => seekNext();
  });
}

/** Store pre-extracted thumbnails for a project */
const projectFrames = new Map<string, string[]>();

export function setProjectFrames(projectId: string, frames: string[]) {
  projectFrames.set(projectId, frames);
}

export function getProjectFrames(projectId: string): string[] {
  return projectFrames.get(projectId) ?? [];
}

/**
 * Capture a single poster frame from a video, sized to preserve its real
 * aspect ratio. Returns a JPEG data URL small enough to persist alongside
 * the project record (~15–30 KB), or '' if the frame can't be read.
 */
export async function capturePoster(
  videoUrl: string,
  atS = 1,
  maxW = 480,
): Promise<string> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.src         = videoUrl;
    video.muted       = true;
    video.preload     = 'metadata';
    video.crossOrigin = 'anonymous';

    // Never hang the upload flow on a stubborn file
    const bail = setTimeout(() => resolve(''), 6000);
    const finish = (out: string) => { clearTimeout(bail); resolve(out); };

    video.onloadedmetadata = () => {
      // Grab a frame slightly in, so we skip black/fade-in first frames
      video.currentTime = Math.min(atS, (video.duration || 2) * 0.25);
    };

    video.onseeked = () => {
      try {
        const vw = video.videoWidth  || 16;
        const vh = video.videoHeight || 9;
        const w  = Math.min(maxW, vw);
        const h  = Math.round((w / vw) * vh);   // keep true aspect ratio

        const canvas  = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL('image/jpeg', 0.62));
      } catch {
        finish('');
      }
    };

    video.onerror = () => finish('');
  });
}
