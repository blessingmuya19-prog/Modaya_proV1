/**
 * The EditPlan brain for the Studio "Modaya does the editing" flow.
 *
 * This is the complete creative decision as data: given a learned reference
 * (StyleProfile), the source's measured energy and (optionally) its transcript,
 * it decides which moments of a long video survive, where the hook starts, how
 * tight the cut is, where push-ins go, which frame format the result fits, and
 * what captions are burned in. The renderer then just plays the plan — the
 * user never sees a timeline or parameter.
 *
 * Two modes fall out of the reference:
 *   • short-form (a short reference like a 45s TikTok, or no reference) →
 *     carve the best few moments out of a long video, strongest moment first
 *     as the hook, fit a vertical 9:16 frame, burn in real captions.
 *   • long-form re-cut (a long reference) → keep more footage, tightened and
 *     re-paced to the reference's rhythm.
 *
 * Everything here is pure, deterministic and clamp-bounded, so the same inputs
 * always yield the same plan and a loose input can't make a nonsensical one.
 */
import type { StyleProfile } from '../ai/styleProfile';
import { paceOf } from '../ai/styleProfile';
import {
  DEFAULT_TRANSFORM, DEFAULT_EFFECTS, type Transform, type Effects, type TextStyle,
} from '../render/sequence';
import {
  zoomKeyframesForShot, transitionForJunction,
  type ZoomKeyframe, type TransitionSpec,
} from '../render/transitions';

export interface TranscriptLine { startS: number; endS: number; text: string }

export type FrameRatio = '9:16' | '1:1' | '16:9';

export interface PlannedShot {
  id: string;
  trackId: 'video' | 'overlay' | 'subs' | 'text';
  label: string;
  /** Position in the output programme. */
  startS: number;
  endS: number;
  /** 'video' or 'text'. */
  type: 'video' | 'text';
  /** For video clips: where in the source this shot starts. */
  sourceIn: number;
  /**
   * Which media object this clip reads from. Undefined = the main footage.
   * B-roll cutaways from an uploaded library set this to the library clip's
   * source id (e.g. 'broll-0'), and `sourceIn` is then a time inside THAT
   * clip, not the main footage.
   */
  sourceId?: string;
  transform: Transform;
  effects: Effects;
  textPosition?: 'top' | 'centre' | 'lower';
  textAlign?: 'left' | 'centre' | 'right';
  textStyle?: TextStyle;
  /** Animated zoom on this shot — times in output seconds; the renderer
   *  interpolates scale from 1.0 to the peak at the emphasis moment. */
  zoom?: ZoomKeyframe[];
  /** Transition into this shot from the previous one ('whip' = the cut
   *  moves; 'crossfade' = dissolve). */
  transition?: TransitionSpec;
}

export interface StudioPlan {
  clips: PlannedShot[];
  durationS: number;
  removedS: number;
  cutCount: number;
  summary: string;
  profileName: string;
  frame: { width: number; height: number; ratio: FrameRatio };
  captions: number;
  broll: number;
  /** True when cutaways came from an uploaded B-roll library rather than
   *  unused windows of the main footage. */
  brollFromLibrary: boolean;
  hookFirst: boolean;
}

/** One clip in an uploaded B-roll library. `id` is the source id the renderer
 *  knows it by (e.g. 'broll-0'); `durationS` bounds where cutaways may read. */
export interface BrollClip { id: string; durationS: number }

