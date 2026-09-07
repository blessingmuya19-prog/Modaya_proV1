/**
 * Benchmark scoring math — the numbers behind the reference-matching gate.
 * If the gate is trusted, the math it runs on must be tested.
 */
import { describe, it, expect } from 'vitest';
import {
  mean, stdev, agreementWithin1, spearman, evaluateGate,
  exclusionRate, evaluateExclusion, EXCLUSION_LIMIT,
} from '../bench/stats.mjs';

describe('bench stats — mean / stdev', () => {
  it('mean of values', () => {
    expect(mean([3, 4, 5])).toBe(4);
    expect(mean([])).toBeNull();
    expect(mean([2.5])).toBe(2.5);
  });

  it('population stdev', () => {
    expect(stdev([4, 4, 4])).toBe(0);
    expect(stdev([1, 2, 3])).toBeCloseTo(Math.sqrt(2 / 3), 6);
    expect(stdev([])).toBeNull();
  });
});

describe('bench stats — rater agreement', () => {
  it('perfect agreement within ±1 = 1', () => {
    expect(agreementWithin1({ r1: 3, r2: 4, r3: 3 })).toBe(1);
  });

  it('disagreement beyond one point lowers it', () => {
    /* r1 vs r2: |3-5|=2 → disagree; r1 vs r3: |3-4|=1 → agree; r2 vs r3 → agree */
    expect(agreementWithin1({ r1: 3, r2: 5, r3: 4 })).toBeCloseTo(2 / 3, 6);
  });

  it('needs at least two raters', () => {
    expect(agreementWithin1({ r1: 4 })).toBeNull();
  });
});

describe('bench stats — Spearman correlation', () => {
  it('perfect monotonic = 1, inverted = -1', () => {
    expect(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 6);
    expect(spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 6);
  });

  it('handles ties with average ranks', () => {
    const rho = spearman([1, 1, 2, 3], [1, 2, 2, 3]);
    expect(rho).not.toBeNull();
    expect(rho).toBeGreaterThan(0.7);
  });

  it('returns null without variance or data', () => {
    expect(spearman([], [])).toBeNull();
    expect(spearman([5, 5, 5], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2, 3], [1, 2])).toBeNull();
  });
});

describe('bench stats — the gate', () => {
  it('passes only above 3.5, above baseline, with usable agreement', () => {
    expect(evaluateGate({ feelMean: 3.8, baselineFeelMean: 3.2, agreement: 0.7 }).pass).toBe(true);
    expect(evaluateGate({ feelMean: 3.4, baselineFeelMean: 3.0, agreement: 0.7 }).pass).toBe(false);
    expect(evaluateGate({ feelMean: 3.8, baselineFeelMean: 3.7, agreement: 0.7 }).pass).toBe(false); // not +0.3 better
    expect(evaluateGate({ feelMean: 3.8, baselineFeelMean: 3.2, agreement: 0.5 }).pass).toBe(false);
  });

  it('baseline can be absent (first run) — gate then needs only feel + agreement', () => {
    expect(evaluateGate({ feelMean: 3.8, baselineFeelMean: null, agreement: 0.7 }).pass).toBe(true);
  });
});

describe('bench stats — D4 ambiguous-instruction exclusion signal', () => {
  it('limit is 20%', () => {
    expect(EXCLUSION_LIMIT).toBe(0.20);
  });

  it('rate at or below the limit passes; above it fails with a signal', () => {
    expect(evaluateExclusion(0.20).pass).toBe(true);
    expect(evaluateExclusion(0.19).pass).toBe(true);
    const over = evaluateExclusion(0.21);
    expect(over.pass).toBe(false);
    expect(over.signal).toContain('excluded');
  });

  it('exclusion rate is excluded / total, null on empty total', () => {
    expect(exclusionRate(5, 25)).toBe(0.2);
    expect(exclusionRate(0, 25)).toBe(0);
    expect(exclusionRate(0, 0)).toBeNull();
    expect(exclusionRate(-1, 25)).toBe(-0.04);   // raw math; the verdict handles sanity
  });

  it('non-finite or non-number rates get no verdict', () => {
    expect(evaluateExclusion(Number.NaN)).toBeNull();
    expect(evaluateExclusion(undefined as never)).toBeNull();
  });
});
