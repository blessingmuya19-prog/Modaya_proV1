/**
 * Human intuition: the vibe sliders are a directed creative brief on top of
 * the measured reference — clamped, centered, deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  clampVibe, applyVibe, vibeMultiplier, vibePromptLine, DEFAULT_VIBE,
} from '@/lib/ai/vibe';
import type { StyleProfile } from '@/lib/ai/styleProfile';

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    sourceName: 'vibes', durationS: 60, cuts: [], cutsPerMin: 12,
    shotMeanS: 5, shotMedianS: 4.8, shotVariance: 0.4, pace: 'medium',
    grade: { brightness: 0.1, contrast: 0.3, saturation: 0.4, warmth: 0.2 },
    punchInRate: 0.4, punchInMax: 1.12,
    captions: { present: true, position: 'lower', emphasis: 0.6 },
    beatSynced: false, bpm: null, energy: 0.5, ...over,
  };
}

describe('clampVibe', () => {
  it('defaults to the measured neutral and clamps wild input', () => {
    expect(clampVibe(undefined)).toEqual(DEFAULT_VIBE);
    expect(clampVibe({ aggression: 9, literalism: -3 }))
      .toEqual({ aggression: 1, literalism: 0 });
  });
});

describe('vibeMultiplier', () => {
  it('is centered on 0.5 — as measured stays as measured', () => {
    expect(vibeMultiplier(0.5)).toBeCloseTo(1.0);
    expect(vibeMultiplier(0)).toBeLessThan(1);
    expect(vibeMultiplier(1)).toBeGreaterThan(1);
  });
});

describe('applyVibe', () => {
  it('aggression tightens the cut rhythm around the reference cadence', () => {
    const { profile: p } = applyVibe(profile(), { aggression: 1, literalism: 0.5 });
    expect(p.cutsPerMin).toBeGreaterThan(profile().cutsPerMin);
    expect(p.shotMeanS).toBeLessThan(profile().shotMeanS);

    const { profile: q } = applyVibe(profile(), { aggression: 0, literalism: 0.5 });
    expect(q.cutsPerMin).toBeLessThan(profile().cutsPerMin);
  });

  it('literalism scales caption emphasis but never leaves the band', () => {
    const { profile: p } = applyVibe(profile(), { aggression: 0.5, literalism: 1 });
    expect(p.captions.emphasis).toBeLessThanOrEqual(1);
    expect(p.captions.emphasis).toBeGreaterThan(profile().captions.emphasis);
  });

  it('the reference as measured (0.5/0.5) moves nothing', () => {
    const { profile: p, note } = applyVibe(profile(), DEFAULT_VIBE);
    expect(p.cutsPerMin).toBe(profile().cutsPerMin);
    expect(p.shotMeanS).toBe(profile().shotMeanS);
    expect(p.captions.emphasis).toBe(profile().captions.emphasis);
    expect(note).toBe('as measured');
  });
});

describe('vibePromptLine', () => {
  it('reads like a director briefing the editor', () => {
    const line = vibePromptLine({ aggression: 0.9, literalism: 0.2 });
    expect(line).toContain('aggressive jump-cut');
    expect(line).toContain('only key concepts get text');
    expect(line).toContain('pacing weight 0.90');
    expect(line).toContain('caption literalism 0.20');
  });
});
