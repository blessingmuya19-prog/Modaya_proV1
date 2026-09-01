/**
 * The model cannot see or hear the footage, so "the best 30 seconds" is
 * answered from the measured loudness curve. Before this existed it returned
 * the first 30 seconds, which is the one answer guaranteed to be arbitrary.
 */
import { describe, it, expect } from 'vitest';
import { loudestWindow, loudnessSparkline, describeLoudness } from '@/lib/ai/highlights';

/** A 60 s curve at 10 samples/s that is quiet except for a burst at 40–50 s. */
function burstAt(fromS: number, toS: number, durationS = 60, rate = 10): number[] {
  const n = durationS * rate;
  return Array.from({ length: n }, (_, i) => {
    const t = i / rate;
    return t >= fromS && t < toS ? 0.9 : 0.05;
  });
}

describe('loudestWindow', () => {
  it('finds a burst in the middle, not the opening', () => {
    const win = loudestWindow(burstAt(40, 50), 60, 10);
    expect(win).not.toBeNull();
    const [start, end] = win!;
    expect(start).toBeGreaterThanOrEqual(39);
    expect(end).toBeLessThanOrEqual(51);
  });

  it('finds a burst at the very end', () => {
    const [start] = loudestWindow(burstAt(52, 60), 60, 8)!;
    expect(start).toBeGreaterThanOrEqual(51);
  });

  it('picks the louder of two bursts', () => {
    const energy = burstAt(10, 20).map((v, i) => (i / 10 >= 40 && i / 10 < 50 ? 1.0 : v));
    const [start] = loudestWindow(energy, 60, 10)!;
    expect(start).toBeGreaterThanOrEqual(39);
  });

  it('returns the whole video when the window is longer than it', () => {
    expect(loudestWindow(burstAt(10, 20), 60, 90)).toEqual([0, 60]);
  });

  it('returns null with nothing measured', () => {
    expect(loudestWindow([], 60, 10)).toBeNull();
    expect(loudestWindow(burstAt(0, 10), 0, 10)).toBeNull();
  });

  it('never runs past the end of the video', () => {
    const [, end] = loudestWindow(burstAt(55, 60), 60, 10)!;
    expect(end).toBeLessThanOrEqual(60);
  });

  it('is deterministic', () => {
    const e = burstAt(30, 40);
    expect(loudestWindow(e, 60, 12)).toEqual(loudestWindow(e, 60, 12));
  });
});

describe('loudnessSparkline', () => {
  it('peaks where the audio peaks', () => {
    const spark = loudnessSparkline(burstAt(40, 50), 60);
    expect(spark).toHaveLength(40);
    expect(spark[Math.floor((45 / 60) * 40)]).toBe('9');
    expect(Number(spark[0])).toBeLessThan(3);
  });

  it('is empty when there is no audio at all', () => {
    expect(loudnessSparkline([], 60)).toBe('');
    expect(loudnessSparkline(new Array(600).fill(0), 60)).toBe('');
  });
});

describe('describeLoudness', () => {
  it('admits when nothing has been measured instead of guessing', () => {
    const text = describeLoudness([], 60);
    expect(text).toMatch(/no audio measured/i);
    expect(text).toMatch(/do not guess/i);
  });

  it('names candidate windows so the model need not do arithmetic', () => {
    const text = describeLoudness(burstAt(40, 50), 60);
    expect(text).toMatch(/loudest continuous window/i);
    expect(text).toMatch(/10s -> \[4\d\.\d, /);
  });

  it('omits windows longer than the video', () => {
    const text = describeLoudness(burstAt(5, 10, 20), 20);
    expect(text).toMatch(/10s ->/);
    expect(text).not.toMatch(/30s ->/);
    expect(text).not.toMatch(/60s ->/);
  });
});
