/**
 * Edit versions — the project never resets and never overwrites a previous
 * cut. Every time Modaya produces an edit (the first one, a regeneration, or a
 * refinement) it is saved as a numbered version. The user can step back to an
 * earlier one and keep iterating; nothing and no reference/instructions are
 * lost.
 *
 * A version stores the *deterministic recipe* (the StyleProfile + seed + mode +
 * source/context) rather than a rendered video, because composeStudioPlan is
 * pure — the same recipe rebuilds the identical plan on any device. Versions
 * persist per project in IndexedDB (and, when durable storage is configured,
 * the list can travel with the project).
 */
import type { StyleProfile } from '../ai/styleProfile';
import type { PlannedShot } from './editPlan';
import { saveRecord, loadRecord } from '../mediaDb';

/** Everything needed to rebuild one exact cut. */
export interface VersionRecipe {
  profile:      StyleProfile;
  seed:         number;
  mode?:        'short' | 'full';
  targetSeconds?: number;
  hasRef:       boolean;
  refName?:     string | null;
  /** The user's free-text instruction for this version (the ask). */
  note?:        string;
}

/** A fully-rendered timeline snapshot, for versions produced by the Pro AI
 *  (its edits do not replay through composeStudioPlan, so the recipe alone is
 *  not enough to restore them exactly). */
export interface VersionSnapshot {
  clips: PlannedShot[];
  durationS: number;
  frame: { width: number; height: number; ratio: '9:16' | '1:1' | '16:9' };
}

export interface EditVersion {
  id:      string;        // `v<number>`
  number:  number;
  label:   string;        // short human description, e.g. "More cinematic"
  createdAt: string;      // ISO
  recipe:  VersionRecipe;
  /** Headline stats captured when this version was built. */
  stats?: {
    durationS: number;
    cuts:     number;
    match:    number;      // reference match %, 0 without reference
  };
  /** Present when the Pro Editor AI produced this version's timeline. */
  snapshot?: VersionSnapshot;
}

const STORE = 'modaya-versions';

export async function loadVersions(projectId: string): Promise<EditVersion[]> {
  const rec = await loadRecord<{ versions: EditVersion[] }>(key(projectId));
  return rec?.versions ?? [];
}

export async function saveVersions(projectId: string, versions: EditVersion[]): Promise<void> {
  await saveRecord(key(projectId), { versions });
}

/** Append a new version and mark it current. Returns the new list + version. */
export async function addVersion(
  projectId: string,
  recipe: VersionRecipe,
  stats: EditVersion['stats'],
  snapshot?: VersionSnapshot,
): Promise<{ versions: EditVersion[]; version: EditVersion }> {
  const existing = await loadVersions(projectId);
  const number = existing.length ? existing[existing.length - 1].number + 1 : 1;
  const version: EditVersion = {
    id: `v${number}`,
    number,
    label: recipe.note ? shortLabel(recipe.note) : (number === 1 ? 'Original' : `Version ${number}`),
    createdAt: new Date().toISOString(),
    recipe,
    stats,
    ...(snapshot ? { snapshot } : {}),
  };
  const versions = [...existing, version];
  await saveVersions(projectId, versions);
  return { versions, version };
}

export async function clearVersions(projectId: string): Promise<void> {
  await saveVersions(projectId, []);
}

/** Turn a full instruction/refinement sentence into a short version label. */
export function shortLabel(text: string, max = 26): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return cap(t);
  return cap(t.slice(0, max - 1).trimEnd()) + '…';
}

function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function key(projectId: string): string { return `${STORE}:${projectId}`; }
