import { describe, it, expect } from 'vitest';
import {
  estimateNoiseFloorDb,
  applyHighPassFilter,
  applyVocalEQ,
  applyAdaptiveNoiseGate,
  applyVocalCompressor,
  enhanceVoiceAudio,
  VOICE_PRESETS,
} from '../src/lib/audio/voiceEnhancer';

describe('AI Voice Enhancer & Studio Sound', () => {
  const sampleRate = 48000;

  it('estimates background noise floor accurately on quiet intervals', () => {
    // Generate 1 second of low-level ambient noise (-50dB)
    const buffer = new Float32Array(sampleRate);
    const noiseLevel = 0.003; // ~ -50dB
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = (Math.random() * 2 - 1) * noiseLevel;
    }

    const noiseFloor = estimateNoiseFloorDb(buffer, sampleRate);
    expect(noiseFloor).toBeLessThan(-40);
    expect(noiseFloor).toBeGreaterThan(-70);
  });

  it('filters out 30Hz sub-bass rumble without distorting 1kHz vocal tone', () => {
    const buffer = new Float32Array(sampleRate);
    // Mix 30Hz rumble + 1000Hz vocal test tone
    for (let i = 0; i < buffer.length; i++) {
      const t = i / sampleRate;
      const rumble = 0.5 * Math.sin(2 * Math.PI * 30 * t);
      const vocalTone = 0.5 * Math.sin(2 * Math.PI * 1000 * t);
      buffer[i] = rumble + vocalTone;
    }

    const filtered = applyHighPassFilter(buffer, sampleRate, 75);
    expect(filtered.length).toBe(buffer.length);

    // Filtered output should have significantly lower peak amplitude because 30Hz is attenuated
    let originalPeak = 0;
    let filteredPeak = 0;
    for (let i = sampleRate / 2; i < sampleRate; i++) {
      originalPeak = Math.max(originalPeak, Math.abs(buffer[i]));
      filteredPeak = Math.max(filteredPeak, Math.abs(filtered[i]));
    }
    expect(filteredPeak).toBeLessThan(originalPeak);
  });

  it('applies vocal presets cleanly across audio buffers without NaN or clipping', () => {
    // 0.25s is plenty to verify filters and dynamics across presets
    const testLen = Math.floor(sampleRate * 0.25);
    const buffer = new Float32Array(testLen);
    for (let i = 0; i < buffer.length; i++) {
      const t = i / sampleRate;
      // Synthesize spoken word-like harmonic waveform
      buffer[i] = 0.4 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 3300 * t);
    }

    for (const presetKey of Object.keys(VOICE_PRESETS) as (keyof typeof VOICE_PRESETS)[]) {
      const preset = VOICE_PRESETS[presetKey];
      const enhanced = enhanceVoiceAudio(buffer, preset, sampleRate);
      expect(enhanced.length).toBe(buffer.length);

      for (let i = 0; i < enhanced.length; i++) {
        expect(Number.isFinite(enhanced[i])).toBe(true);
        expect(enhanced[i]).toBeGreaterThanOrEqual(-1.0);
        expect(enhanced[i]).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it('attenuates quiet noise in speech pauses via adaptive noise gate', () => {
    const buffer = new Float32Array(sampleRate);
    // First half loud speech, second half low room noise
    for (let i = 0; i < sampleRate / 2; i++) {
      buffer[i] = 0.6 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
    }
    for (let i = sampleRate / 2; i < sampleRate; i++) {
      buffer[i] = (Math.random() * 2 - 1) * 0.005; // -46dB quiet noise
    }

    const gated = applyAdaptiveNoiseGate(buffer, VOICE_PRESETS.studio_broadcast, sampleRate);
    
    // Check pause region (end of buffer)
    let pauseEnergy = 0;
    for (let i = sampleRate * 0.8; i < sampleRate; i++) {
      pauseEnergy += gated[i] * gated[i];
    }
    const pauseRms = Math.sqrt(pauseEnergy / (sampleRate * 0.2));
    expect(pauseRms).toBeLessThan(0.003);
  });
});
