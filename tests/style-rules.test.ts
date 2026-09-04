/**
 * Style rules: the interpretation layer between raw measurement and the AI.
 * A profile is numbers; these tests pin what those numbers MEAN.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveStyleRules, rhythmCharacter, openShotLength, gradeSummary,
  styleRulesText, captionColourName,
} from '@/lib/ai/styleRules';
import type { StyleProfile } from '@/lib/ai/styleProfile';

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    sourceName: 'ruleref.mp4', durationS: 60, cuts: [2.1, 6.3], cutsPerMin: 20,
    shotMeanS: 3.0, shotMedianS: 2.9, shotVariance: 0.4, pace: 'fast',
    grade: { brightness: 0.1, contrast: 0.3, saturation: 0.4, warmth: 0.2 },
    punchInRate: 0.5, punchInMax: 1.15,
    captions: { present: true, position: 'lower', emphasis: 0.8, animated: true, highlightColour: '#facc15' },
    beatSynced: true, bpm: 121, energy: 0.75, ...over,
  };
}

describe('deriveStyleRules', () => {
  it('carries every measured axis into the rule card', () => {
    const r = deriveStyleRules(profile());
    expect(r.pace).toMatchObject({ cutsPerMin: 20, meanShotS: 3, variance: 0.4 });
    expect(r.beat).toMatchObject({ synced: true, bpm: 121, energy: 0.75 });
    expect(r.motion).toMatchObject({ punchInRate: 0.5, punchInMax: 1.15 });
    expect(r.captions).toMatchObject({
      present: true, position: 'lower', animated: true, highlightColour: '#facc15',
    });
    expect(r.grade.warmth).toBe(0.2);
    expect(r.grade.summary).toBe('warm, saturated, high-contrast, bright grade');
  });

  it('names the opening shot from the first measured cut', () => {
    expect(deriveStyleRules(profile()).pace.openShotS).toBe(2.1);
    expect(deriveStyleRules(profile({ cuts: [] })).pace.openShotS).toBeNull();
  });

  it('classifies rhythm character from variance', () => {
    expect(rhythmCharacter(0.1)).toBe('metronome');
    expect(rhythmCharacter(0.4)).toBe('punctuated');
    expect(rhythmCharacter(0.9)).toBe('loose');
  });

  it('never invents style for a neutral reference', () => {
    const neutral = deriveStyleRules(profile({
      grade: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
      captions: { present: false, position: 'lower', emphasis: 0 },
      beatSynced: false, bpm: null, punchInRate: 0, cuts: [],
    }));
    expect(neutral.grade.summary).toBe('neutral grade');
    expect(neutral.captions.present).toBe(false);
    expect(neutral.beat.synced).toBe(false);
  });
});

describe('gradeSummary', () => {
  it('names the look like a colourist', () => {
    expect(gradeSummary({ brightness: 0.1, contrast: 0.4, saturation: 0.5, warmth: 0.3 }))
      .toBe('warm, saturated, high-contrast, bright grade');
    expect(gradeSummary({ brightness: 0, contrast: 0, saturation: 0, warmth: 0 }))
      .toBe('neutral grade');
  });
});

describe('styleRulesText', () => {
  it('reads like an editor briefing the AI', () => {
    const text = styleRulesText(profile(), 'my-reference.mp4');
    expect(text).toContain('Style of "my-reference.mp4"');
    expect(text).toContain('~20 cuts per minute');
    expect(text).toContain('rhythm character: punctuated');
    expect(text).toContain('~121 BPM');
    expect(text).toContain('push-ins on ~50% of shots');
    expect(text).toContain('bold captions along the bottom');
    expect(text).toContain('yellow highlights');
    expect(text).toContain('opening shot: 2.1s long');
  });

  it('keeps the phrases the grounding style lock parses', () => {
    const text = styleRulesText(profile());
    expect(text).toMatch(/bold captions along the (bottom|middle)/);
    expect(text).toMatch(/~?\d+ cuts per minute|single uncut take/);
  });
});

describe('captionColourName', () => {
  it('names measured highlight colours', () => {
    expect(captionColourName('#facc15')).toBe('yellow');
    expect(captionColourName('#22c55e')).toBe('green');
    expect(captionColourName('#ef4444')).toBe('red');
    expect(captionColourName('#ffffff')).toBe('white');
  });
});
