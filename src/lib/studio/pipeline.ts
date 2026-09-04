/**
 * Studio pipeline — the guided "drop two videos and let Modaya do the work"
 * experience.
 *
 * The product rule: the user supplies footage (and optionally a reference
 * video) and describes nothing technical. Modaya runs the editing engine and
 * presents it as a fixed list of *named creative stages* the user watches
 * complete — never timelines, codecs or parameters.
 *
 * This module is the pure, testable spine of that flow: the ordered stages,
 * their completion from the signals each real step produces, and a
 * "reference match" score. All the heavy work (audio analysis, style
 * profiling, edit-plan generation, rendering) lives in the existing engine
 * modules and is invoked by the UI; here we only describe and sequence it.
 */

export type StageId =
  | 'understand-source'
  | 'learn-reference'
  | 'find-moments'
  | 'match-pacing'
  | 'captions'
  | 'build-edit'
  | 'render';

export interface StudioStage {
  id: StageId;
  /** What the user sees — outcomes, not operations. */
  label: string;
  /** Whether this stage needs a reference video to be meaningful. */
  needsReference: boolean;
}

/**
 * The full creative pipeline in the order Modaya presents it. Without a
 * reference the reference-specific stages are reported as skipped rather than
 * shown as failures.
 */
export const STUDIO_STAGES: StudioStage[] = [
  { id: 'understand-source', label: 'Understanding your footage',        needsReference: false },
  { id: 'learn-reference',    label: 'Learning your reference',          needsReference: true  },
  { id: 'find-moments',      label: 'Finding the strongest moments',    needsReference: false },
  { id: 'match-pacing',      label: 'Matching reference pacing & cuts', needsReference: true  },
  { id: 'captions',          label: 'Adding captions & emphasis',       needsReference: false },
  { id: 'build-edit',        label: 'Building the edit',                needsReference: false },
  { id: 'render',            label: 'Rendering',                        needsReference: false },
];

export type StageStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface StageState {
  id: StageId;
  label: string;
  status: StageStatus;
}

/**
 * Resolve which stages apply to a given run. A stage is skipped only when it
 * needs a reference and none was provided; everything else runs.
 */
export function stagesForRun(hasReference: boolean): StageState[] {
  return STUDIO_STAGES.map(s => ({
    id: s.id,
    label: s.label,
    status: (!hasReference && s.needsReference) ? 'skipped' : 'pending',
  }));
}

/**
 * Mark one stage active. Deterministic and side-effect free so the UI can
 * call it as each real step starts.
 */
export function markActive(stages: StageState[], id: StageId): StageState[] {
  return stages.map(s =>
    s.id === id && s.status === 'pending' ? { ...s, status: 'active' } : s,
  );
}

/** Mark a stage complete (a skipped stage stays skipped). */
export function markDone(stages: StageState[], id: StageId): StageState[] {
  return stages.map(s =>
    s.id === id && s.status !== 'skipped' ? { ...s, status: 'done' } : s,
  );
}

/** 0..1 across the stages that actually run (skipped ones don't count). */
export function pipelineProgress(stages: StageState[]): number {
  const runnable = stages.filter(s => s.status !== 'skipped');
  if (!runnable.length) return 1;
  const done = runnable.filter(s => s.status === 'done').length;
  return done / runnable.length;
}

/** A colour grade, relative to neutral (1, 1, 1, 0). */
export interface GradeLike {
  brightness: number; contrast: number; saturation: number; warmth: number;
}

/** One axis of the reference match: what the reference specified and how
 *  closely the generated edit follows it, 0..1. */
export interface MatchAxis { label: string; value: number }

/** Everything the score was built from — so the UI can say WHAT matched. */
export interface ReferenceMatchDetail {
  score: number;
  axes: MatchAxis[];
}

/** 0..1 how close two grades are, on human-ish scales: ±0.35 on the
 *  brightness/contrast multipliers or ±0.55 saturation is a full miss,
 *  ±0.8 warmth is a full miss. */
export function gradeAgreement(a: GradeLike, b: GradeLike): number {
  const miss =
    Math.abs(a.brightness - b.brightness) / 0.35 +
    Math.abs(a.contrast   - b.contrast)   / 0.35 +
    Math.abs(a.saturation - b.saturation) / 0.55 +
    Math.abs(a.warmth     - b.warmth)     / 0.8;
  return clamp01(1 - miss / 4);
}

/** Is this grade meaningfully different from neutral? A neutral reference
 *  (nothing to push) must not be able to carry the match score. The profiler
 *  floors contrast at ~1.2 and saturation at ~1.25, so anything a real
 *  reference produced clears these thresholds. */
export function gradeDistinct(g: GradeLike): boolean {
  return Math.abs(g.brightness - 1) > 0.04 ||
         Math.abs(g.contrast   - 1) > 0.09 ||
         Math.abs(g.saturation - 1) > 0.12 ||
         Math.abs(g.warmth)          > 0.03;
}

/** Fraction of the edit's shot boundaries (clip starts/ends) that land on a
 *  measured onset within tolerance. Real measurement — beat-sync is never
 *  assumed, only counted. */
