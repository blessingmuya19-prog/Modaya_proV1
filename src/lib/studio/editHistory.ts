/**
 * AI Edit Timeline History, Version Branching & Visual Diff Snapshot Engine.
 *
 * Computes structural deltas between edit versions (cuts added/removed, runtime differences,
 * pacing changes, caption restyling, color grade shifts) and provides branch management.
 */

import type { EditVersion, VersionRecipe } from './versions';
import type { EditorClip } from '@/components/editor/EditorShell';
import type { Effects } from '../render/sequence';

export interface ClipDelta {
  type: 'added' | 'removed' | 'trimmed' | 'modified';
  clipId: string;
  kind: string;
  label?: string;
  timeDiffS?: number;
  description: string;
}

export interface VersionDiffSummary {
  fromVersionId: string;
  toVersionId: string;
  durationDeltaS: number;
  cutsDelta: number;
  pacingSummary: string;
  deltas: ClipDelta[];
  colorGradeChanged: boolean;
  audioMixChanged: boolean;
  captionsChanged: boolean;
}

export interface EditBranch {
  id: string;
  name: string;
  baseVersionId: string;
  headVersionId: string;
  createdAt: string;
  tags: string[];
}

/**
 * Compare two sets of timeline clips and produce a structural diff summary.
 */
export function diffTimelineClips(
  clipsA: EditorClip[],
  clipsB: EditorClip[],
  fromId = 'v1',
  toId = 'v2',
): VersionDiffSummary {
  const durA = clipsA.reduce((max, c) => Math.max(max, c.endS), 0);
  const durB = clipsB.reduce((max, c) => Math.max(max, c.endS), 0);
  const durationDeltaS = Math.round((durB - durA) * 100) / 100;

  const videoA = clipsA.filter(c => c.type === 'video');
  const videoB = clipsB.filter(c => c.type === 'video');
  const cutsDelta = videoB.length - videoA.length;

  const avgCutA = videoA.length ? durA / videoA.length : 0;
  const avgCutB = videoB.length ? durB / videoB.length : 0;
  let pacingSummary = 'Pacing unchanged';
  if (avgCutB < avgCutA * 0.9) {
    pacingSummary = `Faster pace (avg cut: ${avgCutB.toFixed(1)}s vs ${avgCutA.toFixed(1)}s)`;
  } else if (avgCutB > avgCutA * 1.1) {
    pacingSummary = `Slower pace (avg cut: ${avgCutB.toFixed(1)}s vs ${avgCutA.toFixed(1)}s)`;
  }

  const mapA = new Map(clipsA.map(c => [c.id, c]));
  const mapB = new Map(clipsB.map(c => [c.id, c]));
  const deltas: ClipDelta[] = [];

  // Detect removed or trimmed clips
  for (const [id, cA] of mapA.entries()) {
    const cB = mapB.get(id);
    if (!cB) {
      deltas.push({
        type: 'removed',
        clipId: id,
        kind: cA.type,
        label: cA.label,
        description: `Removed ${cA.type} clip "${cA.label || id}" (${cA.startS.toFixed(1)}s – ${cA.endS.toFixed(1)}s)`,
      });
    } else {
      const startDiff = Math.abs(cB.startS - cA.startS);
      const endDiff = Math.abs(cB.endS - cA.endS);
      if (startDiff > 0.05 || endDiff > 0.05) {
        const lenA = cA.endS - cA.startS;
        const lenB = cB.endS - cB.startS;
        deltas.push({
          type: 'trimmed',
          clipId: id,
          kind: cA.type,
          label: cA.label,
          timeDiffS: Math.round((lenB - lenA) * 100) / 100,
          description: `Trimmed "${cA.label || id}" by ${(lenB - lenA).toFixed(1)}s`,
        });
      }
    }
  }

  // Detect newly added clips
  for (const [id, cB] of mapB.entries()) {
    if (!mapA.has(id)) {
      deltas.push({
        type: 'added',
        clipId: id,
        kind: cB.type,
        label: cB.label,
        description: `Added ${cB.type} clip "${cB.label || id}" at ${cB.startS.toFixed(1)}s`,
      });
    }
  }

  const subsA = clipsA.filter(c => c.type === 'subtitle' || c.trackId === 'subs');
  const subsB = clipsB.filter(c => c.type === 'subtitle' || c.trackId === 'subs');
  const captionsChanged = subsA.length !== subsB.length ||
    JSON.stringify(subsA.map(s => s.textStyle)) !== JSON.stringify(subsB.map(s => s.textStyle));

  return {
    fromVersionId: fromId,
    toVersionId: toId,
    durationDeltaS,
    cutsDelta,
    pacingSummary,
    deltas,
    colorGradeChanged: false,
    audioMixChanged: false,
    captionsChanged,
  };
}

/**
 * Compare two EditVersion records and summarize differences in creative intent.
 */
export function diffEditVersions(vA: EditVersion, vB: EditVersion): VersionDiffSummary {
  const durDelta = (vB.stats?.durationS ?? 0) - (vA.stats?.durationS ?? 0);
  const cutsDelta = (vB.stats?.cuts ?? 0) - (vA.stats?.cuts ?? 0);

  const profA = vA.recipe.profile;
  const profB = vB.recipe.profile;

  const deltas: ClipDelta[] = [];

  if (profB.cutsPerMin !== profA.cutsPerMin) {
    deltas.push({
      type: 'modified',
      clipId: 'pacing',
      kind: 'tempo',
      description: `Target cut rate changed to ${Math.round(profB.cutsPerMin)} cuts/min (was ${Math.round(profA.cutsPerMin)})`,
    });
  }

  if (profB.captions.present !== profA.captions.present || profB.captions.position !== profA.captions.position) {
    deltas.push({
      type: 'modified',
      clipId: 'captions',
      kind: 'text',
      description: `Captions updated: ${profB.captions.present ? `Enabled (${profB.captions.position})` : 'Disabled'}`,
    });
  }

  let pacingSummary = 'Pacing unchanged';
  if (profB.cutsPerMin > profA.cutsPerMin * 1.1) {
    pacingSummary = `Faster pace (+${Math.round(profB.cutsPerMin - profA.cutsPerMin)} cuts/min)`;
  } else if (profB.cutsPerMin < profA.cutsPerMin * 0.9) {
    pacingSummary = `Slower pace (${Math.round(profB.cutsPerMin - profA.cutsPerMin)} cuts/min)`;
  }

  return {
    fromVersionId: vA.id,
    toVersionId: vB.id,
    durationDeltaS: Math.round(durDelta * 10) / 10,
    cutsDelta,
    pacingSummary,
    deltas,
    colorGradeChanged: JSON.stringify(profA.grade) !== JSON.stringify(profB.grade),
    audioMixChanged: false,
    captionsChanged: JSON.stringify(profA.captions) !== JSON.stringify(profB.captions),
  };
}

/**
 * Generate a deterministic fingerprint hash of an edit recipe for deduplication.
 */
export function fingerprintRecipe(recipe: VersionRecipe): string {
  const payload = JSON.stringify({
    cutsPerMin: recipe.profile.cutsPerMin,
    pace: recipe.profile.pace,
    seed: recipe.seed,
    mode: recipe.mode,
    targetSeconds: recipe.targetSeconds,
    grade: recipe.profile.grade,
    captions: recipe.profile.captions,
    note: recipe.note,
  });

  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}
