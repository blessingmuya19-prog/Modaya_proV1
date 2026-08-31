/**
 * Style profiling — what makes a reference video *look* the way it does.
 *
 * The product promise is: point at a video you like, get your footage edited
 * in that style. That means measuring the reference rather than guessing:
 * how often it cuts, how much those cuts vary, how hard it pushes colour,
 * whether it punches in, whether it burns in captions, and whether the cuts
 * land on the beat. Everything here is pure maths over sampled frames and an
 * audio envelope, so it is deterministic and testable.
 */

/* ─────────────── measurements taken from the reference ─────────────── */

export interface FrameSample {
  t:      number;        // seconds
  /** 16-bin luma histogram, normalised to sum 1. */
  hist:   number[];
  luma:   number;        // 0..1 mean brightness
  sat:    number;        // 0..1 mean saturation
  warmth: number;        // -1 cool … +1 warm  (R−B)
  detail: number;        // 0..1 edge energy — proxy for text/graphics
  /** Edge energy in the lower third — proxy for burned-in captions. */
  lowerDetail: number;
}

export interface AudioEnvelope {
  /** RMS energy per 50ms hop, 0..1. */
  rms:      number[];
  hopS:     number;
  /** Detected onset times in seconds. */
  onsets:   number[];
  bpm:      number | null;
}

export type Pace = 'very fast' | 'fast' | 'medium' | 'relaxed';

export interface StyleProfile {
  sourceName:   string;
  durationS:    number;
  /** Cut timestamps detected in the reference. */
  cuts:         number[];
  cutsPerMin:   number;
  shotMeanS:    number;
  shotMedianS:  number;
  /** Coefficient of variation of shot length — rhythm regularity. */
  shotVariance: number;
  pace:         Pace;
  /** Colour grade to apply, relative to neutral. */
  grade: { brightness: number; contrast: number; saturation: number; warmth: number };
  /** How often shots use a push-in, 0..1. */
  punchInRate:  number;
  punchInMax:   number;
  captions:     { present: boolean; position: 'centre' | 'lower'; emphasis: number };
  beatSynced:   boolean;
  bpm:          number | null;
  energy:       number;      // 0..1 overall intensity
}

/* ─────────────── cut detection ─────────────── */

/** Chi-square distance between two normalised histograms. */
export function histDistance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const s = a[i] + b[i];
    if (s > 0) d += ((a[i] - b[i]) ** 2) / s;
  }
  return d;      // 0 = identical, ~1 = completely different
}

/**
 * Detect hard cuts from sampled frames.
 *
 * A fixed threshold fails badly — a dark interview and a bright vlog have very
 * different baseline frame-to-frame movement. So the threshold adapts: a cut
 * is a distance that stands well clear of that video's own noise floor.
 */
export function detectCuts(frames: FrameSample[], sensitivity = 1): number[] {
  if (frames.length < 3) return [];

  const dists: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    dists.push(histDistance(frames[i - 1].hist, frames[i].hist));
  }

  const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
  const sd   = Math.sqrt(dists.reduce((a, d) => a + (d - mean) ** 2, 0) / dists.length);
  const threshold = Math.max(0.06, mean + (2.2 / sensitivity) * sd);

  const cuts: number[] = [];
  let lastCut = -Infinity;
  for (let i = 0; i < dists.length; i++) {
    const t = frames[i + 1].t;
    // Ignore retriggers within 250ms — one cut, not a burst
    if (dists[i] > threshold && t - lastCut > 0.25) {
      cuts.push(Number(t.toFixed(3)));
      lastCut = t;
    }
  }
  return cuts;
}

