/**
 * Reference-frames spike (Phase 1, code side) — the pure math.
 *
 * The hypothesis: the model has never seen the reference. These tests pin the
 * picker that decides WHICH frames travel: evenly spread, clamped to the
 * source, deduped, and honest about a range (absolute times, not rebased).
 * The browser sampler (sampleReferenceKeyframes) is not unit-testable in
 * jsdom; its contract (never throws, returns [] on failure) is enforced by a
 * `.catch` at the only call site.
 */
import { describe, it, expect } from 'vitest';
import { pickReferenceFrameTimes } from '@/lib/ai/referenceFrames';

describe('pickReferenceFrameTimes', () => {
  it('spreads frames evenly across the reference', () => {
    const t = pickReferenceFrameTimes(100, 6, null);
    expect(t).toHaveLength(6);
    for (let i = 1; i < t.length; i++) {
      const gap = t[i] - t[i - 1];
      expect(gap).toBeGreaterThan(9);           // roughly even spacing
      expect(gap).toBeLessThan(20);
    }
  });

  it('clamps count to 3..8', () => {
    expect(pickReferenceFrameTimes(100, 1, null)).toHaveLength(3);
    expect(pickReferenceFrameTimes(100, 99, null)).toHaveLength(8);
  });

  it('keeps absolute (not rebased) times inside a range', () => {
    const t = pickReferenceFrameTimes(300, 5, { startS: 30, endS: 90 });
    expect(t).toHaveLength(5);
    expect(t[0]).toBeGreaterThanOrEqual(30);
    expect(t[t.length - 1]).toBeLessThanOrEqual(89.95);
    /* times are absolute source seconds the model can cite */
    expect(t[0]).toBeGreaterThan(1);
  });

  it('never exceeds the source and never lands on a black pre-roll', () => {
    const t = pickReferenceFrameTimes(10, 8, null);
    expect(t.every(x => x >= 0.1 && x <= 9.95)).toBe(true);
    expect(new Set(t).size).toBe(t.length);     // deduped
  });

  it('handles degenerate durations and reversed ranges without NaN', () => {
    expect(pickReferenceFrameTimes(0, 6, null).every(Number.isFinite)).toBe(true);
    const r = pickReferenceFrameTimes(10, 6, { startS: 8, endS: 2 });   // reversed
    expect(r.every(Number.isFinite)).toBe(true);
    expect(r[0]).toBeGreaterThanOrEqual(8);
  });
});
