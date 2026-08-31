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

export function setMedia(projectId: string, entry: MediaEntry) {
  const prev = store.get(projectId);
  if (prev) URL.revokeObjectURL(prev.objectUrl);
  store.set(projectId, entry);
}

export function getMedia(projectId: string): MediaEntry | null {
  return store.get(projectId) ?? null;
}

// ── Aspect ratio string from pixel dimensions ─────────────────────────────────

export function calcAspectRatio(w: number, h: number): string {
  if (!w || !h) return '16:9';
  const r = w / h;
  if (r > 1.7)  return '16:9';
  if (r > 1.2)  return '4:3';
  if (r > 0.95) return '1:1';
  if (r > 0.5)  return '4:5';
  return '9:16';
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