/** Shot lengths implied by a cut list. */
export function shotLengths(cuts: number[], durationS: number): number[] {
  const edges = [0, ...cuts.filter(c => c > 0 && c < durationS), durationS];
  const out: number[] = [];
  for (let i = 1; i < edges.length; i++) {
    const len = edges[i] - edges[i - 1];
    if (len > 0.05) out.push(len);
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function paceOf(cutsPerMin: number): Pace {
  if (cutsPerMin >= 30) return 'very fast';
  if (cutsPerMin >= 15) return 'fast';
  if (cutsPerMin >= 6)  return 'medium';
  return 'relaxed';
}

/* ─────────────── audio ─────────────── */

/** Onsets from an RMS envelope: local jumps above a rolling mean. */
export function detectOnsets(rms: number[], hopS: number): number[] {
  if (rms.length < 8) return [];
  const onsets: number[] = [];
  const win = Math.max(4, Math.round(0.4 / hopS));
  let last = -Infinity;

  for (let i = win; i < rms.length; i++) {
    let sum = 0;
    for (let j = i - win; j < i; j++) sum += rms[j];
    const local = sum / win;
    const t = i * hopS;
    if (rms[i] > local * 1.55 && rms[i] > 0.04 && t - last > 0.2) {
      onsets.push(Number(t.toFixed(3)));
      last = t;
    }
  }
  return onsets;
}

/** Rough BPM from the most common onset spacing. */
export function estimateBpm(onsets: number[]): number | null {
  if (onsets.length < 6) return null;
  const gaps = onsets.slice(1).map((t, i) => t - onsets[i]).filter(g => g > 0.2 && g < 2);
  if (gaps.length < 4) return null;

  // Histogram the gaps at 20ms resolution and take the mode
  const buckets = new Map<number, number>();
  for (const g of gaps) {
    const k = Math.round(g / 0.02);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  let bestK = 0, bestN = 0;
  for (const [k, n] of buckets) if (n > bestN) { bestN = n; bestK = k; }
  const beatS = bestK * 0.02;
  if (!beatS) return null;

  let bpm = 60 / beatS;
  while (bpm < 70)  bpm *= 2;      // fold into a musical range
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

/** Are the cuts landing on onsets? */
export function isBeatSynced(cuts: number[], onsets: number[], toleranceS = 0.12): boolean {
  if (cuts.length < 4 || onsets.length < 4) return false;
  const hits = cuts.filter(c => onsets.some(o => Math.abs(o - c) <= toleranceS)).length;
  return hits / cuts.length >= 0.45;
}

/* ─────────────── the profile ─────────────── */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const avg   = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export function buildStyleProfile(opts: {
  sourceName: string;
  durationS:  number;
  frames:     FrameSample[];
  audio?:     AudioEnvelope | null;
  sensitivity?: number;
}): StyleProfile {
  const { sourceName, durationS, frames, audio } = opts;

  const cuts   = detectCuts(frames, opts.sensitivity ?? 1);
  const shots  = shotLengths(cuts, durationS);
  const meanS  = avg(shots);
  const medS   = median(shots);
  const sd     = shots.length > 1
    ? Math.sqrt(avg(shots.map(s => (s - meanS) ** 2)))
    : 0;

  const cutsPerMin = durationS > 0 ? (cuts.length / durationS) * 60 : 0;

  const luma   = avg(frames.map(f => f.luma));
  const sat    = avg(frames.map(f => f.sat));
  const warm   = avg(frames.map(f => f.warmth));
  const spread = avg(frames.map(f => {
    // contrast proxy: how much of the histogram sits away from mid-grey
    let s = 0;
    f.hist.forEach((p, i) => { s += p * Math.abs(i / (f.hist.length - 1) - 0.5) * 2; });
    return s;
  }));

  // Motion inside shots drives how much the style pushes in
  let motion = 0;
  for (let i = 1; i < frames.length; i++) {
    const d = histDistance(frames[i - 1].hist, frames[i].hist);
    if (!cuts.includes(Number(frames[i].t.toFixed(3)))) motion += d;
  }
  motion = frames.length > 1 ? motion / (frames.length - 1) : 0;

  const lowerDetail = avg(frames.map(f => f.lowerDetail));
  const midDetail   = avg(frames.map(f => f.detail));
  const captionish  = lowerDetail > midDetail * 1.25 && lowerDetail > 0.12;

  const onsets = audio?.onsets ?? [];
  const energy = clamp(
    0.45 * clamp(cutsPerMin / 40, 0, 1) +
    0.25 * clamp(motion / 0.08, 0, 1) +
    0.30 * clamp(avg(audio?.rms ?? [0]) / 0.25, 0, 1),
    0, 1);

  return {
    sourceName,
    durationS,
    cuts,
    cutsPerMin:   Number(cutsPerMin.toFixed(1)),
    shotMeanS:    Number(meanS.toFixed(2)),
    shotMedianS:  Number(medS.toFixed(2)),
    shotVariance: meanS > 0 ? Number((sd / meanS).toFixed(2)) : 0,
    pace:         paceOf(cutsPerMin),
    grade: {
      // Map the reference's look to a correction applied to *our* footage
      brightness: Number(clamp(0.85 + luma * 0.45,  0.75, 1.25).toFixed(3)),
      contrast:   Number(clamp(0.85 + spread * 0.6, 0.85, 1.35).toFixed(3)),
      saturation: Number(clamp(0.75 + sat * 0.9,    0.80, 1.45).toFixed(3)),
      warmth:     Number(clamp(warm, -1, 1).toFixed(3)),
    },
    punchInRate: Number(clamp(motion / 0.06, 0, 0.85).toFixed(2)),
    punchInMax:  Number((1 + clamp(motion / 0.05, 0, 1) * 0.18).toFixed(3)),
    captions: {
      present:  captionish,
      position: lowerDetail > midDetail * 1.8 ? 'lower' : 'centre',
      emphasis: Number(clamp(lowerDetail * 3, 0, 1).toFixed(2)),
    },
    beatSynced: isBeatSynced(cuts, onsets),
    bpm:        audio?.bpm ?? null,
    energy:     Number(energy.toFixed(2)),
  };
}

/** Plain-English summary — this is what the AI panel says back to the user. */
export function describeStyle(p: StyleProfile): string {
  const bits: string[] = [];
  bits.push(`${p.pace} pace — ${p.cutsPerMin} cuts/min, shots averaging ${p.shotMeanS}s`);
  bits.push(p.shotVariance > 0.7 ? 'irregular, punchy rhythm' : 'steady rhythm');

  const g = p.grade;
  const look: string[] = [];
  if (g.saturation > 1.12) look.push('saturated');
  else if (g.saturation < 0.95) look.push('muted');
  if (g.contrast > 1.12) look.push('high-contrast');
  if (g.warmth > 0.06) look.push('warm');
  else if (g.warmth < -0.06) look.push('cool');
  bits.push(look.length ? `${look.join(', ')} grade` : 'neutral grade');

  if (p.punchInRate > 0.25) bits.push(`push-ins on ~${Math.round(p.punchInRate * 100)}% of shots`);
  if (p.captions.present)   bits.push(`burned-in ${p.captions.position} captions`);
  if (p.beatSynced)         bits.push(p.bpm ? `cuts locked to ~${p.bpm} BPM` : 'cuts locked to the beat');

  return bits.join(' · ');
}
