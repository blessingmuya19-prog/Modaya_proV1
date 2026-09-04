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

  it('handles "don\'t cut anything / sont cut anything / keep whole video"', () => {
    const r1 = refineProfile(profile(), 'sont cut anything');
    expect(r1.changed).toBe(true);
    expect(r1.profile.uncut).toBe(true);
    expect(r1.reply).toMatch(/100%|no cuts|footage/i);

    const r2 = refineProfile(profile(), 'i did not ask for the cut');
    expect(r2.changed).toBe(true);
    expect(r2.profile.uncut).toBe(true);

    const r3 = refineProfile(profile(), 'keep all the footage without trimming');
    expect(r3.changed).toBe(true);
    expect(r3.profile.uncut).toBe(true);

    const r4 = refineProfile(profile(), 'stop this thing of adding cuts and other edits it should only add what user asks for');
    expect(r4.changed).toBe(true);
    expect(r4.profile.uncut).toBe(true);
    expect(r4.profile.punchInRate).toBe(0);
    expect(r4.reply).toMatch(/stopped adding cuts|what you ask for/i);

    const r5 = refineProfile(profile(), 'only add what user asks for');
    expect(r5.changed).toBe(true);
    expect(r5.profile.uncut).toBe(true);
  });

  it('handles aspect ratio requests', () => {
    const wide = refineProfile(profile(), 'make it 16:9 widescreen');
    expect(wide.changed).toBe(true);
    expect(wide.profile.targetRatio).toBe('16:9');

    const vert = refineProfile(profile(), 'change to vertical 9:16 for tiktok');
    expect(vert.changed).toBe(true);
    expect(vert.profile.targetRatio).toBe('9:16');

    const orig = refineProfile(profile(), 'keep original format');
    expect(orig.changed).toBe(true);
    expect(orig.profile.targetRatio).toBe('original');
  });

  it('removes punch-ins on request', () => {
    const r = refineProfile(profile({ punchInRate: 0.5, punchInMax: 1.2 }), 'no punch-ins please, flat camera');
    expect(r.changed).toBe(true);
    expect(r.profile.punchInRate).toBe(0);
    expect(r.profile.punchInMax).toBe(1);
  });

  it('resets colour grade on request', () => {
    const r = refineProfile(profile({ grade: { brightness: 0.2, contrast: 0.1, saturation: 0.3, warmth: 0.2 } }), 'reset colour to natural');
    expect(r.changed).toBe(true);
    expect(r.profile.grade.warmth).toBe(0);
    expect(r.profile.grade.saturation).toBe(0);
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

  it('intelligently answers "where\'s the captions"', () => {
    const r = refineProfile(profile(), "where's the captions");
    expect(r.changed).toBe(true);
    expect(r.profile.captions.present).toBe(true);
    expect(r.reply).toMatch(/captions/i);
  });

  it('handles caption position shifts', () => {
    const center = refineProfile(profile(), 'move captions to center');
    expect(center.changed).toBe(true);
    expect(center.profile.captions.position).toBe('centre');

    const lower = refineProfile(profile(), 'lower captions');
    expect(lower.changed).toBe(true);
    expect(lower.profile.captions.position).toBe('lower');
  });

  it('answers "what did you change" with contextual summary', () => {
    const r = refineProfile(profile(), 'what did you change');
    expect(r.changed).toBe(false);
    expect(r.reply).toMatch(/analyzed your footage|pacing|grade|captions/i);
  });

  it('answers "how to export"', () => {
    const r = refineProfile(profile(), 'how do i export my video');
    expect(r.changed).toBe(false);
    expect(r.reply).toMatch(/export/i);
  });

  it('answers "help"', () => {
    const r = refineProfile(profile(), 'help me');
    expect(r.changed).toBe(false);
    expect(r.reply).toMatch(/uncut|captions|pacing/i);
  });

  it('applies pro/cinematic preset', () => {
    const r = refineProfile(profile(), 'make it look professional');
    expect(r.changed).toBe(true);
    expect(r.profile.captions.present).toBe(true);
    expect(r.profile.punchInRate).toBeGreaterThan(0.2);
  });

  it('applies cinematic LUT presets like Teal & Orange, Kodak 35mm, and Noir', () => {
    const directGrade = refineProfile(profile(), 'color grade');
    expect(directGrade.changed).toBe(true);
    expect(directGrade.profile.grade.contrast).toBeGreaterThan(0);
    expect(directGrade.profile.grade.saturation).toBeGreaterThan(0);

    const gradeFootage = refineProfile(profile(), 'color grade the footage');
    expect(gradeFootage.changed).toBe(true);
    expect(gradeFootage.profile.grade.contrast).toBeGreaterThan(0);

    const to = refineProfile(profile(), 'apply teal and orange grade');
    expect(to.changed).toBe(true);
    expect(to.profile.grade.warmth).toBeGreaterThan(0);
    expect(to.profile.grade.contrast).toBeGreaterThan(0);

    const refGrade = refineProfile(profile({ grade: { brightness: 0.05, contrast: 0.2, saturation: 0.15, warmth: 0.12 } }), 'color grade the footage like reference video');
    expect(refGrade.changed).toBe(true);
    expect(refGrade.profile.grade.warmth).toBeGreaterThan(0);
    expect(refGrade.reply).toMatch(/reference/i);

    const kodak = refineProfile(profile(), 'give it a 35mm film look');
    expect(kodak.changed).toBe(true);
    expect(kodak.profile.grade.warmth).toBeGreaterThan(0);

    const noir = refineProfile(profile(), 'make it black and white noir');
    expect(noir.changed).toBe(true);
    expect(noir.profile.grade.saturation).toBe(-1);
  });

  it('handles selective reference editing requests', () => {
    const refColor = refineProfile(profile(), 'only match reference color');
    expect(refColor.changed).toBe(true);
    expect(refColor.profile.uncut).toBe(true);
    expect(refColor.reply).toMatch(/color/i);

    const refCaps = refineProfile(profile(), 'only match reference captions');
    expect(refCaps.changed).toBe(true);
    expect(refCaps.profile.uncut).toBe(true);
    expect(refCaps.profile.captions.present).toBe(true);

    const uncutRef = refineProfile(profile(), 'keep whole video and match reference');
    expect(uncutRef.changed).toBe(true);
    expect(uncutRef.profile.uncut).toBe(true);

    const askRef = refineProfile(profile(), 'what about for reference edit');
    expect(askRef.changed).toBe(false);
    expect(askRef.reply).toMatch(/reference edit/i);
  });

  it('answers "can it color grade" with informative guidance', () => {
    const r = refineProfile(profile(), 'can you color grade');
    expect(r.changed).toBe(false);
    expect(r.reply).toMatch(/color grad|teal and orange|kodak/i);
  });
});
