import { describe, it, expect } from 'vitest';
import {
  detectSilenceIntervals,
  detectFillerWordIntervals,
  mergeCutIntervals,
  generateTightenedTimeline,
  type AudioEnvelopeData,
  type TranscriptWordItem,
} from '../src/lib/ai/silenceRemover';

describe('Auto-Silence & Filler-Word Remover Engine', () => {
  it('detects dead-air pauses from RMS envelope data', () => {
    // 10-second envelope at 0.05s hop (200 frames)
    // 0..3s speech (rms 0.7), 3..5.5s silence (rms 0.005), 5.5..10s speech (rms 0.6)
    const rms: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t = i * 0.05;
      if (t >= 3.0 && t <= 5.5) {
        rms.push(0.005); // ~ -46dB
      } else {
        rms.push(0.7); // Loud speech
      }
    }

    const envelope: AudioEnvelopeData = { rms, hopS: 0.05 };
    const cuts = detectSilenceIntervals(envelope, 10.0, {
      silenceThresholdDb: -35,
      minSilenceDurationS: 0.4,
      speechPaddingS: 0.08,
    });

    expect(cuts.length).toBe(1);
    expect(cuts[0].start).toBeGreaterThanOrEqual(3.0);
    expect(cuts[0].end).toBeLessThanOrEqual(5.5);
    expect(cuts[0].duration).toBeGreaterThan(1.8);
  });

  it('detects transcript filler words ("um", "like", "you know")', () => {
    const words: TranscriptWordItem[] = [
      { word: 'Hello', start: 0.2, end: 0.6 },
      { word: 'um', start: 0.8, end: 1.2 },
      { word: 'everyone', start: 1.3, end: 1.8 },
      { word: 'like', start: 2.0, end: 2.3 },
      { word: 'today', start: 2.4, end: 2.8 },
    ];

    const fillerCuts = detectFillerWordIntervals(words);
    expect(fillerCuts.length).toBe(2);
    expect(fillerCuts[0].text).toBe('um');
    expect(fillerCuts[1].text).toBe('like');
  });

  it('merges overlapping cuts and calculates accurate time savings', () => {
    const rms = new Array(200).fill(0.7);
    // Insert silence at 4.0..6.0s
    for (let i = 80; i <= 120; i++) rms[i] = 0.002;

    const words: TranscriptWordItem[] = [
      { word: 'First', start: 0.5, end: 1.0 },
      { word: 'sentence', start: 1.1, end: 2.0 },
      { word: 'uh', start: 2.2, end: 2.6 },
      { word: 'Second', start: 2.8, end: 3.5 },
      { word: 'Third', start: 6.5, end: 8.0 },
    ];

    const result = generateTightenedTimeline(10.0, { rms, hopS: 0.05 }, words);

    expect(result.originalDurationS).toBe(10.0);
    expect(result.editedDurationS).toBeLessThan(result.originalDurationS);
    expect(result.timeSavedS).toBeGreaterThan(1.5);
    expect(result.segmentsToKeep.length).toBeGreaterThanOrEqual(2);

    // Verified non-overlapping contiguous speech timeline
    for (let i = 0; i < result.segmentsToKeep.length - 1; i++) {
      const cur = result.segmentsToKeep[i];
      const next = result.segmentsToKeep[i + 1];
      expect(next.timelineStart).toBeCloseTo(cur.timelineEnd, 2);
    }
  });
});
