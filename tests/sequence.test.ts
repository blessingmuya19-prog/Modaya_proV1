/**
 * Sequence model — the maths the renderer depends on.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSequence, videoClipAt, videoClipsAt, baseClipAt, cutawayClipAt, overlaysAt,
  sourceTimeFor, resolveGap,
  nextBoundary, playableDuration, fitRect, filterFor,
  DEFAULT_TRANSFORM, DEFAULT_EFFECTS,
} from '@/lib/render/sequence';

const opts = { durationS: 100, width: 1080, height: 1920, sourceId: 'p1' };

// Two clips with a cut between 30s and 50s
const CUT = [
  { id: 'a', trackId: 'video', label: 'A', startS: 0,  endS: 30,  type: 'video' as const },
  { id: 'b', trackId: 'video', label: 'B', startS: 50, endS: 100, type: 'video' as const },
];

describe('sequence', () => {
  it('falls back to one full-length clip when nothing is analysed yet', () => {
    const seq = buildSequence([], opts);
    expect(seq.clips).toHaveLength(1);
    expect(seq.clips[0].timelineIn).toBe(0);
    expect(seq.clips[0].timelineOut).toBe(100);
  });

  it('resolves the clip under the playhead', () => {
    const seq = buildSequence(CUT, opts);
    expect(videoClipAt(seq, 10)?.id).toBe('a');
    expect(videoClipAt(seq, 60)?.id).toBe('b');
    expect(videoClipAt(seq, 40)).toBeNull();      // inside the cut
  });

  it('maps timeline time to source time', () => {
    const seq = buildSequence(CUT, opts);
    const b = videoClipAt(seq, 60)!;
    expect(sourceTimeFor(b, 60)).toBe(60);
    // a trimmed clip reads from elsewhere in the file
    const trimmed = { ...b, timelineIn: 10, timelineOut: 20, sourceIn: 90 };
    expect(sourceTimeFor(trimmed, 15)).toBe(95);
  });

  it('skips a cut section instead of playing black', () => {
    const seq = buildSequence(CUT, opts);
    const gap = resolveGap(seq, 40);
    expect(gap.inGap).toBe(true);
    expect(gap.jumpTo).toBe(50);
    expect(resolveGap(seq, 10).inGap).toBe(false);
  });

  it('reports the end of the programme', () => {
    const seq = buildSequence(CUT, opts);
    expect(resolveGap(seq, 100).jumpTo).toBeNull();
  });

  it('finds the next boundary for pre-rolling', () => {
    const seq = buildSequence(CUT, opts);
    expect(nextBoundary(seq, 10)).toBe(30);
    expect(nextBoundary(seq, 30)).toBe(50);
  });

  it('excludes cut sections from playable duration', () => {
    expect(playableDuration(buildSequence(CUT, opts))).toBe(80);
  });

  it('sorts overlays above video and finds them by time', () => {
    const seq = buildSequence([
      ...CUT,
      { id: 't', trackId: 'text', label: 'Title', startS: 5, endS: 9, type: 'text' as const },
    ], opts);
    expect(overlaysAt(seq, 6).map(c => c.id)).toEqual(['t']);
    expect(overlaysAt(seq, 20)).toHaveLength(0);
    expect(videoClipAt(seq, 6)?.id).toBe('a');    // text never becomes the video
  });
});

describe('frame fitting', () => {
  it('letterboxes a vertical source in a landscape frame (contain)', () => {
    const r = fitRect(1080, 1920, 1920, 1080, DEFAULT_TRANSFORM);
    expect(Math.round(r.h)).toBe(1080);                 // height-bound
    expect(Math.round(r.w)).toBe(608);
    expect(Math.round(r.x)).toBe(Math.round((1920 - r.w) / 2));   // centred
  });

  it('fills the frame when covering', () => {
    const r = fitRect(1920, 1080, 1080, 1920, { ...DEFAULT_TRANSFORM, fit: 'cover' });
    expect(r.w).toBeGreaterThanOrEqual(1080);
    expect(r.h).toBeGreaterThanOrEqual(1920);
  });

  it('preserves the source ratio at any scale', () => {
    const r = fitRect(1000, 500, 800, 800, { ...DEFAULT_TRANSFORM, scale: 1.5 });
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });

  it('builds a css filter only from non-default effects', () => {
    expect(filterFor(DEFAULT_EFFECTS)).toBe('none');
    expect(filterFor({ ...DEFAULT_EFFECTS, brightness: 1.2, blurPx: 3 }))
      .toBe('brightness(1.2) blur(3px)');
  });
});

describe('B-roll cutaway stacking', () => {
  // A base talk shot across 0-10s with a muted overlay cutaway at 3-5s.
  const seq = {
    durationS: 10, width: 1080, height: 1920,
    clips: [
      { id: 'base', trackId: 'video', kind: 'video' as const, label: 'talk', timelineIn: 0, timelineOut: 10,
        sourceId: 'p1', sourceIn: 20, transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS }, z: 0, muted: false },
      { id: 'broll', trackId: 'overlay', kind: 'video' as const, label: 'broll', timelineIn: 3, timelineOut: 5,
        sourceId: 'p1', sourceIn: 80, transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS }, z: 10, muted: true },
    ],
  };

  it('draws the cutaway on top (videoClipAt) but keeps the base as audio/clock owner (baseClipAt)', () => {
    expect(videoClipAt(seq as never, 4)?.id).toBe('broll');
    expect(baseClipAt(seq as never, 4)?.id).toBe('base');
    expect(cutawayClipAt(seq as never, 4)?.id).toBe('broll');
    // outside the cutaway, base is both visible and owns audio
    expect(videoClipAt(seq as never, 6)?.id).toBe('base');
    expect(cutawayClipAt(seq as never, 6)).toBeNull();
  });

  it('returns both clips in draw order (lowest z first)', () => {
    const at = videoClipsAt(seq as never, 4).map(c => c.id);
    expect(at).toEqual(['base', 'broll']);
  });
});
