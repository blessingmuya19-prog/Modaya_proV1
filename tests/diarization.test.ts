import { describe, it, expect } from 'vitest';
import {
  diarizeTranscript,
  estimatePitchAndRms,
  getSpeakerGainAt,
  applySpeakerRebalanceToPcm,
  dbToLinear,
  linearToDb,
} from '@/lib/ai/diarization';
import type { StoredTranscriptSegment } from '@/lib/mediaDb';

describe('multi-speaker diarization & speech leveling', () => {
  it('converts decibels and linear amplitudes bidirectionally', () => {
    expect(dbToLinear(0)).toBeCloseTo(1.0, 4);
    expect(dbToLinear(6)).toBeCloseTo(1.995, 2);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 2);

    expect(linearToDb(1.0)).toBeCloseTo(0, 4);
    expect(linearToDb(2.0)).toBeCloseTo(6.02, 1);
    expect(linearToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('estimates pitch and RMS from PCM samples', () => {
    const sampleRate = 16000;
    const len = sampleRate * 0.5; // 500ms
    const samples = new Float32Array(len);

    // 200 Hz sine wave with 0.4 amplitude
    for (let i = 0; i < len; i++) {
      samples[i] = Math.sin((i / sampleRate) * 2 * Math.PI * 200) * 0.4;
    }

    const { pitchHz, rms } = estimatePitchAndRms(samples, sampleRate);
    expect(rms).toBeCloseTo(0.4 / Math.SQRT2, 2);
    expect(pitchHz).toBeGreaterThanOrEqual(190);
    expect(pitchHz).toBeLessThanOrEqual(210);
  });

  it('diarizes conversational transcript segments into distinct speakers', () => {
    const segments: StoredTranscriptSegment[] = [
      { startS: 0.0, endS: 3.0, text: 'Welcome to the podcast, how are you today?', rms: 0.16 },
      { startS: 3.4, endS: 6.5, text: 'Thanks for having me, excited to be here!', rms: 0.08 }, // Quieter guest
      { startS: 6.8, endS: 9.0, text: 'Can you tell us about your background?', rms: 0.16 },
      { startS: 9.3, endS: 13.0, text: 'I started working on AI video tools five years ago.', rms: 0.08 },
    ];

    const result = diarizeTranscript(segments, undefined, 16000, {
      maxSpeakers: 2,
      targetRms: 0.16,
    });

    expect(result.speakers.length).toBe(2);
    expect(result.utterances.length).toBe(4);

    // Speaker 1 is Host (0.16 RMS)
    const spk1 = result.speakers[0];
    expect(spk1.id).toBe('speaker-1');
    expect(spk1.averageRms).toBeCloseTo(0.16, 2);
    expect(spk1.targetGainDb).toBeCloseTo(0, 1);

    // Speaker 2 is Guest (0.08 RMS -> needs ~+6dB boost to reach 0.16 target)
    const spk2 = result.speakers[1];
    expect(spk2.id).toBe('speaker-2');
    expect(spk2.averageRms).toBeCloseTo(0.08, 2);
    expect(spk2.targetGainDb).toBeGreaterThan(4.0);
    expect(spk2.gainMultiplier).toBeGreaterThan(1.5);
  });

  it('calculates instantaneous speaker gain along timeline', () => {
    const segments: StoredTranscriptSegment[] = [
      { startS: 1.0, endS: 3.0, text: 'Host speaking loudly', rms: 0.24 }, // Too loud (-3.5 dB)
      { startS: 4.0, endS: 7.0, text: 'Guest speaking softly', rms: 0.08 }, // Too quiet (+6 dB)
    ];

    const result = diarizeTranscript(segments, undefined, 16000, {
      maxSpeakers: 2,
      targetRms: 0.16,
    });

    // During host speech at t = 2.0s: gain is reduced (< 1.0)
    const hostGain = getSpeakerGainAt(2.0, result);
    expect(hostGain).toBeLessThan(1.0);

    // During guest speech at t = 5.0s: gain is boosted (> 1.0)
    const guestGain = getSpeakerGainAt(5.0, result);
    expect(guestGain).toBeGreaterThan(1.0);

    // In silent gap between speech at t = 3.5s: default unity gain
    const gapGain = getSpeakerGainAt(3.5, result);
    expect(gapGain).toBe(1.0);
  });

  it('applies speaker loudness rebalancing to PCM audio buffer in-memory', () => {
    const sampleRate = 1000;
    const durationS = 8;
    const samples = new Float32Array(sampleRate * durationS);

    // Speaker 1 (1-3s) at 0.5 amplitude
    for (let i = 1000; i < 3000; i++) samples[i] = 0.5;

    // Speaker 2 (4-7s) at 0.1 amplitude (very quiet)
    for (let i = 4000; i < 7000; i++) samples[i] = 0.1;

    const segments: StoredTranscriptSegment[] = [
      { startS: 1.0, endS: 3.0, text: 'Speaker 1', rms: 0.5 },
      { startS: 4.0, endS: 7.0, text: 'Speaker 2', rms: 0.1 },
    ];

    const diarization = diarizeTranscript(segments, samples, sampleRate, {
      targetRms: 0.25,
      maxBoostDb: 6.0,
      maxAttenDb: -6.0,
    });

    const rebalanced = applySpeakerRebalanceToPcm(samples, sampleRate, diarization);
    expect(rebalanced.length).toBe(samples.length);

    // Speaker 1 was attenuated from 0.5
    expect(rebalanced[2000]).toBeLessThan(0.5);

    // Speaker 2 was boosted from 0.1
    expect(rebalanced[5000]).toBeGreaterThan(0.1);
  });
});
