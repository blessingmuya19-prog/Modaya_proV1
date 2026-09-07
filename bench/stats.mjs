/**
 * Pure scoring math for the Modaya reference-match benchmark.
 * No dependencies, no I/O — everything here is unit-tested and safe to reuse
 * from the CLI (`score.mjs`) or from the app if we ever surface it.
 */

/** Arithmetic mean; empty list → null. */
export function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Standard deviation (population);
 *  empty list → null; single item → 0. */
export function stdev(xs) {
  const m = mean(xs);
  if (m === null) return null;
  if (xs.length < 2) return 0;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

/** Pairwise agreement over ordinal 1–5 scores: fraction of rater pairs whose
 *  scores are within ±1. 1.0 = everyone agrees within one point; 0 = nobody.
 *  Threshold used by the gate: ≥ 0.6. */
export function agreementWithin1(rowsPerRater) {
  const raters = Object.values(rowsPerRater);
  if (raters.length < 2) return null;
  let pairs = 0;
  let agree = 0;
  for (let i = 0; i < raters.length; i++) {
    for (let j = i + 1; j < raters.length; j++) {
      pairs++;
      if (Math.abs(raters[i] - raters[j]) <= 1) agree++;
    }
  }
  return pairs ? agree / pairs : null;
}

/** Spearman rank correlation (ρ). Ties get average ranks. Inputs are paired;
 *  returns null when there's no variance or no data (perfect correlation
 *  without variance is meaningless). */
export function spearman(xs, ys) {
  if (!xs.length || xs.length !== ys.length) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Average ranks with ties (used by Spearman). */
function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const rank = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k++) out[idx[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

/** The gate verdict. Returns pass/fail with the numbers. */
export function evaluateGate({ feelMean, baselineFeelMean, agreement }) {
  const improved = baselineFeelMean === null
    ? null
    : feelMean - baselineFeelMean;
  return {
    pass:
      feelMean >= 3.5 &&
      (improved === null || improved >= 0.3) &&
      (agreement === null || agreement >= 0.6),
    feelMean,
    baselineFeelMean,
    improvement: improved,
    agreement,
  };
}
