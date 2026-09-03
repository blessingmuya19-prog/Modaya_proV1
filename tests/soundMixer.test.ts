import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MIXER_CONFIG,
  MIX_PRESETS,
  softLimit,
  getEffectiveTrackGain,
  mixdownPcmTracks,
  type MultiTrackMixerConfig,
} from '@/lib/audio/soundMixer';
import type { SpeechSegment } from '@/lib/audio/ducking';

describe('multi-track sound mixer', () => {
  const speech: SpeechSegment[] = [
    { startS: 2.0, endS: 4.0 },
  ];

  it('calculates effective gains for individual channels with volume scaling', () => {
    const config: MultiTrackMixerConfig = {
      ...DEFAULT_MIXER_CONFIG,
      master: { volume: 0.8, muted: false, solo: false },
      voice:  { volume: 1.0, muted: false, solo: false, ducking: false },
      music:  { volume: 0.5, muted: false, solo: false, ducking: true },
      voiceEnhance: false,
    };

    const voiceGain = getEffectiveTrackGain('voice', 1.0, config, speech);
    expect(voiceGain).toBeCloseTo(0.8 * 1.0, 2);

    const musicGainBeforeSpeech = getEffectiveTrackGain('music', 1.0, config, speech);
    expect(musicGainBeforeSpeech).toBeCloseTo(0.8 * 0.5, 2);

    // During speech (at t = 3.0s), music gets ducked
    const musicGainDuringSpeech = getEffectiveTrackGain('music', 3.0, config, speech);
    expect(musicGainDuringSpeech).toBeLessThan(musicGainBeforeSpeech);
  });

  it('mutes all tracks when master is muted', () => {
    const config: MultiTrackMixerConfig = {
      ...DEFAULT_MIXER_CONFIG,
      master: { volume: 1.0, muted: true, solo: false },
    };

    expect(getEffectiveTrackGain('voice', 1.0, config)).toBe(0);
    expect(getEffectiveTrackGain('music', 1.0, config)).toBe(0);
    expect(getEffectiveTrackGain('broll', 1.0, config)).toBe(0);
  });

  it('respects solo track state by silencing non-solo tracks', () => {
    const config: MultiTrackMixerConfig = {
      ...DEFAULT_MIXER_CONFIG,
      voice: { volume: 1.0, muted: false, solo: true },
      music: { volume: 0.8, muted: false, solo: false },
    };

    expect(getEffectiveTrackGain('voice', 1.0, config)).toBeGreaterThan(0);
    expect(getEffectiveTrackGain('music', 1.0, config)).toBe(0);
  });

  it('applies soft limiter to prevent digital clipping', () => {
    expect(softLimit(0.5)).toBe(0.5);
    expect(softLimit(-0.5)).toBe(-0.5);

    // Inputs exceeding 1.0 are smoothly limited below 1.0
    const limitedHigh = softLimit(2.5);
    expect(limitedHigh).toBeLessThan(1.0);
    expect(limitedHigh).toBeGreaterThan(0.92);

    const limitedNeg = softLimit(-2.5);
    expect(limitedNeg).toBeGreaterThan(-1.0);
    expect(limitedNeg).toBeLessThan(-0.92);
  });

  it('mixes down multiple PCM tracks with ducking and limiter applied', () => {
    const sampleRate = 1000;
    const len = 5000; // 5 seconds
    const voice = new Float32Array(len).fill(0.3);
    const music = new Float32Array(len).fill(0.4);

    const config: MultiTrackMixerConfig = {
      ...DEFAULT_MIXER_CONFIG,
      master: { volume: 1.0, muted: false, solo: false },
      voice:  { volume: 1.0, muted: false, solo: false, ducking: false },
      music:  { volume: 1.0, muted: false, solo: false, ducking: true },
      voiceEnhance: false,
    };

    const mixed = mixdownPcmTracks({ voice, music }, sampleRate, config, speech);
    expect(mixed.length).toBe(len);

    // At t = 0.5s (before speech): voice (0.3) + music (0.4) = 0.7
    expect(mixed[500]).toBeCloseTo(0.7, 1);

    // At t = 3.0s (during speech): voice (0.3) + music ducked (~0.4 * 0.22 = 0.088) ≈ 0.388
    expect(mixed[3000]).toBeLessThan(0.5);
  });

  it('provides well-defined standard mixing presets', () => {
    expect(MIX_PRESETS['dialogue_focus']).toBeDefined();
    expect(MIX_PRESETS['cinematic']).toBeDefined();
    expect(MIX_PRESETS['music_forward']).toBeDefined();
    expect(MIX_PRESETS['clean']).toBeDefined();

    expect(MIX_PRESETS['dialogue_focus']?.ducking?.enabled).toBe(true);
    expect(MIX_PRESETS['clean']?.ducking?.enabled).toBe(false);
  });
});