export function measuredBeatSnapRate(
  clips: { startS: number; endS: number }[],
  onsets: number[],
  toleranceS = 0.18,
): number {
  if (!clips.length || !onsets.length) return 0;
  const seen = new Set<number>();
  const boundaries: number[] = [];
  for (const c of clips) {
    for (const t of [c.startS, c.endS]) {
      const k = Math.round(t * 20);
      if (!seen.has(k)) { seen.add(k); boundaries.push(t); }
    }
  }
  if (!boundaries.length) return 0;
  const hits = boundaries.filter(t =>
    onsets.some(o => Math.abs(o - t) <= toleranceS)).length;
  return clamp01(hits / boundaries.length);
}

/**
 * A single "reference match" number for the result screen. It is deliberately
 * grounded in measurable properties of the generated edit versus the style
 * profile — never a fabricated confidence, and never a reward for something
 * the reference did not specify.
 *
 * Each axis is 0..1 agreement:
 *   pacing     — reference must have a measured cuts/min (0 means "unknown",
 *                not "same"). Edit pace is compared by ratio.
 *   push-ins   — counted only when the reference actually uses them. Two
 *                edits that both never push in agree about nothing.
 *   captions   — counted only when captions were wanted.
 *   beat-sync  — counted only when the reference is verifiably beat-synced;
 *                the snap rate is MEASURED from the edit's shot boundaries
 *                against real onsets, never assumed.
 *   colour     — counted whenever the reference grade is distinct from
 *                neutral; agreement is the distance between the reference
 *                grade and the grade the edit actually applies.
 * The score is the mean over the axes the reference specified. An edit that
 * matched nothing scores 0; an edit that matched only the colour grade can
 * never claim a pacing or beat-sync it did not do.
 */
export function referenceMatchDetail(opts: {
  hasReference: boolean;
  /** Cuts per minute of the generated edit. */
  editCutsPerMin: number;
  /** Cuts per minute of the reference. 0 = the reference did not specify. */
  refCutsPerMin: number;
  /** 0..1 fraction of planned cuts that snapped to a measured onset. */
  beatSnapRate: number;
  /** Whether the reference is verifiably beat-synced. */
  refBeatSynced?: boolean;
  /** 0..1 how often the reference used push-ins. */
  refPunchInRate: number;
  /** 0..1 how often the generated edit uses push-ins. */
  editPunchInRate: number;
  /** Whether captions were requested and present. */
  captionsWanted: boolean;
  captionsPresent: boolean;
  /** Reference grade, when available — gates the colour axis. */
  refGrade?: GradeLike;
  /** 0..1 agreement of the applied grade with the reference grade. */
  gradeAgreement?: number;
}): ReferenceMatchDetail {
  if (!opts.hasReference) return { score: 0, axes: [] };

  const axes: MatchAxis[] = [];

  if (opts.refCutsPerMin > 0) {
    const pace = opts.refCutsPerMin > 0
      ? clamp01(1 - Math.abs(opts.editCutsPerMin - opts.refCutsPerMin) / Math.max(opts.refCutsPerMin, 1))
      : 1;
    axes.push({ label: 'pacing', value: pace });
  }

  if (opts.refPunchInRate >= 0.08) {
    const punch = 1 - Math.abs(clamp01(opts.editPunchInRate) - clamp01(opts.refPunchInRate));
    axes.push({ label: 'push-ins', value: punch });
  }

  if (opts.captionsWanted) {
    axes.push({ label: 'captions', value: opts.captionsPresent ? 1 : 0 });
  }

  if (opts.refBeatSynced) {
    axes.push({ label: 'beat-sync', value: clamp01(opts.beatSnapRate) });
  }

  if (opts.refGrade && gradeDistinct(opts.refGrade)) {
    axes.push({ label: 'colour grade', value: clamp01(opts.gradeAgreement ?? 1) });
  }

  const score = axes.length
    ? Math.round(axes.reduce((a, x) => a + x.value, 0) / axes.length * 100)
    : 0;
  return { score, axes };
}

export function referenceMatch(opts: Parameters<typeof referenceMatchDetail>[0]): number {
  return referenceMatchDetail(opts).score;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Human names for the axes, for the headline and for what the run claims
 *  it matched. */
export const MATCH_AXIS_LABELS: Record<string, string> = {
  'pacing': 'pacing', 'push-ins': 'push-ins', 'captions': 'captions',
  'beat-sync': 'beat-synced cuts', 'colour grade': 'colour grade',
};

/**
 * The user-facing framing of a finished run. Pure string helper so the result
 * screen and any chat reply stay consistent.
 */
export function resultHeadline(opts: {
  hasReference: boolean; match: number; durationS: number;
  /** Which axes the score came from — shown so "93% match" never hides the
   *  fact that only the colour grade was measurable. */
  coverage?: string[];
}): string {
  const mm = Math.floor(opts.durationS / 60);
  const ss = String(Math.floor(opts.durationS % 60)).padStart(2, '0');
  const length = mm > 0 ? `${mm}:${ss}` : `0:${ss}`;
  if (!opts.hasReference) return `Your edit is ready — ${length}.`;
  const cover = (opts.coverage ?? []).filter(Boolean);
  const scope = cover.length
    ? ` (${cover.join(', ')})`
    : '';
  return `Your edit is ready — ${length}, ${opts.match}% match to your reference${scope}.`;
}
