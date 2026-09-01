/**
 * Style transfer — turn a measured reference style into an edit of the user's
 * footage.
 *
 * This is the step that makes the product an AI editor rather than a filter:
 * it decides where to cut, which sections to drop, how far to push in, what
 * grade to apply and where captions sit — all derived from the reference's
 * measurements and the target's own content, not from a fixed template.
 *
 * Deterministic: same reference + same footage → same edit, because the only
 * randomness is a seeded PRNG.
 */
import { StyleProfile } from './styleProfile';
import { Transform, Effects, DEFAULT_TRANSFORM, DEFAULT_EFFECTS } from '@/lib/render/sequence';

export interface PlannedClip {
  id:        string;
  trackId:   string;
  label:     string;
  startS:    number;
  endS:      number;
  type:      'video' | 'text';
  /** Where in the source file this clip reads from. */
  sourceIn:  number;
  transform: Transform;
  effects:   Effects;
}

export interface EditPlan {
  clips:       PlannedClip[];
  /** Programme length after the edit. */
  durationS:   number;
  /** Seconds removed from the original. */
  removedS:    number;
  cutCount:    number;
  summary:     string;
  profileName: string;
}

/** Deterministic PRNG so a given reference always yields the same edit. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0xffffffff;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Sample a shot length from the reference's own distribution. */
function shotLengthFor(p: StyleProfile, rand: () => number): number {
  const base = p.shotMedianS > 0.3 ? p.shotMedianS : Math.max(0.8, p.shotMeanS || 2);
  // Coefficient of variation controls how irregular the rhythm feels
  const spread = Math.min(1.2, p.shotVariance || 0.4);
  const jitter = 1 + (rand() * 2 - 1) * spread * 0.6;
  return Math.max(0.4, base * jitter);
}

/**
 * Choose cut points across the target footage.
 *
 * When the reference is beat-synced and we know the target's onsets, cuts snap
 * to the nearest onset — that's what makes an edit feel intentional instead of
 * chopped on a timer.
 */
export function planCutPoints(
  p: StyleProfile, targetDurationS: number, onsets: number[] = [], seed = 1,
): number[] {
  if (targetDurationS <= 0) return [];
  const rand = rng(seed);
  const points: number[] = [];
  let t = 0;

  const snap = (x: number): number => {
    if (!p.beatSynced || !onsets.length) return x;
    let best = x, bestD = Infinity;
    for (const o of onsets) {
      const d = Math.abs(o - x);
      if (d < bestD) { bestD = d; best = o; }
    }
    // only snap when an onset is genuinely nearby
    return bestD <= Math.max(0.35, p.shotMedianS * 0.3) ? best : x;
  };

  let guard = 0;
  while (t < targetDurationS - 0.5 && guard++ < 5000) {
    const next = snap(t + shotLengthFor(p, rand));
    if (next <= t + 0.25) { t += 0.4; continue; }
    if (next >= targetDurationS - 0.25) break;
    points.push(Number(next.toFixed(3)));
    t = next;
  }
  return points;
}

/**
 * Build the edit.
 *
 * `keepRatio` falls out of the reference's energy: a high-energy reference
 * implies a tighter cut, so more of the low-value middle gets dropped.
 */
export function generateEditPlan(opts: {
  profile:      StyleProfile;
  durationS:    number;
  sourceName?:  string;
  onsets?:      number[];
  /** Per-second interest score for the target, 0..1 (speech/motion energy). */
  interest?:    number[];
  seed?:        number;
}): EditPlan {
  const { profile, durationS } = opts;
  const onsets = opts.onsets ?? [];
  const seed   = opts.seed ?? hashString(profile.sourceName + (opts.sourceName ?? ''));
  const rand   = rng(seed + 7);

  const points = planCutPoints(profile, durationS, onsets, seed);
  const edges  = [0, ...points, durationS];

  // Segments of the original, in order
  const segments = edges.slice(1).map((e, i) => ({ s: edges[i], e }))
                        .filter(seg => seg.e - seg.s > 0.25);

  // Drop the least interesting segments to reach the tightness the style implies
  const keepRatio = Math.max(0.45, 1 - profile.energy * 0.45);
  const scored = segments.map((seg, i) => {
    const interest = opts.interest?.length
      ? scoreRange(opts.interest, seg.s, seg.e)
      : 0.5 + 0.5 * Math.cos((i / Math.max(1, segments.length)) * Math.PI * 2);  // keep head & tail
    return { ...seg, interest, i };
  });

  const keepCount = Math.max(1, Math.round(segments.length * keepRatio));
  const keepIds = new Set(
    [...scored].sort((a, b) => b.interest - a.interest).slice(0, keepCount).map(s => s.i),
  );
  const kept = scored.filter(s => keepIds.has(s.i)).sort((a, b) => a.s - b.s);

  // Lay the kept segments back down end to end — a ripple edit
  const clips: PlannedClip[] = [];
  let cursor = 0;
  kept.forEach((seg, idx) => {
    const len = seg.e - seg.s;
    const punchIn = rand() < profile.punchInRate;
    const scale   = punchIn ? 1 + (profile.punchInMax - 1) * (0.6 + rand() * 0.4) : 1;

    clips.push({
      id:       `sty-${idx}`,
      trackId:  'video',
      label:    `Shot ${idx + 1}`,
      startS:   Number(cursor.toFixed(3)),
      endS:     Number((cursor + len).toFixed(3)),
      type:     'video',
      sourceIn: Number(seg.s.toFixed(3)),
      transform: {
        ...DEFAULT_TRANSFORM,
        fit:   'contain',
        scale,
        // gentle alternating drift, so consecutive push-ins don't look identical
        offsetX: punchIn ? (idx % 2 ? 0.012 : -0.012) : 0,
      },
      effects: {
        ...DEFAULT_EFFECTS,
        brightness: profile.grade.brightness,
        contrast:   profile.grade.contrast,
        saturation: profile.grade.saturation,
      },
    });
    cursor += len;
  });

  // Caption placeholders, matching the reference's caption habit
  if (profile.captions.present && clips.length) {
    const every = profile.pace === 'very fast' ? 1 : profile.pace === 'fast' ? 2 : 3;
    clips.filter((_, i) => i % every === 0).forEach((c, n) => {
      clips.push({
        id:       `cap-${n}`,
        trackId:  profile.captions.position === 'lower' ? 'subs' : 'text',
        label:    c.label,
        startS:   c.startS,
        endS:     Math.min(c.endS, c.startS + 2.4),
        type:     'text',
        sourceIn: 0,
        transform: { ...DEFAULT_TRANSFORM },
        effects:   { ...DEFAULT_EFFECTS },
      });
    });
  }

  const newDuration = cursor;
  const removed     = Math.max(0, durationS - newDuration);

  return {
    clips,
    durationS: Number(newDuration.toFixed(2)),
    removedS:  Number(removed.toFixed(2)),
    cutCount:  kept.length,
    profileName: profile.sourceName,
    summary: [
      `${kept.length} shots`,
      `${fmt(removed)} trimmed`,
      profile.captions.present ? 'captions added' : null,
      profile.punchInRate > 0.25 ? 'push-ins' : null,
      profile.beatSynced ? 'beat-synced' : null,
    ].filter(Boolean).join(' · '),
  };
}

function scoreRange(perSecond: number[], s: number, e: number): number {
  const a = Math.max(0, Math.floor(s));
  const b = Math.min(perSecond.length, Math.ceil(e));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += perSecond[i] ?? 0;
  return sum / (b - a);
}

function fmt(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
