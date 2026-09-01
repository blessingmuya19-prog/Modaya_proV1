/**
 * Measuring the picture.
 *
 * Everything here runs on synthetic frames, so the numbers are known in
 * advance and a regression shows up as a wrong answer rather than a vague
 * "looks different".
 */
import { describe, it, expect } from 'vitest';
import {
  sampleTimes, histogram, histDistance, brightnessOf, frameMotion, detectCuts,
  shots, motionBetween, busiestSpans, darkSpans, summariseVisual, keyframeTimes,
  compactScan, type VisualScan,
} from '@/lib/ai/visualScan';

/** A solid colour frame, 8×8 pixels, as RGBA. */
const solid = (r: number, g: number, b: number, px = 64) => {
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255; }
  return out;
};

/** Half one colour, half another — a frame with some content in it. */
const split = (a: [number, number, number], b: [number, number, number], px = 64) => {
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const [r, g, bl] = i < px / 2 ? a : b;
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = bl; out[i * 4 + 3] = 255;
  }
  return out;
};

const scanOf = (samples: [number, number, number][], durationS: number, cuts: number[] = []): VisualScan => ({
  durationS,
  cuts,
  samples: samples.map(([tS, brightness, motion]) => ({ tS, brightness, motion })),
});

describe('when to look', () => {
  it('spreads samples across the whole video', () => {
    const t = sampleTimes(60);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeLessThan(60);
    expect(t.length).toBeGreaterThan(30);
  });

  it('does not sample a long video to death', () => {
    expect(sampleTimes(3600).length).toBeLessThanOrEqual(1800);
    expect(sampleTimes(3600)[1]).toBe(2);            // capped at one look every 2s
  });

  it('never looks closer than a quarter second', () => {
    const t = sampleTimes(2);
    expect(t[1] - t[0]).toBeGreaterThanOrEqual(0.25);
  });

  it('has nothing to say about an empty video', () => {
    expect(sampleTimes(0)).toEqual([]);
    expect(sampleTimes(-5)).toEqual([]);
  });
});

describe('reading one frame', () => {
  it('measures brightness the way an eye would weight it', () => {
    expect(brightnessOf(solid(0, 0, 0))).toBe(0);
    expect(brightnessOf(solid(255, 255, 255))).toBeCloseTo(1, 5);
    // green reads brighter than blue at the same value
    expect(brightnessOf(solid(0, 255, 0))).toBeGreaterThan(brightnessOf(solid(0, 0, 255)));
  });

  it('builds a histogram that sums to one', () => {
    const h = histogram(split([255, 0, 0], [0, 0, 255]));
    expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(h.filter(v => v > 0)).toHaveLength(2);
  });

  it('scores identical frames as no distance and opposites as full', () => {
    expect(histDistance(histogram(solid(10, 20, 30)), histogram(solid(10, 20, 30)))).toBe(0);
    expect(histDistance(histogram(solid(0, 0, 0)), histogram(solid(255, 255, 255)))).toBeCloseTo(1, 5);
  });
});

describe('movement between frames', () => {
  it('is zero for a frozen picture', () => {
    expect(frameMotion(solid(120, 120, 120), solid(120, 120, 120))).toBe(0);
  });

  it('grows with the size of the change', () => {
    const still  = frameMotion(solid(120, 120, 120), solid(125, 125, 125));
    const moving = frameMotion(solid(120, 120, 120), solid(220, 220, 220));
    expect(moving).toBeGreaterThan(still);
    expect(moving).toBeLessThanOrEqual(1);
  });
});

describe('finding the cuts', () => {
  const times = [0, 1, 2, 3, 4];
  const hists = [
    histogram(solid(200, 30, 30)),
    histogram(solid(200, 30, 30)),
    histogram(solid(20, 20, 220)),   // hard cut to a different scene
    histogram(solid(20, 20, 220)),
    histogram(solid(20, 20, 220)),
  ];

  it('finds the one real cut and nothing else', () => {
    expect(detectCuts(hists, times)).toEqual([2]);
  });

  it('does not call a gentle change a cut', () => {
    const drift = [histogram(solid(100, 100, 100)), histogram(solid(112, 112, 112))];
    expect(detectCuts(drift, [0, 1])).toEqual([]);
  });

  it('turns cuts into shots that cover the whole video', () => {
    const list = shots(scanOf([[0, 0.5, 0]], 10, [4]));
    expect(list).toEqual([[0, 4], [4, 10]]);
  });
});