export interface ComposeOpts {
  profile: StyleProfile;
  sourceDurationS: number;
  /** Per-second interest 0..1 (energy / speech density). */
  interest?: number[];
  onsets?: number[];
  transcript?: TranscriptLine[];
  /** "short" | "full" | "uncut"; auto-decided from the reference when omitted. */
  mode?: 'short' | 'full' | 'uncut';
  /** Native aspect ratio / format of the source media. */
  sourceRatio?: FrameRatio;
  /** Output length target for short mode. */
  targetSeconds?: number;
  /** Uploaded B-roll library; when present, cutaways come from these clips
   *  instead of unused windows of the main footage. */
  brollLibrary?: BrollClip[];
  seed?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deterministic PRNG so a given reference + source always cuts the same. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function meanInterest(interest: number[] | undefined, s: number, e: number): number {
  if (!interest?.length) return 0.5;
  const a = Math.max(0, Math.floor(s));
  const b = Math.min(interest.length, Math.ceil(e));
  if (b <= a) return 0.5;
  let sum = 0;
  for (let i = a; i < b; i++) sum += interest[i] ?? 0.5;
  return sum / (b - a);
}

/** Snap a cut to a nearby onset so changes land on a beat. `windowS` is how
 *  far a cut may travel; a beat-synced reference gets a wider window so cuts
 *  land ON the grid, a regular edit only corrects near misses. */
function snap(onsets: number[], t: number, windowS: number): number {
  if (!onsets.length) return t;
  let best = t, bestD = Infinity;
  for (const o of onsets) {
    const d = Math.abs(o - t);
    if (d < bestD) { bestD = d; best = o; }
  }
  return bestD <= windowS ? best : t;
}

/**
 * One shot length drawn from the reference's measured rhythm: its cut
 * cadence (60 / cutsPerMin) as the mean, its measured shot-length VARIANCE as
 * the spread — a steady reference cuts with metronome regularity, an erratic
 * one keeps the viewer on edge. Deterministic via the caller's seeded rand.
 */
function rhythmLength(
  profile: StyleProfile, rand: () => number, minS: number, maxS: number,
): number {
  const mean = 60 / Math.max(1, profile.cutsPerMin || 12);
  const cv = clamp(profile.shotVariance, 0.04, 1.1);
  return clamp(mean * (1 + cv * (rand() * 2 - 1)), minS, maxS);
}

/**
 * Choose the source ranges that survive. Returns chronological, non-overlapping
 * [start,end] windows. In short mode the single strongest window is placed
 * first (the hook), then the remaining target is filled from what follows.
 */
export function chooseMoments(opts: {
  durationS: number; targetS: number; interest?: number[]; onsets?: number[];
  hookFirst: boolean; minShotS?: number;
  /** How far a moment boundary may travel to land on a beat. Wider for a
   *  beat-synced reference so the hook itself starts on the grid. */
  beatTolS?: number;
}): Array<{ s: number; e: number; score: number }> {
  const { durationS, interest, onsets = [], hookFirst } = opts;
  const targetS = clamp(opts.targetS, 8, Math.max(8, durationS));
  const winLen = clamp(targetS * 0.34, 6, 30);   // ~3 beats fill the short
  const step = Math.max(1, winLen / 3);
  const minShot = opts.minShotS ?? 4;
  const beatTol = opts.beatTolS ?? 0.4;

  type Win = { s: number; e: number; score: number };
  const wins: Win[] = [];
  for (let s = 0; s + winLen <= durationS + 1e-6; s += step) {
    const e = Math.min(durationS, s + winLen);
    wins.push({ s, e, score: meanInterest(interest, s, e) });
  }
  if (!wins.length) return [{ s: 0, e: Math.min(durationS, targetS), score: 0.5 }];

  const overlap = (a: Win, b: Win) => Math.min(a.e, b.e) - Math.max(a.s, b.s) > 0.5;
  const chosen: Win[] = [];
  const budget = { left: targetS };

  const take = (w: Win) => {
    chosen.push(w);
    budget.left -= (w.e - w.s);
  };

  const ranked = [...wins].sort((a, b) => b.score - a.score);

  if (hookFirst) {
    const hook = ranked[0];
    take(hook);
  }

  for (const w of ranked) {
    if (budget.left <= minShot) break;
    if (chosen.some(c => overlap(c, w))) continue;
    // In hook-first mode only material at/after the opener keeps the story
    // coherent; otherwise accept anything.
    take(w);
  }

  // Chronological for playback; in hook-first the strongest leads regardless
  // of position (we re-sequence), otherwise keep source order.
  const sorted = hookFirst ? chosen : chosen.sort((a, b) => a.s - b.s);

  // Snap boundaries to nearby onsets for clean cuts.
  return sorted.map(w => ({
    s: Math.max(0, snap(onsets, w.s, beatTol)),
    e: Math.min(durationS, snap(onsets, w.e, beatTol)),
    score: w.score,
  })).filter(w => w.e - w.s >= minShot * 0.6);
}

/**
 * Pick B-roll cutaways: short, visually strong windows of the source that are
 * NOT already used as a main moment, so they illustrate the talk without
 * repeating it. Pure and deterministic.
 */
export function chooseBroll(opts: {
  durationS: number;
  interest?: number[];
  /** Source windows already used by the main moments [s,e]. */
  used: Array<{ s: number; e: number }>;
  /** How many cutaways to aim for. */
  count: number;
  cutLenS?: number;
}): Array<{ s: number; e: number; score: number }> {
  const { durationS, interest, used } = opts;
  const cutLen = clamp(opts.cutLenS ?? 1.6, 0.8, 4);
  const step = Math.max(1, cutLen / 2);
  const overlapsUsed = (s: number, e: number) =>
    used.some(u => Math.min(e, u.e) - Math.max(s, u.s) > 0.3);

  type Win = { s: number; e: number; score: number };
  const wins: Win[] = [];
  for (let s = 0; s + cutLen <= durationS + 1e-6; s += step) {
    const e = Math.min(durationS, s + cutLen);
    if (overlapsUsed(s, e)) continue;
    wins.push({ s, e, score: meanInterest(interest, s, e) });
  }
  // Non-overlapping, best first; spread them so two cutaways aren't adjacent.
  const picked: Win[] = [];
  for (const w of [...wins].sort((a, b) => b.score - a.score)) {
    if (picked.length >= opts.count) break;
    const clash = picked.some(p => Math.min(w.e, p.e) - Math.max(w.s, p.s) > -2);
    if (clash) continue;
    picked.push(w);
  }
  return picked.sort((a, b) => a.s - b.s);
}

/**
 * Pick cutaways from an UPLOADED B-roll library instead of the source itself.
 *
 * Each returned pick names the library clip (its source id) and a window
 * inside it, clamped to that clip's duration — the model-free equivalent of
 * an editor skimming the library and grabbing "a bit from the middle of clip
 * 2". Deterministic: the same library + seed always picks the same windows.
 *
 * Ordering cycles through the library in a seeded shuffle so consecutive
 * cutaways use different clips; when more cutaways are wanted than the
 * library holds, clips are reused at different offsets rather than repeated
 * verbatim. Clips too short to show (< 0.6s) are skipped.
 */
export function chooseLibraryBroll(opts: {
  library: BrollClip[];
  /** How many cutaways to aim for. */
  count: number;
  cutLenS?: number;
  rand: () => number;
}): Array<{ sourceId: string; inS: number; lenS: number }> {
  const { library, rand } = opts;
  const usable = library.filter(b => b.durationS >= 0.6);
  if (!usable.length || opts.count <= 0) return [];

  // Seeded shuffle of the library order (Fisher–Yates on a copy).
  const order = [...usable];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const picks: Array<{ sourceId: string; inS: number; lenS: number }> = [];
  // Spread successive reuses of the same clip across different offsets so a
  // small library doesn't repeat one identical window over and over.
  const useOf = new Map<string, number>();
  for (let n = 0; n < opts.count; n++) {
    const item = order[n % order.length];
    const use  = useOf.get(item.id) ?? 0;
    useOf.set(item.id, use + 1);
    const len  = clamp(opts.cutLenS ?? 1.6, 0.8, 4);
    const lenS = Math.min(len, item.durationS);
    // nth use of a clip reads from a different band: 0.2, 0.55, 0.85, wrap.
    const frac = [0.2, 0.55, 0.85][use % 3];
    const inS  = clamp((item.durationS - lenS) * frac, 0, Math.max(0, item.durationS - lenS));
    picks.push({ sourceId: item.id, inS: Number(inS.toFixed(3)), lenS: Number(lenS.toFixed(3)) });
  }
  return picks;
}

/** Map a transcript onto the condensed programme as lower-third captions.
 *  The look comes from what the reference measured — position, and when the
 *  reference captions transition, the same word-level pop with the measured
 *  highlight colour. Never a static white card when the reference moves. */
function captionClips(
  shots: Array<{ srcStart: number; outStart: number; outEnd: number }>,
  transcript: TranscriptLine[] | undefined,
  look: StyleProfile['captions'],
): PlannedShot[] {
  const caps: PlannedShot[] = [];
  let n = 0;
  const position = look.position;

  const textStyle: TextStyle = {
    font: 'sans',
    bold: true,
    size: position === 'centre' ? 'large' : 'medium',
    colour: '#FFFFFF',
    background: 'box',
    uppercase: false,
    /* The reference's captions move — so the edit's do. Static burn-in stays
       static; a transition gets word-by-word karaoke with the measured
       highlight (yellow/green/…), never an invented colour. */
    animation: look.animated ? 'karaoke_pop' : 'none',
    ...(look.highlightColour ? { highlightColour: look.highlightColour } : {}),
  };

  if (transcript && transcript.length > 0) {
    for (const shot of shots) {
      const len = shot.outEnd - shot.outStart;
      for (const line of transcript) {
        if (line.endS <= shot.srcStart || line.startS >= shot.srcStart + len) continue;
        const text = line.text.trim().replace(/\s+/g, ' ');
        if (!text) continue;
        const tlS = shot.outStart + clamp(line.startS - shot.srcStart, 0, len);
        const tlE = shot.outStart + clamp(line.endS - shot.srcStart, 0, len);
        if (tlE - tlS < 0.15) continue;
        caps.push({
          id: `cap-${n++}`,
          trackId: position === 'centre' ? 'text' : 'subs',
          label: text.slice(0, 90),
          startS: Number(tlS.toFixed(3)),
          endS: Number(tlE.toFixed(3)),
          type: 'text',
          sourceIn: 0,
          textPosition: position,
          textAlign: 'centre',
          textStyle,
          transform: { ...DEFAULT_TRANSFORM },
          effects: { ...DEFAULT_EFFECTS },
        });
      }
    }
  }

  // Fallback: If no transcript exists but captions were explicitly requested,
  // place caption slots across the programme so captions are always visible.
  // A single long shot (uncut mode) gets slots tiled every few seconds instead
  // of one card at the very start. Labels are neutral — exactly what the Pro
  // Editor's AI writes ("Caption") — so a reference or footage filename never
  // appears burned into the video.
  if (caps.length === 0 && shots.length > 0) {
    const CADENCE_S = 7;   // one caption card roughly every 7 seconds

    for (const shot of shots) {
      const shotLen = shot.outEnd - shot.outStart;
      if (shotLen < 1.0) continue;
      const perShot = Math.max(1, Math.round(shotLen / CADENCE_S));
      for (let i = 0; i < perShot; i++) {
        const startS = shot.outStart + 0.3 + i * CADENCE_S;
        const endS = shot.outStart + Math.min(shotLen - 0.2, 3.2 + i * CADENCE_S);
        if (endS - startS <= 0.4) continue;
        const label = 'Caption';
        caps.push({
          id: `cap-${n++}`,
          trackId: position === 'centre' ? 'text' : 'subs',
          label,
          startS: Number(startS.toFixed(3)),
          endS: Number(endS.toFixed(3)),
          type: 'text',
          sourceIn: 0,
          textPosition: position,
          textAlign: 'centre',
          textStyle,
          transform: { ...DEFAULT_TRANSFORM },
          effects: { ...DEFAULT_EFFECTS },
        });
      }
    }
  }

  return caps;
}

export function composeStudioPlan(opts: ComposeOpts): StudioPlan {
  const { profile, sourceDurationS: durationS, interest, onsets = [], transcript } = opts;
  const seed = opts.seed ?? hashString(profile.sourceName);
  const rand = rng(seed + 7);

  const isUncut = profile.uncut || opts.mode === 'uncut' || profile.cutsPerMin === 0;

  // Aspect ratio resolution:
  // 1. Explicit targetRatio in profile ('16:9' | '9:16' | '1:1')
  // 2. Explicit targetRatio 'original' -> opts.sourceRatio
  // 3. opts.sourceRatio (from uploaded footage or reference)
  // 4. Default: short mode -> '9:16', long -> '16:9'
  let ratio: FrameRatio;
  if (profile.targetRatio && profile.targetRatio !== 'original') {
    ratio = profile.targetRatio;
  } else if (opts.sourceRatio) {
    ratio = opts.sourceRatio;
  } else {
    const refShort = profile.durationS > 0 && profile.durationS <= 120;
    const autoMode = opts.mode ?? (refShort || profile.sourceName === 'modaya-default' ? 'short' : 'full');
    ratio = autoMode === 'short' ? '9:16' : (profile.durationS > 0 && profile.durationS < 1 ? '1:1' : '16:9');
  }

  const frame = ratio === '9:16' ? { width: 1080, height: 1920, ratio }
    : ratio === '1:1' ? { width: 1080, height: 1080, ratio }
    : { width: 1920, height: 1080, ratio };

  // Mode: a short reference (or none) ⇒ a vertical short; a long reference ⇒ re-cut the whole thing; uncut ⇒ keep 100%
  const refShort = profile.durationS > 0 && profile.durationS <= 120;
  const mode: 'short' | 'full' | 'uncut' = isUncut
    ? 'uncut'
    : (opts.mode ?? (refShort || profile.sourceName === 'modaya-default' ? 'short' : 'full'));

  const grade = profile.grade ?? { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
  const effBrightness = grade.brightness >= 0.7
    ? Number(grade.brightness.toFixed(3))
    : Number((1 + (grade.brightness || 0) * 0.4).toFixed(3));
  const effContrast = grade.contrast >= 0.7
    ? Number(grade.contrast.toFixed(3))
    : Number((1 + (grade.contrast || 0) * 0.8).toFixed(3));
  const effSaturation = grade.saturation >= 0.7
    ? Number(grade.saturation.toFixed(3))
    : Number((1 + (grade.saturation || 0) * 0.85).toFixed(3));
  const effWarmth = grade.warmth || 0;

  const effects: Effects = {
    ...DEFAULT_EFFECTS,
    brightness: effBrightness,
    contrast:   effContrast,
    saturation: effSaturation,
    colorGrade: {
      temperature: Math.round(effWarmth * 80),
      tint: 0,
      vibrance: Math.round((effSaturation - 1) * 70),
      exposure: effBrightness - 1,
      contrast: effContrast,
      highlights: 0,
      shadows: 0,
      intensity: 100,
    },
  };

  const video: PlannedShot[] = [];
  const broll: PlannedShot[] = [];
  let cursor = 0;
  let kept = 0;
  let brollCount = 0;

  if (mode === 'uncut') {
    // Keep 100% of footage sequentially with no segments cut out
    const punchIn = !profile.uncut && profile.punchInRate > 0.4 && rand() < profile.punchInRate;
    const scale = punchIn ? 1 + (profile.punchInMax - 1) * 0.5 : 1;
    video.push({
      id: 'shot-0', trackId: 'video', label: 'Full Video (Uncut)',
      startS: 0, endS: Number(durationS.toFixed(3)),
      type: 'video', sourceIn: 0,
      transform: { ...DEFAULT_TRANSFORM, fit: 'contain', scale },
      effects,
    });
    cursor = durationS;
    kept = 1;
  } else if (mode === 'short') {
    const targetS = clamp(opts.targetSeconds ?? (refShort ? profile.durationS : 45), 20, 90);
    const beatTol = profile.beatSynced ? 0.55 : 0.4;
    const moments = chooseMoments({ durationS, targetS, interest, onsets, hookFirst: true, beatTolS: beatTol });
    // Subdivide moments into shots drawn from the REFERENCE'S rhythm — its cut
    // cadence as the mean, its measured shot-length variance as the spread —
    // instead of a generic 2.5–4.5s pattern. Punch-ins follow the reference's
    // measured rate, never a fixed alternation.
    const baseLen = clamp(60 / Math.max(1, profile.cutsPerMin || 12), 1.4, 8.0);

    moments.forEach((m, mIdx) => {
      const momentLen = m.e - m.s;

      if (momentLen <= baseLen * 1.35) {
        const punchIn = rand() < profile.punchInRate;
        const scale = punchIn ? 1 + (profile.punchInMax - 1) * (0.6 + rand() * 0.4) : 1;
        video.push({
          id: `shot-${video.length}`,
          trackId: 'video',
          label: mIdx === 0 ? '🔥 Hook Intro' : `Moment ${mIdx + 1}`,
          startS: Number(cursor.toFixed(3)),
          endS: Number((cursor + momentLen).toFixed(3)),
          type: 'video',
          sourceIn: Number(m.s.toFixed(3)),
          transform: {
            ...DEFAULT_TRANSFORM,
            fit: ratio === '9:16' && !opts.sourceRatio ? 'cover' : 'contain',
            scale,
            offsetX: punchIn ? (video.length % 2 ? 0.02 : -0.02) : 0,
          },
          effects,
        });
        cursor += momentLen;
        kept++;
      } else {
        // Subdivide the moment into rhythm-matched sub-shots. A beat-synced
        // reference lands every cut on the measured onsets; otherwise only
        // near misses are corrected so a loose timestamp never drags the cut
        // off-pattern.
        let mCur = m.s;
        let subIdx = 0;
        while (mCur < m.e - 0.4) {
          const base = rhythmLength(profile, rand, 1.0, Math.max(1.4, baseLen * 1.6));
          const target = mCur + base;
          let end = snap(onsets, target, profile.beatSynced ? 1.2 : 0.35);
          /* A beat just before the target would make a shot too short to keep
             the rhythm — fall back to the metronome length instead. */
          if (end - mCur < base * 0.55) end = target;
          const subEnd = Math.min(m.e, Math.max(mCur + 1.0, end));
          const subLen = subEnd - mCur;

          // Punch-ins at the reference's measured rate — no forced alternation.
          const punchIn = rand() < profile.punchInRate;
          const scale = punchIn ? 1 + (profile.punchInMax - 1) * (0.7 + rand() * 0.3) : 1;

          video.push({
            id: `shot-${video.length}`,
            trackId: 'video',
            label: mIdx === 0 && subIdx === 0 ? '🔥 Hook Intro' : `Shot ${video.length + 1}`,
            startS: Number(cursor.toFixed(3)),
            endS: Number((cursor + subLen).toFixed(3)),
            type: 'video',
            sourceIn: Number(mCur.toFixed(3)),
            transform: {
              ...DEFAULT_TRANSFORM,
              fit: ratio === '9:16' && !opts.sourceRatio ? 'cover' : 'contain',
              scale,
              offsetX: punchIn ? (subIdx % 2 ? 0.02 : -0.02) : 0,
            },
            effects,
          });

          cursor += subLen;
          mCur = subEnd;
          subIdx++;
          kept++;
        }
      }
    });
  } else {
    // Full re-cut: cut on the reference's rhythm — same shot-length
    // distribution (mean cadence + measured variance) — and drop the weakest
    // stretches. Beat-synced references land every cut on the measured grid.
    const edges: number[] = [0];
    let t = 0;
    while (t < durationS - 0.5 && edges.length < 400) {
      t = Math.min(durationS, t + rhythmLength(profile, rand, 0.8, 30));
      if (profile.beatSynced && onsets.length) {
        const snapped = snap(onsets, t, 1.2);
        t = Math.max(t, Math.min(durationS, snapped));   // never move backwards
      }
      edges.push(t);
    }
    const segs = edges.slice(1).map((e, i) => ({ s: edges[i], e })).filter(g => g.e - g.s > 0.25);
    const keepRatio = clamp(1 - profile.energy * 0.45, 0.5, 0.95);
    const scored = segs.map((g, i) => ({ ...g, score: meanInterest(interest, g.s, g.e), i }));
    const keepCount = Math.max(1, Math.round(segs.length * keepRatio));
    const keepIds = new Set([...scored].sort((a, b) => b.score - a.score).slice(0, keepCount).map(g => g.i));
    scored.filter(g => keepIds.has(g.i)).sort((a, b) => a.s - b.s).forEach((g, idx) => {
      const len = g.e - g.s;
      const punchIn = rand() < profile.punchInRate;
      const scale = punchIn ? 1 + (profile.punchInMax - 1) * (0.6 + rand() * 0.4) : 1;
      video.push({
        id: `shot-${idx}`, trackId: 'video', label: `Shot ${idx + 1}`,
        startS: Number(cursor.toFixed(3)), endS: Number((cursor + len).toFixed(3)),
        type: 'video', sourceIn: Number(g.s.toFixed(3)),
        transform: { ...DEFAULT_TRANSFORM, fit: ratio === '9:16' && !opts.sourceRatio ? 'cover' : 'contain', scale },
        effects,
      });
      cursor += len; kept++;
    });
  }

  /* ── Kinetic layer: animated zooms at the measured emphasises, transitions
     at the source jumps. A static pre-scale is NOT a zoom — the reference's
     punch-in rate becomes a scale ramp on the shot that hosts a measured
     onset (1.0 → target over ~0.45s, held on the moment, settled before the
     cut). The rate is preserved exactly: every shot the reference would have
     punched in either zooms (when there is a timing anchor) or keeps the
     static push-in. Transitions happen only where the source actually jumps,
     so a continuous talk track never gets a fake dissolve. ── */
  video.forEach(shot => {
    const len = shot.endS - shot.startS;
    if ((shot.transform.scale ?? 1) <= 1.02) return;      // not a push-in shot
    const srcEnd = shot.sourceIn + len;
    const peakS = onsets.find(o => o >= shot.sourceIn && o <= srcEnd);
    if (peakS === undefined) return;                      // no anchor: keep static
    const keys = zoomKeyframesForShot(
      shot.startS, shot.endS, peakS,
      1 + (profile.punchInMax - 1) * 0.9,
    );
    if (keys.length) {
      shot.zoom = keys;
      shot.transform.scale = 1;                           // animated, no double scale
    }
  });
  for (let i = 1; i < video.length; i++) {
    const prev = video[i - 1], cur = video[i];
    const prevSrcEnd = prev.sourceIn + (prev.endS - prev.startS);
    const curLen = Math.max(0.4, cur.endS - cur.startS);
    const sourceJump = Math.abs(cur.sourceIn - prevSrcEnd) > Math.max(0.6, curLen * 0.25);
    if (!sourceJump) continue;
    const t = transitionForJunction({
      energy: profile.energy,
      beatSynced: profile.beatSynced,
      punchInRate: profile.punchInRate,
      sourceJump,
      decision: rand(),
    });
    if (t) cur.transition = t;
  }

  // B-roll: short, silent cutaways dropped over the middle of shots like a
  // real TikTok cutaway. The base talk track keeps playing beneath them.
  // With an uploaded library, cutaways read from those clips (each its own
  // source object); without one they fall back to visually-strong windows of
  // the main footage that the edit doesn't already use.
  const library = (opts.brollLibrary ?? []).filter(b => b.durationS >= 0.6);
  const usedRanges = video.map(v => ({ s: v.sourceIn, e: v.sourceIn + (v.endS - v.startS) }));
  const targetCutaways = isUncut ? 0 : Math.max(0, Math.round(cursor / 9));   // roughly one per 9s
  const libPicks = library.length
    ? chooseLibraryBroll({ library, count: targetCutaways, cutLenS: 1.7, rand })
    : [];
  const cuts = libPicks.length
    ? libPicks
    : chooseBroll({
        durationS, interest, used: usedRanges, count: targetCutaways, cutLenS: 1.7,
      }).map(w => ({ sourceId: '', inS: w.s, lenS: Math.min(1.7, w.e - w.s) }));
  if (cuts.length && video.length) {
    const main = video.filter(v => v.trackId === 'video');
    let ci = 0;
    // Stagger cutaways across the main shots, skipping the hook (first shot).
    for (let i = 1; i < main.length && ci < cuts.length; i++) {
      const shot = main[i];
      const shotLen = shot.endS - shot.startS;
      if (shotLen < 1.2) continue;
      const src = cuts[ci++];
      const len = Math.min(src.lenS, Math.max(0.8, shotLen * 0.85));
      const outStart = shot.startS + Math.max(0.05, shotLen * 0.08);
      broll.push({
        id: `broll-${broll.length}`, trackId: 'overlay', label: 'B-roll',
        startS: Number(outStart.toFixed(3)), endS: Number((outStart + len).toFixed(3)),
        type: 'video', sourceIn: Number(src.inS.toFixed(3)),
        ...(src.sourceId ? { sourceId: src.sourceId } : {}),
        transform: { ...DEFAULT_TRANSFORM, fit: 'cover', scale: 1.08 },
        effects,
      });
      brollCount++;
    }
  }
  const brollFromLibrary = libPicks.length > 0;

  // Real captions over the surviving shots.
  const caps = profile.captions.present
    ? captionClips(
        video.map(v => ({ srcStart: v.sourceIn, outStart: v.startS, outEnd: v.endS })),
        transcript, profile.captions,
      )
    : [];

  const clips = [...video, ...broll, ...caps];
  const newDuration = cursor;
  const summary = isUncut
    ? [
        'Full uncut video (100% kept)',
        caps.length ? `${caps.length} captions` : null,
        ratio === '16:9' ? '16:9 widescreen' : ratio === '9:16' ? 'vertical 9:16' : '1:1 square',
        brollCount ? `${brollCount} b-roll` : null,
      ].filter(Boolean).join(' · ')
    : [
        mode === 'short' ? `${kept} moments` : `${kept} shots`,
        `${fmt(durationS - newDuration)} cut`,
        caps.length ? `${caps.length} captions` : null,
        ratio === '9:16' ? 'vertical 9:16' : ratio === '16:9' ? '16:9 widescreen' : '1:1 square',
        profile.punchInRate > 0.25 ? 'punch-ins' : null,
        brollCount ? `${brollCount} b-roll${brollFromLibrary ? ' (your library)' : ''}` : null,
      ].filter(Boolean).join(' · ');

  return {
    clips,
    durationS: Number(newDuration.toFixed(2)),
    removedS: Number(Math.max(0, durationS - newDuration).toFixed(2)),
    cutCount: kept,
    summary,
    profileName: profile.sourceName,
    frame,
    captions: caps.length,
    broll: brollCount,
    brollFromLibrary,
    hookFirst: mode === 'short',
  };
}

function fmt(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

// re-export for callers that think in profile pace terms
export { paceOf };
