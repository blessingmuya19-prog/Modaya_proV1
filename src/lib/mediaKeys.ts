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
