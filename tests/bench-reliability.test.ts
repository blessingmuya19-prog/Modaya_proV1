/**
 * D4 reliability scorer — the five locked numbers, re-checked by machine.
 * If the Phase 2 gate is the scorer, the scorer is tested first.
 */
import { describe, it, expect } from 'vitest';
import {
  TC_TOLERANCE_S,
  intentMatch,
  noOpRate,
  orderFidelity,
  clipTimecodesValid,
  timecodeValidity,
  canonicalJson,
  reproducibility,
  ambiguousExclusionRate,
  evaluateReliability,
} from '../bench/reliability-stats.mjs';

const row = (over = {}) => ({
  instruction: 'i', ambiguous: false, changeRequested: true,
  intentMatch: 1, changed: true, planOrder: ['a'], executedOrder: ['a'],
  clips: [{ startS: 0, endS: 10 }], anchors: [0, 10],
  planJson: '{"a":1}', footageId: 'f', referenceId: 'r', seed: 's',
  ...over,
});

describe('D4 #1 — intent match', () => {
  it('is the mean of rater binaries over eligible rows', () => {
    expect(intentMatch([row({ intentMatch: 1 }), row({ intentMatch: 0 }), row({ intentMatch: 1 })])).toBeCloseTo(2 / 3, 6);
  });

  it('excludes ambiguous instructions and rows without a binary', () => {
    const rows = [row({ intentMatch: 1 }), row({ ambiguous: true, intentMatch: 0 })];
    expect(intentMatch(rows)).toBe(1);
    expect(intentMatch([row({})])).toBe(1);          // default intentMatch 1
    expect(intentMatch([row({ intentMatch: null })])).toBeNull();
  });
});

describe('D4 #2 — no-op rate', () => {
  it('counts only change-requesting, eligible rows', () => {
    const rows = [
      row({ changed: false }), row({ changed: true }),
      row({ changeRequested: false, changed: false }),   // not a change request — out
      row({ ambiguous: true, changed: false }),          // excluded
    ];
    expect(noOpRate(rows)).toBeCloseTo(0.5, 6);
  });

  it('is null when nothing qualifies', () => {
    expect(noOpRate([row({ changeRequested: false })])).toBeNull();
  });
});

describe('D4 #3 — order fidelity', () => {
  it('is 1 when executed order equals proposed order, 0 on any swap', () => {
    expect(orderFidelity([row()])).toBe(1);
    expect(orderFidelity([row({ planOrder: ['a', 'b'], executedOrder: ['b', 'a'] })])).toBe(0);
  });

  it('skips rows missing either order (no evidence, no verdict)', () => {
    expect(orderFidelity([row({ executedOrder: undefined })])).toBeNull();
  });
});

describe('D4 #4 — timecode validity', () => {
  it('accepts boundaries within tolerance of a measured anchor', () => {
    expect(clipTimecodesValid({ startS: 10.1, endS: 20.05 }, [10, 20])).toBe(true);
    expect(TC_TOLERANCE_S).toBe(0.12);
  });

  it('rejects boundaries off-anchor or non-finite', () => {
    expect(clipTimecodesValid({ startS: 10.5, endS: 20 }, [10, 20])).toBe(false);
    expect(clipTimecodesValid({ startS: Number.NaN, endS: 20 }, [10, 20])).toBe(false);
    expect(clipTimecodesValid({ startS: 10, endS: 20 }, [])).toBe(false);
  });

  it('treats an explicit flagged clip as valid, not as evidence of an anchor', () => {
    expect(clipTimecodesValid({ startS: 3, endS: 7, flagged: true }, [])).toBe(true);
  });

  it('aggregates clip-level validity across rows; null with no clips', () => {
    const rows = [
      row({ clips: [{ startS: 0, endS: 10 }, { startS: 10.5, endS: 20 }], anchors: [0, 10, 20] }),
      row({ clips: [{ startS: 1, endS: 2, flagged: true }] }),
    ];
    expect(timecodeValidity(rows)).toBeCloseTo(2 / 3, 6);
    expect(timecodeValidity([row({ clips: [] })])).toBeNull();
  });
});

describe('D4 #5 — determinism', () => {
  it('canonicalises JSON so key order and whitespace cannot fake a difference', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).not.toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('compares plans pairwise within (footage, reference, seed) groups', () => {
    const rows = [
      row({ planJson: JSON.stringify({ x: 1, y: [1, 2] }) }),
      row({ planJson: JSON.stringify({ y: [1, 2], x: 1 }) }),        // same plan, different formatting
      row({ planJson: JSON.stringify({ x: 1 }) }),                   // different plan
    ];
    expect(reproducibility(rows)).toBeCloseTo(1 / 3, 6);
  });

  it('needs at least two runs in a group; unparsable plans are not identical', () => {
    const single = [row()];
    expect(reproducibility(single)).toBeNull();
    const broken = [row({ planJson: 'not json' }), row({ planJson: 'not json' })];
    expect(reproducibility(broken)).toBe(0);
  });
});

describe('D4 exclusion signal + combined gate', () => {
  it('exclusion rate = ambiguous / all instructions', () => {
    expect(ambiguousExclusionRate([row(), row({ ambiguous: true })])).toBeCloseTo(0.5, 6);
    expect(ambiguousExclusionRate([row()])).toBe(0);
  });

  it('fails the run when exclusion exceeds 20% even if every metric passes', () => {
    const rows = Array.from({ length: 4 }, (_, i) => (
      row({ seed: 's', planOrder: ['a'], executedOrder: ['a'],
            intentMatch: 1, changed: true, ambiguous: i === 0 })
    ));
    const r = evaluateReliability(rows);
    expect(r.exclusionRate).toBeCloseTo(0.25, 6);
    expect(r.checks.intentMatch).toBe(true);
    expect(r.checks.reproducibility).toBe(true);       // exclusion alone fails the run
    expect(r.checks.exclusionSignal).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('passes only when all five numbers and the exclusion signal hold', () => {
    const rows = [
      row({ seed: 's' }), row({ seed: 's', planJson: '{"a":1}' }),
    ];
    expect(evaluateReliability(rows).pass).toBe(true);
    expect(evaluateReliability([row({ changed: false })]).pass).toBe(false);
  });

  it('missing data fails rather than passing silently', () => {
    expect(evaluateReliability([row({ intentMatch: null, changeRequested: false })]).pass).toBe(false);
  });
});
