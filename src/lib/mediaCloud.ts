/**
 * Client-side access to the server's durable media store.
 *
 * The browser still keeps footage in IndexedDB (instant tab-refresh recovery);
 * this module adds the durable second copy: footage is PUT to the server after
 * a local save, and a project reopened on a fresh browser/device fetches it
 * back and re-caches it locally. Everything degrades silently — if the server
 * reports no durable storage (read-only serverless host), the app behaves
 * exactly as before, on IndexedDB alone.
 *
 * It is also what gives remote rankers (TwelveLabs Pegasus) a reachable video
 * URL: once the main footage is stored server-side the clips API can mint a
 * signed URL for it.
 */
import { mediaPath, extFromFilename, type MediaRole } from './mediaKeys';
import { type StoredMedia } from './mediaDb';

export interface CloudCapability {
  available: boolean;
  durable: boolean;
  driver: 'fs' | 's3' | 'mem' | 'none';
  maxUploadMb: number;
}

const NO_CAP: CloudCapability = { available: false, durable: false, driver: 'none', maxUploadMb: 0 };

let capCache: Promise<CloudCapability> | null = null;

/** Ask the server once whether durable media storage exists. */
export function getCloudCapability(force = false): Promise<CloudCapability> {
  if (!capCache || force) {
    capCache = fetch('/api/media')
      .then(r => (r.ok ? r.json() : NO_CAP))
      .catch(() => NO_CAP);
  }
  return capCache;
}

/** True only when the server keeps bytes durably (fs or S3/R2) and they'd
 *  still be there on the next visit. */
export async function cloudDurable(): Promise<boolean> {
  const cap = await getCloudCapability();
  return cap.available && cap.durable;
}

/**
 * Upload a media blob to the project's durable store. Best-effort: returns
 * false (never throws) when storage is absent, too small, or the request
 * fails — the local IndexedDB copy always remains the fallback.
 */
export async function uploadProjectMedia(
  projectId: string,
  role: MediaRole,
  file: Blob,
  filename: string,
  index?: number,
): Promise<{ ok: boolean; durable: boolean }> {
  try {
    const cap = await getCloudCapability();
    if (!cap.available) return { ok: false, durable: false };
    const sizeMb = file.size / (1024 * 1024);
    if (cap.maxUploadMb && sizeMb > cap.maxUploadMb) return { ok: false, durable: cap.durable };

    const ext = extFromFilename(filename);
    const res = await fetch(mediaPath(projectId, role, ext, index), {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (!res.ok) return { ok: false, durable: false };
    const data = (await res.json().catch(() => ({}))) as { durable?: boolean };
    return { ok: true, durable: !!data.durable };
  } catch {
    return { ok: false, durable: false };
  }
}

/** Fire-and-forget durable backup of a freshly chosen source file. */
export function backupFootageToCloud(
  projectId: string,
  file: Blob,
  meta: { filename: string },
): void {
  void uploadProjectMedia(projectId, 'main', file, meta.filename).catch(() => {});
}

/** Does the server already hold an object at this path? (Range probe — 0-0.) */
async function cloudObjectExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

export interface ProjectMediaMeta {
  main?: { ext: string };
  refs?: { ext: string }[];
}

/** Fetch the project record's media metadata (extension etc.). */
async function fetchProjectMediaMeta(projectId: string): Promise<ProjectMediaMeta | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.project?.media as ProjectMediaMeta) ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the project's main footage from wherever it durably lives:
 *   1. this browser's IndexedDB (instant), then
 *   2. the server store (fresh device / cleared browser), which is also
 *      re-cached into IndexedDB so subsequent loads are local.
 * Returns null when no copy exists anywhere.
 */
export async function getProjectMedia(projectId: string): Promise<StoredMedia | null> {
  if (!projectId) return null;

  // Local first — IndexedDB is the hot path.
  const { loadMediaFile, saveMediaFile: saveLocal } = await import('./mediaDb');
  const local = await loadMediaFile(projectId);
  if (local) return local;

  // Durable server copy?
  const cap = await getCloudCapability();
  if (!cap.available) return null;
  const meta = await fetchProjectMediaMeta(projectId);
  if (!meta?.main?.ext) return null;

  const url = mediaPath(projectId, 'main', meta.main.ext);
  if (!(await cloudObjectExists(url))) return null;

  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  // We don't have the original pixel/duration metadata on this path; the
  // caller re-derives what it needs from the blob. Cache by extension mime.
  const mimeType = blob.type || `video/${meta.main.ext === 'mov' ? 'quicktime' : meta.main.ext}`;
  const stored: StoredMedia = {
    blob,
    mimeType,
    mediaType: mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'video',
    aspectRatio: '16:9',
    width: 0, height: 0, durationS: 0,
    filename: `footage.${meta.main.ext}`,
  };
  await saveLocal(projectId, blob, {
    mimeType: stored.mimeType, mediaType: stored.mediaType, aspectRatio: stored.aspectRatio,
    width: 0, height: 0, durationS: 0, filename: stored.filename,
  }).catch(() => {});
  return stored;
}
