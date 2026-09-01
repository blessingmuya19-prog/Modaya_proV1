/**
 * Refinement: plain-language "tell Modaya what to change" must map to bounded
 * style-profile changes so the EditPlan can regenerate — never a free-form or
 * unbounded edit.
 */
import { describe, it, expect } from 'vitest';
import { refineProfile } from '@/lib/studio/refine';
import type { StyleProfile } from '@/lib/ai/styleProfile';

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    sourceName: 'test', durationS: 60, cuts: [], cutsPerMin: 12,
    shotMeanS: 5, shotMedianS: 4.5, shotVariance: 0.5, pace: 'medium',
    grade: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
    punchInRate: 0.2, punchInMax: 1.1,
    captions: { present: true, position: 'lower', emphasis: 0.3 },
    beatSynced: false, bpm: null, energy: 0.5, ...over,
  };
}

describe('refineProfile', () => {
  it('never mutates the input profile', () => {
    const base = profile();
    const snap = JSON.stringify(base);
    refineProfile(base, 'make it more energetic');
    expect(JSON.stringify(base)).toBe(snap);
  });

  it('speeds up pacing for "more energetic"', () => {
    const r = refineProfile(profile(), 'make this more energetic');
    expect(r.changed).toBe(true);
    expect(r.profile.cutsPerMin).toBeGreaterThan(12);
    expect(r.profile.energy).toBeGreaterThan(0.5);
  });

  it('slows pacing for "too fast / more relaxed"', () => {
    const r = refineProfile(profile({ cutsPerMin: 40 }), 'it feels too fast, make it calmer');
    expect(r.changed).toBe(true);
    expect(r.profile.cutsPerMin).toBeLessThan(40);
  });

  it('treats "the intro is too slow" as tightening', () => {
    const r = refineProfile(profile(), 'the intro is too slow');
    expect(r.changed).toBe(true);
    expect(r.profile.cutsPerMin).toBeGreaterThan(12);
    expect(r.reply).toMatch(/up front|pacing|tight/i);
  });

  it('adds punch-ins on request', () => {
    const r = refineProfile(profile({ punchInRate: 0.2 }), 'use more punch-ins like the reference');
    expect(r.profile.punchInRate).toBeGreaterThan(0.2);
  });

  it('removes captions on request', () => {
    const r = refineProfile(profile(), 'remove the captions');
    expect(r.profile.captions.present).toBe(false);
  });

  it('turns captions on and emphasises them when asked for more', () => {
    const r = refineProfile(profile({ captions: { present: false, position: 'lower', emphasis: 0.2 } }), 'use the reference captions more');
    expect(r.profile.captions.present).toBe(true);
    expect(r.profile.captions.emphasis).toBeGreaterThan(0.2);
  });

  it('warms / cools the grade', () => {
    const warm = refineProfile(profile(), 'make it warmer');
    expect(warm.profile.grade.warmth).toBeGreaterThan(0);
    const cool = refineProfile(profile(), 'cooler tones please');
    expect(cool.profile.grade.warmth).toBeLessThan(0);
  });

  it('shortens the whole edit by raising energy', () => {
    const r = refineProfile(profile(), 'make it shorter');
    expect(r.profile.energy).toBeGreaterThan(0.5);
  });

  it('stays within bounded ranges for extreme inputs', () => {
    let p = profile({ cutsPerMin: 55, punchInRate: 0.9, energy: 0.95 });
    for (let i = 0; i < 10; i++) p = refineProfile(p, 'faster more punch-ins more energetic shorter').profile;
    expect(p.cutsPerMin).toBeLessThanOrEqual(60);
    expect(p.punchInRate).toBeLessThanOrEqual(1);
    expect(p.energy).toBeLessThanOrEqual(1);
    expect(p.shotMeanS).toBeGreaterThanOrEqual(1);
  });

  it('reports no change with guidance for something it cannot do', () => {
    const r = refineProfile(profile(), 'add b-roll from my holiday footage');
    expect(r.changed).toBe(false);
    expect(r.reply).toMatch(/b-roll/i);
  });

  it('offers guidance for an unrecognised request', () => {
    const r = refineProfile(profile(), 'make it smell nicer');
    expect(r.changed).toBe(false);
    expect(r.reply).toMatch(/pacing|punch|caption/i);
  });
});
