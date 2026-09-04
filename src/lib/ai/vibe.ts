/**
 * Human intuition — the Style Interpreter Bias / creative brief.
 *
 * A reference profile is a measurement; the DIRECTOR's taste is a separate
 * signal. Two sliders carry it through the whole pipeline as prompt
 * variables AND deterministic plan adjustments:
 *
 *   aggression 0..1  — how hard the cut rhythm is pushed. 0 = smooth,
 *                      cinematic; 1 = jump-cuts. Scaled onto the reference's
 *                      own cadence, never an independent formula.
 *   literalism 0..1  — how much of the spoken word becomes on-screen text.
 *                      0 = only key concepts; 1 = every spoken line.
 *
 * Defaults sit at 0.5 (the reference as measured). Deterministic and
 * clamp-bounded, so a drag of a slider can never produce a nonsense plan.
 */
import type { StyleProfile } from './styleProfile';

export interface VibeParams {
  /** 0..1 cut-pressure multiplier; 0.5 = as measured. */
  aggression: number;
  /** 0..1 caption coverage; 0.5 = as measured. */
  literalism: number;
}

export const DEFAULT_VIBE: VibeParams = { aggression: 0.5, literalism: 0.5 };

export function clampVibe(v: Partial<VibeParams> | undefined | null): VibeParams {
  const c = (x: unknown, d: number) =>
    typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(1, x)) : d;
  return {
    aggression: c(v?.aggression, DEFAULT_VIBE.aggression),
    literalism: c(v?.literalism, DEFAULT_VIBE.literalism),
  };
}

/** 0..1 (0.5 = neutral) → a centered multiplier: 0.5 stays exactly as
 *  measured (1.0); the extremes are ±40%, a brief not a rewrite. */
export function vibeMultiplier(v: number): number {
  return 0.6 + v * 0.8;   // 0.5 → 1.0 as measured; 0 → 0.6; 1 → 1.4
}

/** The profile as the director's brief would set it: pace scaled by
 *  aggression, caption emphasis by literalism. Returns the adjusted profile
 *  plus a one-line note of what moved. */
export function applyVibe(
  profile: StyleProfile,
  vibe: VibeParams,
): { profile: StyleProfile; note: string } {
  const agg = vibeMultiplier(vibe.aggression);
  const lit = vibeMultiplier(vibe.literalism);
  const cutsPerMin = profile.cutsPerMin > 0
    ? Number((profile.cutsPerMin * agg).toFixed(1))
    : profile.cutsPerMin;
  const shotMeanS = profile.shotMeanS > 0
    ? Number((profile.shotMeanS / agg).toFixed(2))
    : profile.shotMeanS;
  const emphasis = Number(Math.max(0, Math.min(1, (profile.captions.emphasis ?? 0.5) * lit)).toFixed(2));
  const notes: string[] = [];
  if (Math.abs(agg - 1) > 0.04) notes.push(vibe.aggression > 0.5 ? 'tighter cut rhythm' : 'smoother, longer shots');
  if (Math.abs(lit - 1) > 0.04) notes.push(vibe.literalism > 0.5 ? 'more captions' : 'only key captions');
  return {
    profile: {
      ...profile,
      cutsPerMin,
      shotMeanS,
      shotMedianS: shotMeanS > 0 ? Number((shotMeanS * (profile.shotMedianS / profile.shotMeanS)).toFixed(2)) : profile.shotMedianS,
      captions: { ...profile.captions, emphasis },
    },
    note: notes.length ? notes.join(', ') : 'as measured',
  };
}

/** The prompt variables — the exact "creative brief" the advisor blueprint
 *  describes, appended to the measured rule card. */
export function vibePromptLine(v: VibeParams): string {
  const pacing = v.aggression <= 0.33 ? 'smooth cinematic cuts'
    : v.aggression <= 0.66 ? 'reference pacing as measured'
    : 'aggressive jump-cut energy';
  const text = v.literalism <= 0.33 ? 'only key concepts get text'
    : v.literalism <= 0.66 ? 'captions where the reference captions'
    : 'every spoken line captioned';
  return `CREATIVE BRIEF (director's taste): ${pacing}; ${text}. ` +
    `Set AI pacing weight ${v.aggression.toFixed(2)}, caption literalism ${v.literalism.toFixed(2)}.`;
}
