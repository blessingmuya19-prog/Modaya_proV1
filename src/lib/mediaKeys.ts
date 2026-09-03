/**
 * Media object keys — shared by the server object store and the browser
 * client so both derive identical paths. Isomorphic: no Node imports.
 *
 * Keys are namespaced per project:
 *   `<projectId>/main.<ext>`        the source footage
 *   `<projectId>/ref/<n>.<ext>`     reference videos
 *   `<projectId>/broll/<n>.<ext>`   B-roll library clips (cutaway-only uploads)
 *   `<projectId>/out.<ext>`         a rendered export
 */

export type MediaRole = 'main' | 'ref' | 'broll' | 'out';

export function extFromFilename(name: string, fallback = 'mp4'): string {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(name);
  return m ? m[1].toLowerCase() : fallback;
}

export function mimeFromExt(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  switch (clean) {
    case 'mp4': case 'm4v': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mov': case 'qt': return 'video/quicktime';
    case 'mkv': return 'video/x-matroska';
    case 'avi': return 'video/x-msvideo';
    case 'ogv': return 'video/ogg';
    case 'ts': return 'video/mp2t';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'm4a': case 'aac': return 'audio/aac';
    case 'ogg': case 'opus': return 'audio/ogg';
    case 'flac': return 'audio/flac';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

export function mediaKey(projectId: string, role: MediaRole, ext: string, index?: number): string {
  const safeProject = projectId.replace(/[^A-Za-z0-9_-]/g, '');
  const safeExt = (ext.replace(/[^A-Za-z0-9]/g, '') || 'bin').toLowerCase();
  if (role === 'ref')   return `${safeProject}/ref/${index ?? 0}.${safeExt}`;
  if (role === 'broll') return `${safeProject}/broll/${index ?? 0}.${safeExt}`;
  if (role === 'out')   return `${safeProject}/out.${safeExt}`;
  return `${safeProject}/main.${safeExt}`;
}

/** The URL path (relative to the site origin) a media object is served at. */
export function mediaPath(projectId: string, role: MediaRole, ext: string, index?: number): string {
  const key = mediaKey(projectId, role, ext, index);
  // /api/media/<projectId>/<rest…>
  const slash = key.indexOf('/');
  return `/api/media/${key.slice(0, slash)}/${key.slice(slash + 1)}`;
}
