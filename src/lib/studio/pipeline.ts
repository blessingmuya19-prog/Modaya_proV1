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

/**
 * A single "reference match" number for the result screen. It is deliberately
 * grounded in measurable properties of the generated edit versus the style
 * profile — never a fabricated confidence. Each axis is a 0..1 agreement;
 * the result is their mean, scaled to a percentage.
 *
 * Inputs are deliberately primitives so this is trivially testable.
 */
export function referenceMatch(opts: {
  hasReference: boolean;
  /** Cuts per minute of the generated edit. */
  editCutsPerMin: number;
  /** Cuts per minute of the reference. */
  refCutsPerMin: number;
  /** 0..1 fraction of planned cuts that snapped to a measured onset. */
  beatSnapRate: number;
  /** 0..1 how often the reference used push-ins. */
  refPunchInRate: number;
  /** 0..1 how often the generated edit uses push-ins. */
  editPunchInRate: number;
  /** Whether captions were requested and present. */
  captionsWanted: boolean;
  captionsPresent: boolean;
}): number {
  if (!opts.hasReference) return 0;

  // Pace agreement: closer cuts/min = better, on a ratio with a floor so a
  // small absolute difference doesn't read as zero.
  const pace = opts.refCutsPerMin > 0
    ? clamp01(1 - Math.abs(opts.editCutsPerMin - opts.refCutsPerMin) / Math.max(opts.refCutsPerMin, 1))
    : 1;
  const punch = 1 - Math.abs(clamp01(opts.editPunchInRate) - clamp01(opts.refPunchInRate));
  const captions = !opts.captionsWanted || opts.captionsPresent ? 1 : 0;
  const rhythm = clamp01(opts.beatSnapRate);

  const mean = (pace + punch + captions + rhythm) / 4;
  return Math.round(mean * 100);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * The user-facing framing of a finished run. Pure string helper so the result
 * screen and any chat reply stay consistent.
 */
export function resultHeadline(opts: { hasReference: boolean; match: number; durationS: number }): string {
  const mm = Math.floor(opts.durationS / 60);
  const ss = String(Math.floor(opts.durationS % 60)).padStart(2, '0');
  const length = mm > 0 ? `${mm}:${ss}` : `0:${ss}`;
  if (!opts.hasReference) return `Your edit is ready — ${length}.`;
  return `Your edit is ready — ${length}, ${opts.match}% match to your reference.`;
}
