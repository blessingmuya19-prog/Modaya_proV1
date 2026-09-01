/**
 * Client-side video / media store.
 * Keeps a Map of projectId → MediaEntry so the editor can play back the
 * original file without needing server-side storage.
 *
 * Object URLs are valid for the lifetime of the tab. On a fresh tab / hard
 * refresh the URL is gone — the editor shows a graceful fallback.
 */

export interface MediaEntry {
  objectUrl:   string;
  mimeType:    string;       // e.g. 'video/mp4', 'audio/mp3', 'image/png'
  mediaType:   'video' | 'audio' | 'image';
  aspectRatio: string;       // auto-detected: '16:9' | '9:16' | '1:1' | '4:3' | 'custom'
  width:       number;
  height:      number;
  durationS:   number;
  filename:    string;
}

const store = new Map<string, MediaEntry>();

/* Components that read the store need to know when media arrives late — e.g.
   after being rehydrated from IndexedDB on a fresh page load. */
type Listener = (projectId: string) => void;
const listeners = new Set<Listener>();

export function subscribeMedia(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setMedia(projectId: string, entry: MediaEntry) {
  const prev = store.get(projectId);
  if (prev && prev.objectUrl !== entry.objectUrl) URL.revokeObjectURL(prev.objectUrl);
  store.set(projectId, entry);
  listeners.forEach(fn => { try { fn(projectId); } catch { /* ignore */ } });
}

export function getMedia(projectId: string): MediaEntry | null {
  return store.get(projectId) ?? null;
}

// ── Aspect ratio string from pixel dimensions ─────────────────────────────────

/** Standard ratios we snap to when the video is close enough to one. */
const KNOWN_RATIOS: { label: string; value: number }[] = [
  { label: '21:9', value: 21 / 9 },   // 2.333 — ultrawide / cinematic
  { label: '16:9', value: 16 / 9 },   // 1.778 — landscape video
  { label: '3:2',  value: 3 / 2  },   // 1.5   — photo / DSLR
  { label: '4:3',  value: 4 / 3  },   // 1.333 — classic TV
  { label: '1:1',  value: 1      },   // 1.0   — square
  { label: '4:5',  value: 4 / 5  },   // 0.8   — Instagram portrait
  { label: '9:16', value: 9 / 16 },   // 0.5625 — Reels / TikTok / Shorts
];

/** Greatest common divisor, for reducing odd dimensions to an exact ratio. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Detect the aspect ratio label for a set of pixel dimensions.
 *
 * Snaps to the nearest standard ratio when within 3.5% (measured on a log
 * scale so portrait and landscape are treated symmetrically). Anything
 * further away is reported as its own exact reduced ratio rather than being
 * forced into the wrong bucket.
 */
export function calcAspectRatio(w: number, h: number): string {
  if (!w || !h) return '16:9';

  const r = w / h;

  // Nearest standard ratio by relative (log) distance
  let best = KNOWN_RATIOS[0];
  let bestDist = Infinity;
  for (const candidate of KNOWN_RATIOS) {
    const dist = Math.abs(Math.log(r / candidate.value));
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }

  // log(1.035) ≈ 0.0344 — i.e. within ~3.5% of a standard ratio
  if (bestDist <= 0.0344) return best.label;

  // Non-standard: report the true reduced ratio (e.g. "1920:817")
  const d = gcd(Math.round(w), Math.round(h)) || 1;
  return `${Math.round(w) / d}:${Math.round(h) / d}`;
}

// ── Media type from MIME ──────────────────────────────────────────────────────

export function getMediaType(mimeType: string): 'video' | 'audio' | 'image' {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'image';
}

// ── Analyse any media file — returns a complete MediaEntry ────────────────────

export function analyseFile(file: File): Promise<Omit<MediaEntry, 'objectUrl'>> {
  const mimeType  = file.type || 'video/mp4';
  const mediaType = getMediaType(mimeType);
  const url       = URL.createObjectURL(file);

  return new Promise(resolve => {
    const done = (extra: Partial<MediaEntry>) => {
      URL.revokeObjectURL(url);
      resolve({
        mimeType,
        mediaType,
        aspectRatio: calcAspectRatio(extra.width ?? 0, extra.height ?? 0),
        width:       extra.width    ?? 0,
        height:      extra.height   ?? 0,
        durationS:   extra.durationS ?? 0,
        filename:    file.name,
      });
    };

    if (mediaType === 'video') {
      const el   = document.createElement('video');
      el.preload = 'metadata';
      el.src     = url;
      el.onloadedmetadata = () => {
        done({
          width:     el.videoWidth,
          height:    el.videoHeight,
          durationS: isFinite(el.duration) ? Math.round(el.duration) : 0,
        });
      };
      el.onerror = () => done({});

    } else if (mediaType === 'audio') {
      const el   = document.createElement('audio');
      el.preload = 'metadata';
      el.src     = url;
      el.onloadedmetadata = () => done({ durationS: isFinite(el.duration) ? Math.round(el.duration) : 0 });
      el.onerror = () => done({});

    } else {
      // image
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    }
  });
}