describe('where the action is', () => {
  const scan = scanOf([
    [0, 0.5, 0.00], [1, 0.5, 0.01], [2, 0.5, 0.02], [3, 0.5, 0.01],
    [4, 0.5, 0.40], [5, 0.5, 0.45], [6, 0.5, 0.50], [7, 0.5, 0.42],
    [8, 0.5, 0.01], [9, 0.5, 0.00],
  ], 10);

  it('averages movement over a span', () => {
    expect(motionBetween(scan, 4, 8)).toBeCloseTo(0.4425, 3);
    expect(motionBetween(scan, 0, 4)).toBeLessThan(0.05);
  });

  it('picks the busy stretch, not the still one', () => {
    const [best] = busiestSpans(scan, 1, 4);
    expect(best.startS).toBeGreaterThanOrEqual(3.5);
    expect(best.endS).toBeLessThanOrEqual(8.5);
  });

  it('does not hand back the same moment three times over', () => {
    const spans = busiestSpans(scan, 3, 4);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].startS, 'the spans overlap').toBeGreaterThanOrEqual(spans[i - 1].endS);
    }
  });
});

describe('black footage', () => {
  it('finds a fade at the head of the clip', () => {
    const scan = scanOf([
      [0, 0.00, 0], [0.5, 0.01, 0], [1, 0.02, 0], [1.5, 0.40, 0.2], [2, 0.45, 0.1],
    ], 3);
    expect(darkSpans(scan)).toEqual([[0, 1.5]]);
  });

  it('leaves ordinary dark footage alone', () => {
    const scan = scanOf([[0, 0.2, 0], [1, 0.22, 0], [2, 0.19, 0]], 3);
    expect(darkSpans(scan)).toEqual([]);
  });
});

describe('what gets told to the model', () => {
  const scan = scanOf([
    [0, 0.05, 0], [1, 0.06, 0.01], [2, 0.5, 0.3], [3, 0.52, 0.35], [4, 0.5, 0.02],
  ], 5, [2]);

  it('reports the cuts it measured', () => {
    expect(summariseVisual(scan)).toMatch(/1 shot change, at 2\.0s/);
  });

  it('says when there were none rather than staying silent', () => {
    expect(summariseVisual(scanOf([[0, 0.5, 0], [1, 0.5, 0.1]], 2)))
      .toMatch(/one continuous shot/);
  });

  it('mentions the black at the start', () => {
    expect(summariseVisual(scan)).toMatch(/black or near-black at 0\.0s/);
  });

  it('reads one long busy stretch as one, not three', () => {
    const busy = scanOf(
      Array.from({ length: 60 }, (_, i) => [i, 0.5, i >= 20 && i < 40 ? 0.5 : 0.001] as [number, number, number]),
      60);
    const said = summariseVisual(busy);
    expect(said).toMatch(/most movement around \d+\.\ds-\d+\.\ds$/m);
    expect(said.match(/s-\d+\.\ds/g) ?? []).toHaveLength(1);
  });

  it('has nothing to say when nothing was measured', () => {
    expect(summariseVisual(null)).toBe('');
    expect(summariseVisual(scanOf([], 10))).toBe('');
  });
});

describe('which frames a model gets to see', () => {
  it('takes the middle of each shot', () => {
    const scan = scanOf([[0, 0.5, 0]], 20, [10]);
    expect(keyframeTimes(scan, 2)).toEqual([5, 15]);
  });

  it('spreads them out when there are no cuts at all', () => {
    const times = keyframeTimes(scanOf([[0, 0.5, 0]], 60), 4);
    expect(times).toHaveLength(4);
    expect(times[0]).toBeLessThan(times[3]);
    expect(times[3]).toBeLessThan(60);
  });

  it('never hands over more than it was asked for', () => {
    const many = scanOf([[0, 0.5, 0]], 100, [5, 12, 20, 33, 41, 55, 62, 70, 88]);
    expect(keyframeTimes(many, 6)).toHaveLength(6);
  });

  it('has nothing to offer for an empty scan', () => {
    expect(keyframeTimes(null)).toEqual([]);
  });
});

describe('what travels over the wire', () => {
  it('thins a long scan without losing its shape', () => {
    const samples: [number, number, number][] =
      Array.from({ length: 1200 }, (_, i) => [i * 0.5, 0.5, i > 600 ? 0.4 : 0.01]);
    const small = compactScan(scanOf(samples, 600));
    expect(small.samples.length).toBeLessThanOrEqual(300);
    expect(small.durationS).toBe(600);
    expect(motionBetween(small, 400, 500)).toBeGreaterThan(0.3);
  });

  it('leaves a short scan exactly as it was', () => {
    const scan = scanOf([[0, 0.5, 0], [1, 0.5, 0.1]], 2);
    expect(compactScan(scan)).toBe(scan);
  });
});
