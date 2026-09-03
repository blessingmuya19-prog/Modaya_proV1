/**
 * Tests for the waveform extraction, caching, and resampling module.
 */
import { describe, it, expect } from 'vitest';
import {
  setProjectWaveform,
  getProjectWaveform,
  resampleWaveform,
} from '@/lib/waveformStore';

describe('waveformStore', () => {
  it('stores and retrieves in-memory waveforms', () => {
    const wave = [0.1, 0.5, 0.9, 0.3, 0.2];
    setProjectWaveform('proj-123', wave);
    expect(getProjectWaveform('proj-123')).toEqual(wave);
    expect(getProjectWaveform('non-existent')).toBeNull();
  });

  it('resamples a waveform slice to target bar count', () => {
    // 100 samples across 10 seconds (10 samples/sec)
    const wave = Array.from({ length: 100 }, (_, i) => (i < 50 ? 0.8 : 0.2));

    // Clip from 0s to 5s (first half, should be around ~0.8)
    const firstHalf = resampleWaveform(wave, 0, 5, 10, 10);
    expect(firstHalf).toHaveLength(10);
    expect(firstHalf[0]).toBeCloseTo(0.8, 1);

    // Clip from 5s to 10s (second half, should be around ~0.2)
    const secondHalf = resampleWaveform(wave, 5, 10, 10, 10);
    expect(secondHalf).toHaveLength(10);
    expect(secondHalf[0]).toBeCloseTo(0.2, 1);
  });

  it('provides a clean fallback when waveform is missing', () => {
    const fallback = resampleWaveform(null, 0, 10, 10, 20);
    expect(fallback).toHaveLength(20);
    expect(fallback.every(v => v >= 0.05 && v <= 1.0)).toBe(true);
  });
});
