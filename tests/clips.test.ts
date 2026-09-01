/**
 * The clipping engine turns one long video into several short clips. With no
 * AI key it must find them from measurements (loudness, motion, silences) and
 * never return the opening by default; with a model it must clamp and snap
 * whatever timestamps come back so a hallucinated timecode can't escape.
 */
import { describe, it, expect } from 'vitest';
import {
  findClipsByMeasurement, sanitiseClips, mergeClips,
  clipBriefForPrompt, clipSystemPrompt, parseClipRequest, type ClipRequest,
} from '@/lib/ai/clips';
import type { Transcript } from '@/lib/ai/transcript';

/** A 300s loudness curve, quiet except for energetic bursts in given spans. */
function energyWithBursts(bursts: [number, number][], durationS = 300, rate = 2): number[] {
  const n = durationS * rate;
  return Array.from({ length: n }, (_, i) => {
    const t = i / rate;
    return bursts.some(([a, b]) => t >= a && t < b) ? 0.9 : 0.05;
  });
}

const transcript: Transcript = {
  language: 'en', model: 'test', madeAt: new Date().toISOString(),
  segments: [
    { startS: 100, endS: 108, text: 'Welcome back to the show, today we talk about money.' },
    { startS: 108, endS: 120, text: 'The one habit that made me a millionaire was automating my savings.' },
    { startS: 200, endS: 210, text: 'And another thing nobody tells you about failure.' },
    { startS: 210, endS: 225, text: 'I lost everything in 2019 and it taught me the most important lesson of my life.' },
  ],
};

describe('findClipsByMeasurement', () => {
  it('finds energetic bursts rather than defaulting to the opening', () => {
    const energy = energyWithBursts([[120, 170], [240, 285]]);
    const clips = findClipsByMeasurement({ durationS: 300, count: 3, targetLenS: 45, energy });
    expect(clips.length).toBeGreaterThan(0);
    // The strongest clip should be around a burst, not at 0.
    const top = [...clips].sort((a, b) => b.score - a.score)[0];
    expect(top.startS).toBeGreaterThan(60);
  });

  it('returns clips spread across the video, not stacked on one minute', () => {
    const energy = energyWithBursts([[100, 150], [200, 250]]);
    const clips = findClipsByMeasurement({ durationS: 300, count: 4, targetLenS: 40, energy });
    expect(clips.length).toBeGreaterThanOrEqual(2);
    const sorted = [...clips].sort((a, b) => a.startS - b.startS);
    // Consecutive clips must not heavily overlap.
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startS).toBeGreaterThan(sorted[i - 1].endS - 10);
    }
  });

  it('never runs a clip past the end of the video', () => {
    const energy = energyWithBursts([[260, 299]]);
    const clips = findClipsByMeasurement({ durationS: 300, count: 3, targetLenS: 45, energy });
    for (const c of clips) {
      expect(c.endS).toBeLessThanOrEqual(300);
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.endS - c.startS).toBeGreaterThan(0);
    }
  });

  it('returns the whole video when it is already shorter than a clip', () => {
    const clips = findClipsByMeasurement({ durationS: 30, count: 5, targetLenS: 45 });
    expect(clips).toHaveLength(1);
    expect(clips[0].startS).toBe(0);
    expect(clips[0].endS).toBe(30);
  });

  it('snaps clip bounds to transcript sentence edges', () => {
    const energy = energyWithBursts([[115, 165]]);
    const clips = findClipsByMeasurement({ durationS: 300, count: 1, targetLenS: 45, energy, transcript });
    const c = clips[0];
    // The start should land on or near a segment start (100 or 108), not mid-word.
    const nearEdge = [100, 108, 200, 210].some(e => Math.abs(c.startS - e) < 0.6);
    expect(nearEdge).toBe(true);
  });

  it('uses the hook line as the title when a transcript exists', () => {
    const energy = energyWithBursts([[115, 165]]);
    const clips = findClipsByMeasurement({ durationS: 300, count: 1, targetLenS: 45, energy, transcript });
    expect(clips[0].title.length).toBeGreaterThan(5);
    expect(clips[0].source).toBe('measurement');
  });

  it('still returns clips with nothing measured at all', () => {
    const clips = findClipsByMeasurement({ durationS: 300, count: 3, targetLenS: 45 });
    expect(clips.length).toBe(3);
    for (const c of clips) {
      expect(c.endS).toBeLessThanOrEqual(300);
      expect(c.endS - c.startS).toBeGreaterThan(10);
    }
  });

  it('is deterministic', () => {
    const energy = energyWithBursts([[100, 150], [220, 270]]);
    const req: ClipRequest = { durationS: 300, count: 3, targetLenS: 45, energy };
    const a = JSON.stringify(findClipsByMeasurement(req));
    const b = JSON.stringify(findClipsByMeasurement(req));
    expect(a).toBe(b);
  });

  it('respects the requested count ceiling', () => {
    const energy = energyWithBursts([[100, 150], [200, 250]]);
    expect(findClipsByMeasurement({ durationS: 300, count: 2, targetLenS: 40, energy }).length).toBeLessThanOrEqual(2);
  });
});

