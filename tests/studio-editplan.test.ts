/**
 * The EditPlan brain: given a learned style profile + source energy/transcript,
 * it must pick the strongest moments (hook first for shorts), fit the right
 * frame format, place real captions, and stay in bounds and non-overlapping.
 */
import { describe, it, expect } from 'vitest';
import { composeStudioPlan, chooseMoments } from '@/lib/studio/editPlan';
import type { StyleProfile } from '@/lib/ai/styleProfile';

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    sourceName: 'modaya-default', durationS: 45, cuts: [], cutsPerMin: 30,
    shotMeanS: 2, shotMedianS: 1.8, shotVariance: 0.6, pace: 'very fast',
    grade: { brightness: 0, contrast: 0.05, saturation: 0.08, warmth: 0 },
    punchInRate: 0.4, punchInMax: 1.12,
    captions: { present: true, position: 'lower', emphasis: 0.4 },
    beatSynced: false, bpm: null, energy: 0.7, ...over,
  };
}

/** Interest curve with a clear spike around 120-150s. */
function interestWithSpike(dur = 300, spike: [number, number] = [120, 150]): number[] {
  return Array.from({ length: dur }, (_, t) => (t >= spike[0] && t < spike[1] ? 0.95 : 0.2));
}

describe('chooseMoments', () => {
  it('keeps windows within the source and near the target total length', () => {
    const m = chooseMoments({ durationS: 300, targetS: 45, interest: interestWithSpike(), hookFirst: true });
    expect(m.length).toBeGreaterThan(0);
    for (const w of m) {
      expect(w.s).toBeGreaterThanOrEqual(0);
      expect(w.e).toBeLessThanOrEqual(300.001);
      expect(w.e - w.s).toBeGreaterThan(0);
    }
    const total = m.reduce((a, w) => a + (w.e - w.s), 0);
    expect(total).toBeLessThanOrEqual(48);
    expect(total).toBeGreaterThan(15);
  });

  it('hook-first includes the strongest (spike) region', () => {
    const m = chooseMoments({ durationS: 300, targetS: 45, interest: interestWithSpike(), hookFirst: true });
    const coversSpike = m.some(w => w.s >= 100 && w.s <= 150);
    expect(coversSpike).toBe(true);
  });

  it('returns something even with no interest data', () => {
    const m = chooseMoments({ durationS: 60, targetS: 40, hookFirst: true });
    expect(m.length).toBeGreaterThan(0);
  });
});

describe('composeStudioPlan — short mode', () => {
  const transcript = Array.from({ length: 20 }, (_, i) => ({
    startS: 120 + i * 3, endS: 120 + i * 3 + 2.6,
    text: `Line number ${i} about the big moment.`,
  }));

  const plan = composeStudioPlan({
    profile: profile(), sourceDurationS: 300,
    interest: interestWithSpike(), transcript,
  });

  it('targets a vertical 9:16 frame for a short reference', () => {
    expect(plan.frame.ratio).toBe('9:16');
    expect(plan.frame.height).toBeGreaterThan(plan.frame.width);
    expect(plan.hookFirst).toBe(true);
  });

  it('cover-crops video clips for the vertical frame', () => {
    const vids = plan.clips.filter(c => c.type === 'video');
    expect(vids.length).toBeGreaterThan(0);
    expect(vids.every(v => v.transform.fit === 'cover')).toBe(true);
  });

  it('maps transcript lines into caption clips on the programme timeline', () => {
    expect(plan.captions).toBeGreaterThan(0);
    const caps = plan.clips.filter(c => c.type === 'text');
    expect(caps.length).toBeGreaterThan(0);
    // captions use the subtitle track and carry real words
    expect(caps.some(c => c.trackId === 'subs')).toBe(true);
    expect(caps[0].label).toMatch(/moment|Line/i);
    // captions stay within the output duration
    for (const c of caps) {
      expect(c.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
    }
  });

  it('keeps every clip inside the output and video shots non-overlapping', () => {
    const vids = plan.clips.filter(c => c.type === 'video').sort((a, b) => a.startS - b.startS);
    for (const c of plan.clips) {
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
      expect(c.endS - c.startS).toBeGreaterThan(0);
    }
    for (let i = 1; i < vids.length; i++) {
      expect(vids[i].startS).toBeGreaterThanOrEqual(vids[i - 1].endS - 0.01);
    }
  });

  it('reads video shots from the right source ranges (sourceIn set)', () => {
    const vids = plan.clips.filter(c => c.type === 'video');
    expect(vids.every(v => v.sourceIn >= 0)).toBe(true);
  });
});

describe('composeStudioPlan — full re-cut', () => {
  it('uses a landscape frame and keeps more footage for a long reference', () => {
    const long = profile({ sourceName: 'long-ref', durationS: 600, cutsPerMin: 12, pace: 'medium' });
    const plan = composeStudioPlan({
      profile: long, sourceDurationS: 300, interest: interestWithSpike(),
    });
    expect(plan.frame.ratio).toBe('16:9');
    expect(plan.hookFirst).toBe(false);
    // a re-cut removes material but keeps a substantial programme
    expect(plan.durationS).toBeGreaterThan(120);
  });
});
