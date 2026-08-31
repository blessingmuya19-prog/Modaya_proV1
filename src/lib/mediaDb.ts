/**
 * Persistent, client-side media storage (IndexedDB).
 *
 * The in-memory Map in videoStore.ts only survives while the tab lives: on a
 * refresh — or when a project is opened later from the dashboard — the object
 * URL is gone. The editor then has no video at all, which is why the timeline
 * showed no frames and playback fell back to a synthetic clock.
 *
 * Here we keep the actual file bytes plus the extracted frame strip in
 * IndexedDB, keyed by project id, so reopening a project restores real
 * playback instantly and the timeline strip paints from cache.
 */

const DB_NAME    = 'modaya-media';
const DB_VERSION = 1;
const STORE_FILE = 'files';
const STORE_FRAMES = 'frames';

/** Don't try to persist enormous files — IndexedDB writes would stall the tab. */
const MAX_PERSIST_BYTES = 600 * 1024 * 1024;   // 600 MB

export interface StoredMedia {
  blob:        Blob;
  mimeType:    string;
  mediaType:   'video' | 'audio' | 'image';
  aspectRatio: string;
  width:       number;
  height:      number;
  durationS:   number;
  filename:    string;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILE))   db.createObjectStore(STORE_FILE);
      if (!db.objectStoreNames.contains(STORE_FRAMES)) db.createObjectStore(STORE_FRAMES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode,
               run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(db => {
    if (!db) return null;
    return new Promise<T | null>(resolve => {
      let req: IDBRequest<T>;
      try {
        req = run(db.transaction(store, mode).objectStore(store));
      } catch {
        resolve(null);
        return;
      }
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);       // quota / private mode — degrade quietly
    });
  });
}

/* ─────────────── media file ─────────────── */

export async function saveMediaFile(projectId: string, file: Blob, meta: Omit<StoredMedia, 'blob'>) {
  if (!projectId || !file || file.size > MAX_PERSIST_BYTES) return;
  await tx(STORE_FILE, 'readwrite', s => s.put({ ...meta, blob: file }, projectId));
}

export async function loadMediaFile(projectId: string): Promise<StoredMedia | null> {
  if (!projectId) return null;
  const rec = await tx<StoredMedia>(STORE_FILE, 'readonly', s => s.get(projectId));
  return rec && rec.blob ? rec : null;
}

export async function deleteMediaFile(projectId: string) {
  await tx(STORE_FILE, 'readwrite', s => s.delete(projectId) as unknown as IDBRequest<undefined>);
}

/* ─────────────── frame strip cache ─────────────── */

interface FrameRecord { frames: string[]; count: number }

export async function saveFrames(projectId: string, frames: string[]) {
  if (!projectId || !frames.length) return;
  await tx(STORE_FRAMES, 'readwrite',
    s => s.put({ frames, count: frames.length } as FrameRecord, projectId));
}

export async function loadFrames(projectId: string): Promise<string[]> {
  if (!projectId) return [];
  const rec = await tx<FrameRecord>(STORE_FRAMES, 'readonly', s => s.get(projectId));
  return rec?.frames?.length ? rec.frames : [];
}