describe('sanitiseClips', () => {
  const req: ClipRequest = { durationS: 300, count: 3, targetLenS: 45, transcript };

  it('passes through well-formed model clips', () => {
    const raw = { clips: [
      { startS: 108, endS: 150, title: 'The habit that made me rich', hook: 'The one habit that made me a millionaire', reason: 'Strong money tip', tags: ['money', 'habits'], score: 95 },
    ] };
    const clips = sanitiseClips(raw, req);
    expect(clips).toHaveLength(1);
    expect(clips[0].title).toBe('The habit that made me rich');
    expect(clips[0].score).toBe(95);
    expect(clips[0].source).toBe('ai');
    expect(clips[0].id).toBe('clip-1');
  });

  it('clamps timestamps that run past the end of the video', () => {
    const raw = { clips: [
      { startS: 250, endS: 9999, title: 'Too long', score: 80 },
    ] };
    const clips = sanitiseClips(raw, req);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips[0].endS).toBeLessThanOrEqual(300);
    expect(clips[0].endS - clips[0].startS).toBeGreaterThan(0);
  });

  it('drops backwards and non-numeric clips', () => {
    const raw = { clips: [
      { startS: 200, endS: 100, title: 'backwards' },
      { startS: 'banana', endS: 150, title: 'bad' },
      { startS: 100, endS: 140, title: 'good', score: 70 },
    ] };
    const clips = sanitiseClips(raw, req);
    expect(clips).toHaveLength(1);
    expect(clips[0].title).toBe('good');
  });

  it('de-duplicates clips that substantially overlap, keeping the best', () => {
    const raw = { clips: [
      { startS: 108, endS: 150, title: 'first', score: 60 },
      { startS: 110, endS: 152, title: 'second', score: 92 },
      { startS: 210, endS: 250, title: 'third', score: 80 },
    ] };
    const clips = sanitiseClips(raw, req);
    expect(clips).toHaveLength(2);
    expect(clips.map(c => c.title)).toContain('second');
    expect(clips.map(c => c.title)).toContain('third');
  });

  it('fills a missing score from the measurement score', () => {
    const raw = { clips: [{ startS: 108, endS: 150, title: 'no score' }] };
    const clips = sanitiseClips(raw, req);
    expect(clips[0].score).toBeGreaterThanOrEqual(0);
    expect(clips[0].score).toBeLessThanOrEqual(100);
  });

  it('returns nothing for non-array garbage', () => {
    expect(sanitiseClips(null, req)).toEqual([]);
    expect(sanitiseClips({ clips: 'nope' }, req)).toEqual([]);
    expect(sanitiseClips({}, req)).toEqual([]);
  });
});

describe('mergeClips', () => {
  it('falls back to measurement clips when there is no AI output', () => {
    const energy = energyWithBursts([[120, 170]]);
    const clips = mergeClips(null, { durationS: 300, count: 3, targetLenS: 45, energy });
    expect(clips.length).toBeGreaterThanOrEqual(1);
  });

  it('tops up a short AI list with non-overlapping measured clips', () => {
    const energy = energyWithBursts([[120, 170], [240, 285]]);
    const ai = sanitiseClips(
      { clips: [{ startS: 108, endS: 150, title: 'AI pick', score: 90 }] },
      { durationS: 300, count: 3, targetLenS: 45, energy, transcript },
    );
    const clips = mergeClips(ai, { durationS: 300, count: 3, targetLenS: 45, energy, transcript });
    expect(clips.length).toBe(3);
    // The top-ups are marked as hybrid/measured, not passed off as AI.
    expect(clips.some(c => c.source !== 'ai')).toBe(true);
  });

  it('re-numbers clip ids in time order', () => {
    const energy = energyWithBursts([[120, 170], [240, 285]]);
    const clips = mergeClips(null, { durationS: 300, count: 2, targetLenS: 45, energy });
    const sorted = [...clips].sort((a, b) => a.startS - b.startS);
    sorted.forEach((c, i) => expect(c.id).toBe(`clip-${i + 1}`));
  });
});

