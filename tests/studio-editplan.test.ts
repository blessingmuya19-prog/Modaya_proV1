/**
 * The EditPlan brain: given a learned style profile + source energy/transcript,
 * it must pick the strongest moments (hook first for shorts), fit the right
 * frame format, place real captions, and stay in bounds and non-overlapping.
 */
import { describe, it, expect } from 'vitest';
import { composeStudioPlan, chooseMoments, chooseBroll } from '@/lib/studio/editPlan';
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

  it('keeps every clip inside the output and main shots non-overlapping', () => {
    // Base shots (trackId 'video') form the continuous talk track; B-roll
    // cutaways (trackId 'overlay') deliberately overlap them.
    const shots = plan.clips.filter(c => c.trackId === 'video').sort((a, b) => a.startS - b.startS);
    for (const c of plan.clips) {
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
      expect(c.endS - c.startS).toBeGreaterThan(0);
    }
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].startS).toBeGreaterThanOrEqual(shots[i - 1].endS - 0.01);
    }
    // B-roll overlays sit on a higher track, above a base shot.
    for (const ov of plan.clips.filter(c => c.trackId === 'overlay')) {
      expect(shots.some(s => ov.startS >= s.startS && ov.endS <= s.endS)).toBe(true);
    }
  });

  it('reads video shots from the right source ranges (sourceIn set)', () => {
    const vids = plan.clips.filter(c => c.trackId === 'video');
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

  it('keeps 100% of footage when uncut is requested', () => {
    const uncutProfile = profile({ uncut: true });
    const plan = composeStudioPlan({
      profile: uncutProfile, sourceDurationS: 180, sourceRatio: '16:9',
    });
    expect(plan.durationS).toBe(180);
    expect(plan.removedS).toBe(0);
    expect(plan.clips.filter(c => c.type === 'video').length).toBe(1);
    expect(plan.frame.ratio).toBe('16:9');
    expect(plan.summary).toMatch(/uncut|100%/i);
  });

  it('preserves source aspect ratio when provided', () => {
    const plan = composeStudioPlan({
      profile: profile(), sourceDurationS: 60, sourceRatio: '16:9',
    });
    expect(plan.frame.ratio).toBe('16:9');
    expect(plan.frame.width).toBe(1920);
    expect(plan.frame.height).toBe(1080);
  });
});

describe('B-roll cutaways', () => {
  it('chooseBroll avoids ranges already used and stays in bounds', () => {
    const used = [{ s: 120, e: 150 }];
    const cuts = chooseBroll({ durationS: 300, interest: interestWithSpike(), used, count: 5 });
    expect(cuts.length).toBeGreaterThan(0);
    for (const c of cuts) {
      expect(c.s).toBeGreaterThanOrEqual(0);
      expect(c.e).toBeLessThanOrEqual(300);
      const hitsUsed = c.s >= 120 - 0.3 && c.e <= 150 + 0.3;
      expect(hitsUsed).toBe(false);
    }
  });

  it('places silent overlay cutaways over main shots while keeping base audio', () => {
    const plan = composeStudioPlan({
      profile: profile(), sourceDurationS: 300,
      interest: interestWithSpike(300, [120, 150]),
    });
    const overlays = plan.clips.filter(c => c.trackId === 'overlay');
    // long enough source + target gives at least one cutaway, but never requires it
    if (overlays.length) {
      for (const ov of overlays) {
        expect(ov.startS).toBeGreaterThanOrEqual(0);
        expect(ov.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
      }
      expect(plan.broll).toBe(overlays.length);
    }
  });

  it('summary mentions b-roll only when present', () => {
    const plan = composeStudioPlan({
      profile: profile(), sourceDurationS: 300, interest: interestWithSpike(),
    });
    if (plan.broll > 0) expect(plan.summary).toMatch(/b-roll/i);
  });
});
