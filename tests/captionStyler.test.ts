import { describe, it, expect } from 'vitest';
import {
  extractTimedWords,
  getWordAnimationState,
  CAPTION_PRESETS,
} from '@/lib/render/captionStyler';

describe('kinetic subtitle karaoke styling & animations', () => {
  it('contains viral preset definitions with correct styling attributes', () => {
    expect(CAPTION_PRESETS.mrbeast).toBeDefined();
    expect(CAPTION_PRESETS.mrbeast.highlightColour).toBe('#FACC15');
    expect(CAPTION_PRESETS.mrbeast.animation).toBe('karaoke_pop');
    expect(CAPTION_PRESETS.mrbeast.uppercase).toBe(true);

    expect(CAPTION_PRESETS.hormozi).toBeDefined();
    expect(CAPTION_PRESETS.hormozi.highlightColour).toBe('#22C55E');
    expect(CAPTION_PRESETS.hormozi.background).toBe('box');

    expect(CAPTION_PRESETS.neonglow).toBeDefined();
    expect(CAPTION_PRESETS.neonglow.animation).toBe('karaoke_glow');
  });

  it('interpolates word timings across phrase duration when raw words are not supplied', () => {
    const text = 'This is Modaya AI editor';
    const startS = 10.0;
    const endS = 15.0; // 5 seconds across 5 words -> 1.0s per word

    const words = extractTimedWords(text, startS, endS);
    expect(words).toHaveLength(5);
    expect(words[0].word).toBe('This');
    expect(words[0].startS).toBeCloseTo(10.0);
    expect(words[0].endS).toBeCloseTo(11.0);

    expect(words[4].word).toBe('editor');
    expect(words[4].startS).toBeCloseTo(14.0);
    expect(words[4].endS).toBeCloseTo(15.0);
  });

  it('calculates active word state and bounce pop scaling during playback', () => {
    const word = { word: 'Viral', startS: 2.0, endS: 3.0 };

    // Before word starts (t = 1.5s)
    const before = getWordAnimationState(word, 1.5, 'karaoke_pop');
    expect(before.isActive).toBe(false);
    expect(before.isPast).toBe(false);
    expect(before.scale).toBe(1.0);

    // Mid-word start bounce (t = 2.15s, within 30% attack phase)
    const activeBounce = getWordAnimationState(word, 2.15, 'karaoke_pop');
    expect(activeBounce.isActive).toBe(true);
    expect(activeBounce.isPast).toBe(false);
    expect(activeBounce.scale).toBeGreaterThan(1.0);

    // After word completes (t = 3.5s)
    const after = getWordAnimationState(word, 3.5, 'karaoke_pop');
    expect(after.isActive).toBe(false);
    expect(after.isPast).toBe(true);
    expect(after.scale).toBe(1.0);
  });

  it('supports progressive typewriter reveal animation', () => {
    const word = { word: 'Caption', startS: 5.0, endS: 6.0 };

    // Before word starts -> hidden (opacity 0)
    const hidden = getWordAnimationState(word, 4.8, 'typewriter');
    expect(hidden.opacity).toBe(0.0);

    // During & after word -> visible (opacity 1)
    const visible = getWordAnimationState(word, 5.2, 'typewriter');
    expect(visible.opacity).toBe(1.0);

    const past = getWordAnimationState(word, 6.5, 'typewriter');
    expect(past.opacity).toBe(1.0);
  });
});
