/**
 * Zooms & transitions — the kinetic layer between shots.
 *
 * The reference analysis speaks in `scale_zoom_115` and "fast slide
 * transition", but an edit is not a zoom unless it ANIMATES. This module is
 * the pure, testable engine of that kinetic layer:
 *
 *   - zoomKeyframesForShot(): a real zoom-in on an emphasis moment — scale
 *     1.0 → target over 0.45s, held on the punchline, settled before the cut.
 *   - transitionForJunction(): the editorial decision — when a reference is
 *     energetic/beat-synced the cut whips; a calm reference dissolves
 *     (crossfade); a continuous source never fakes one.
 *   - transitionProgress / transitionAlpha / transitionTransform: what the
 *     renderer asks per frame.
 *
 * All deterministic, all clamped — a loose input cannot produce a nonsense
 * zoom or an invisible transition.
 */
import {
  getInterpolatedZoom, easeInOutCubic, type ZoomKeyframe, type ZoomEasing,
} from './smartZoom';
import type { Transform } from './sequence';

export type { ZoomKeyframe };
export type TransitionKind = 'crossfade' | 'whip';

export interface TransitionSpec {
  kind:  TransitionKind;
  durS:  number;
}

/** One animated zoom, times in OUTPUT timeline seconds. */
export function zoomKeyframesForShot(
  startS: number,
  endS: number,
  peakS: number,
  targetScale: number,
): ZoomKeyframe[] {
  const span = endS - startS;
  if (span < 0.6) return [];
  const target = Math.max(1.05, Math.min(1.45, targetScale));
  const settle = Math.min(0.35, span * 0.2);
  /* The zoom starts at the peak (the measured emphasis/onset) instead of the
     shot start — that is what makes it a reaction to the moment. */
  const start = Math.max(startS, Math.min(endS - 0.55, peakS));
  const ramp = Math.min(0.45, (endS - start) * 0.4);
  const holdEnd = Math.max(start + ramp + 0.1, endS - settle);
  const easing: ZoomEasing = 'ease_in_out';
  return [
    { time: Number(startS.toFixed(3)), scale: 1, offsetX: 0, offsetY: 0, easing },
    { time: Number(start.toFixed(3)), scale: 1, offsetX: 0, offsetY: 0, easing, duration: 0.05 },
    { time: Number((start + ramp).toFixed(3)), scale: target, offsetX: 0,
      offsetY: Number((-target * 0.02).toFixed(3)), easing, duration: ramp },
    { time: Number(holdEnd.toFixed(3)), scale: target, offsetX: 0, offsetY: 0,
      easing, duration: ramp },
    { time: Number(endS.toFixed(3)), scale: 1, offsetX: 0, offsetY: 0, easing, duration: settle },
  ];
}

/** Scale at a timeline time (1 when no keyframes). */
export function zoomAt(keyframes: ZoomKeyframe[] | undefined, timeS: number): {
  scale: number; offsetX: number; offsetY: number;
} {
  if (!keyframes?.length) return { scale: 1, offsetX: 0, offsetY: 0 };
  return getInterpolatedZoom(keyframes, timeS);
}

/**
 * The transition the reference style calls for at a source jump:
 *   - energetic + beat-synced (or heavy punch-ins) → whip — the cut itself
 *     moves, like a fast slide transition.
 *   - calm / low punch-in → crossfade — a dissolve softens the jump.
 *   - continuous source (no jump) → none — never fake a transition where the
 *     shot simply continues.
 * `decide` is the caller's seeded rand so the same reference always edits the
 * same way.
 */
export function transitionForJunction(
  opts: {
    energy: number;
    beatSynced: boolean;
    punchInRate: number;
    sourceJump: boolean;
    decision: number;   // seeded 0..1
  },
): TransitionSpec | null {
  if (!opts.sourceJump) return null;
  const durS = opts.beatSynced ? 0.22 : 0.35;
  if (opts.energy > 0.55 && (opts.beatSynced || opts.punchInRate > 0.3)) {
    return opts.decision < 0.8 ? { kind: 'whip', durS } : { kind: 'crossfade', durS };
  }
  return opts.decision < 0.35 ? { kind: 'crossfade', durS } : null;
}

/** 0..1 progress of the fade window an incoming clip currently sits in. */
export function transitionProgress(tS: number, inS: number, durS: number): number {
  if (durS <= 0) return 1;
  return Math.max(0, Math.min(1, (tS - inS) / durS));
}

/** Alpha for the incoming (leader) and outgoing (follower) side. */
export function transitionAlpha(kind: TransitionKind, p: number): { lead: number; follow: number } {
  const e = easeInOutCubic(p);
  return { lead: e, follow: 1 - e };
}

/** Blend a transform during a whip: incoming slides/zooms from the side into
 *  place; outgoing recoils the other way. Crossfades keep the framing. */
export function transitionTransform(
  kind: TransitionKind, tr: Transform, p: number, side: 'lead' | 'follow',
): Transform {
  if (kind !== 'whip' || p <= 0 || p >= 1) return tr;
  const e = easeInOutCubic(p);
  const dir = side === 'lead' ? -1 : 1;              // incoming from left, outgoing to right
  const slide = 0.14 * (1 - e) * dir * (side === 'lead' ? 1 : -1);
  const scale = side === 'lead'
    ? 1 + 0.16 * (1 - e)
    : 1 + 0.10 * e;
  return {
    ...tr,
    scale: Number((tr.scale * scale).toFixed(4)),
    offsetX: Number((tr.offsetX + slide).toFixed(4)),
  };
}