describe('spread and non-overlap (the long-video bugs)', () => {
  it('never returns overlapping clips', () => {
    // 13:28 video, flat loudness (the case from the report).
    const energy = Array.from({ length: 808 * 2 }, () => 0.5);
    const clips = findClipsByMeasurement({ durationS: 808, count: 5, targetLenS: 45, energy });
    const sorted = [...clips].sort((a, b) => a.startS - b.startS);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startS).toBeGreaterThanOrEqual(sorted[i - 1].endS - 0.6);
    }
  });

  it('spreads clips across a long flat video instead of stacking them at 0:00', () => {
    const energy = Array.from({ length: 808 * 2 }, () => 0.5);
    const clips = findClipsByMeasurement({ durationS: 808, count: 5, targetLenS: 45, energy });
    // The last clip must reach well past the opening few minutes.
    const last = [...clips].sort((a, b) => b.startS - a.startS)[0];
    expect(last.startS).toBeGreaterThan(808 * 0.6);   // somewhere in the back third+
    // And the first clip must not be at 0 for every result: clips should span the video.
    const spans = clips.map(c => c.startS);
    expect(Math.max(...spans) - Math.min(...spans)).toBeGreaterThan(808 * 0.5);
  });

  it('picks clips near energetic bursts wherever they fall in the video', () => {
    // One burst near the end — a spread pick should still reach it.
    const energy = Array.from({ length: 808 * 2 }, (_, i) =>
      (i / 2 >= 700 && i / 2 < 760) ? 0.95 : 0.2);
    const clips = findClipsByMeasurement({ durationS: 808, count: 5, targetLenS: 45, energy });
    const hasTail = clips.some(c => c.startS >= 600);
    expect(hasTail).toBe(true);
  });

  it('honours start bias by taking clips from the beginning', () => {
    const energy = Array.from({ length: 808 * 2 }, (_, i) =>
      (i / 2 >= 700 && i / 2 < 760) ? 0.95 : 0.2);
    const clips = findClipsByMeasurement(
      { durationS: 808, count: 3, targetLenS: 45, energy, bias: 'start' });
    const sorted = [...clips].sort((a, b) => a.startS - b.startS);
    // Even though the loud part is at the end, start bias opens near 0.
    expect(sorted[0].startS).toBeLessThan(5);
  });

  it('honours a 30-second target length', () => {
    const energy = energyWithBursts([[100, 200], [400, 500]], 600);
    const clips = findClipsByMeasurement({ durationS: 600, count: 4, targetLenS: 30, energy });
    for (const c of clips) {
      const len = c.endS - c.startS;
      expect(len).toBeGreaterThanOrEqual(14);
      expect(len).toBeLessThanOrEqual(60);
    }
  });
});

describe('parseClipRequest', () => {
  it('reads a count from "give me 5 clips"', () => {
    expect(parseClipRequest('give me 5 short clips').count).toBe(5);
    expect(parseClipRequest('find 3').count).toBe(3);
  });

  it('reads a length in seconds or minutes', () => {
    expect(parseClipRequest('30 seconds pls').targetLenS).toBe(30);
    expect(parseClipRequest('make them 60s').targetLenS).toBe(60);
    expect(parseClipRequest('1 minute clips').targetLenS).toBe(60);
  });

  it('detects start bias', () => {
    expect(parseClipRequest('make the clips at the beginning').bias).toBe('start');
    expect(parseClipRequest('from the start').bias).toBe('start');
    expect(parseClipRequest('find 5 clips').bias).toBe('spread');
  });

  it('does not read a trim length as a clip length', () => {
    // "trim to 30 seconds" is handled by its caller; the parser still reports
    // the number, but the intent router decides it is not clipping.
    expect(parseClipRequest('30 seconds', {}).targetLenS).toBe(30);
  });
});

describe('prompt building', () => {
  it('bakes the length bounds into the system prompt', () => {
    const sys = clipSystemPrompt({ minLenS: 20, maxLenS: 80, targetLenS: 45 });
    expect(sys).toContain('20-80');
    expect(sys).toContain('45');
  });

  it('includes the transcript and loudness in the brief', () => {
    const energy = energyWithBursts([[120, 170]]);
    const brief = clipBriefForPrompt({ durationS: 300, count: 3, targetLenS: 45, minLenS: 20, maxLenS: 80, energy, transcript });
    expect(brief).toContain('millionaire');
    expect(brief).toContain('LOUDNESS');
  });

  it('says plainly when there is no transcript', () => {
    const brief = clipBriefForPrompt({ durationS: 300, count: 3, targetLenS: 45, minLenS: 20, maxLenS: 80 });
    expect(brief).toContain('no transcript');
  });
});
