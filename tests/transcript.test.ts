/**
 * Speech recognition plumbing: the audio we send, and what we do with the
 * words that come back.
 */
import { describe, it, expect } from 'vitest';
import { encodeWav, encodeWavBytes, chunkForAsr, ASR_SAMPLE_RATE } from '@/lib/ai/audioForAsr';
import {
  fillerRanges, segmentsMatching, transcriptForPrompt, sanitiseSegments, Transcript,
} from '@/lib/ai/transcript';

const tone = (seconds: number, rate = ASR_SAMPLE_RATE) =>
  Float32Array.from({ length: seconds * rate }, (_, i) => Math.sin(i / 20) * 0.5);

const transcript = (segments: { startS: number; endS: number; text: string }[]): Transcript => ({
  segments, language: 'en', model: 'whisper-large-v3-turbo', madeAt: '2026-09-01T00:00:00Z',
});

describe('WAV encoding', () => {
  it('writes a header a decoder will accept', () => {
    const view = new DataView(encodeWavBytes(tone(1)));
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);                 // PCM
    expect(view.getUint16(22, true)).toBe(1);                 // mono
    expect(view.getUint32(24, true)).toBe(ASR_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);                // bit depth
  });

  it('is 16-bit, so a second of 16 kHz mono is about 32 KB', () => {
    expect(encodeWav(tone(1)).size).toBe(44 + ASR_SAMPLE_RATE * 2);
  });

  it('clips out-of-range samples instead of wrapping them', () => {
    const loud = Float32Array.from([2, -2, 0]);
    const view = new DataView(encodeWavBytes(loud));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe('chunking long audio', () => {
  it('keeps a short file in one piece, at offset zero', () => {
    const chunks = chunkForAsr(tone(30));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].offsetS).toBe(0);
    expect(chunks[0].lengthS).toBeCloseTo(30, 1);
  });

  it('splits a long file into upload-sized pieces that tile the timeline', () => {
    // 20 minutes at 16 kHz 16-bit is ~38 MB, past the per-request limit
    const chunks = chunkForAsr(tone(20 * 60));
    expect(chunks.length).toBeGreaterThan(1);

    for (const c of chunks) expect(c.blob.size).toBeLessThanOrEqual(18 * 1024 * 1024);

    // contiguous, in order, covering the whole thing
    expect(chunks[0].offsetS).toBe(0);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].offsetS).toBeCloseTo(chunks[i - 1].offsetS + chunks[i - 1].lengthS, 2);
    }
    const total = chunks.reduce((sum, c) => sum + c.lengthS, 0);
    expect(total).toBeCloseTo(20 * 60, 0);
  });

  it('prefers a quiet instant for the boundary', () => {
    const long = tone(20 * 60);
    // carve a silent hole slightly before the natural split point
    const naturalSplit = Math.floor((18 * 1024 * 1024 - 44) / 2);
    const holeStart = naturalSplit - ASR_SAMPLE_RATE;         // 1 s earlier
    for (let i = holeStart; i < holeStart + ASR_SAMPLE_RATE / 2; i++) long[i] = 0;

    const [first] = chunkForAsr(long);
    const boundary = first.lengthS * ASR_SAMPLE_RATE;
    expect(boundary).toBeGreaterThanOrEqual(holeStart - 10);
    expect(boundary).toBeLessThan(naturalSplit + 10);
  });
});

describe('filler detection', () => {
  it('cuts segments that are nothing but filler', () => {
    const t = transcript([
      { startS: 0,  endS: 2,  text: 'So today we are doing push ups' },
      { startS: 2,  endS: 2.4, text: 'Um, uh' },
      { startS: 3,  endS: 5,  text: 'and the form matters' },
      { startS: 5,  endS: 5.3, text: 'you know, like' },
    ]);
    expect(fillerRanges(t)).toEqual([[2, 2.4], [5, 5.3]]);
  });

  it('never cuts a segment that carries meaning, even with filler in it', () => {
    const t = transcript([{ startS: 0, endS: 3, text: 'Um, keep your back straight' }]);
    expect(fillerRanges(t)).toEqual([]);
  });

  it('returns nothing without a transcript, rather than guessing', () => {
    expect(fillerRanges(null)).toEqual([]);
  });
});

describe('searching the transcript', () => {
  const t = transcript([
    { startS: 0,  endS: 4,  text: 'Welcome back to the channel' },
    { startS: 4,  endS: 9,  text: 'Your elbows should stay tucked in' },
    { startS: 9,  endS: 14, text: 'and breathe out on the way up' },
  ]);

  it('finds the segment that mentions the thing asked about', () => {
    expect(segmentsMatching(t, 'elbows').map(s => s.startS)).toEqual([4]);
  });

  it('ignores short noise words', () => {
    expect(segmentsMatching(t, 'to the')).toEqual([]);
  });

  it('returns nothing without a transcript', () => {
    expect(segmentsMatching(null, 'elbows')).toEqual([]);
  });
});

describe('transcript in the prompt', () => {
  it('says plainly when there is none', () => {
    expect(transcriptForPrompt(null)).toMatch(/no transcript/i);
  });

  it('carries timestamps so the model can cut accurately', () => {
    const out = transcriptForPrompt(transcript([{ startS: 1.25, endS: 3.5, text: 'hello there' }]));
    expect(out).toBe('[1.3-3.5] hello there');
  });

  it('trims the middle of a long transcript, keeping both ends', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({
      startS: i, endS: i + 1, text: `line number ${i} with some words in it`,
    }));
    const out = transcriptForPrompt(transcript(many), 2000);
    expect(out.length).toBeLessThan(3000);
    expect(out).toMatch(/line number 0 /);
    expect(out).toMatch(/line number 1999 /);
    expect(out).toMatch(/segments omitted/);
  });
});

describe('sanitising what the provider returns', () => {
  it('drops malformed entries and clamps to the video', () => {
    const out = sanitiseSegments([
      { start: 0,   end: 2,    text: 'good' },
      { start: 'x', end: 3,    text: 'bad start' },
      { start: 4,   end: 5,    text: '' },
      { start: 8,   end: 999,  text: 'runs past the end' },
      { start: 6,   end: 6.001, text: 'too short' },
    ], 10);

    expect(out.map(s => s.text)).toEqual(['good', 'runs past the end']);
    expect(out[1].endS).toBe(10);
  });

  it('returns an empty list for nonsense', () => {
    expect(sanitiseSegments(null, 10)).toEqual([]);
    expect(sanitiseSegments('nope', 10)).toEqual([]);
  });

  it('sorts by time', () => {
    const out = sanitiseSegments([
      { start: 5, end: 6, text: 'second' },
      { start: 1, end: 2, text: 'first' },
    ], 10);
    expect(out.map(s => s.text)).toEqual(['first', 'second']);
  });
});
