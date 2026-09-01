/**
 * The timeline only puts on screen what can actually be seen.
 *
 * Captioning a 13-minute video produced 464 caption clips and the editor
 * crawled — every clip was a live DOM node with a border, a label and a
 * resize handle, whether it was on screen or two pixels wide.
 */
import { describe, it, expect } from 'vitest';
import { packClips, type TimelineClip } from '@/components/editor/packClips';

/** 464 captions across 13:28, the shape the transcript actually produced. */
const captions = (): TimelineClip[] =>
  Array.from({ length: 464 }, (_, i) => ({
    s: i * 1.74, e: i * 1.74 + 1.6, label: `caption line ${i}`,
  }));

const WIDE = { left: 0, width: 1200 };

describe('packClips', () => {
  it('keeps ordinary clips exactly as they are', () => {
    const clips: TimelineClip[] = [
      { s: 0,  e: 30, label: 'A' },
      { s: 50, e: 90, label: 'B' },
    ];
    const packed = packClips(clips, 10, WIDE);
    expect(packed).toHaveLength(2);
    expect(packed[0]).toMatchObject({ left: 0, w: 300, label: 'A', merged: 1 });
    expect(packed[1]).toMatchObject({ left: 500, w: 400, label: 'B', merged: 1 });
  });

  it('drops clips outside the visible window', () => {
    const clips: TimelineClip[] = Array.from({ length: 60 }, (_, i) =>
      ({ s: i * 100, e: i * 100 + 90, label: `c${i}` }));
    // 1 px per second, a 1200px window: only the first ~24 clips are anywhere near it
    const packed = packClips(clips, 1, { left: 0, width: 1200 }, { padPx: 1200, minPx: 4 });
    expect(packed.length).toBeLessThan(30);
    expect(packed.every(p => p.left <= 2400)).toBe(true);
  });

  it('keeps clips in the slack area either side, so scrolling shows no hole', () => {
    const clips: TimelineClip[] = Array.from({ length: 60 }, (_, i) =>
      ({ s: i * 100, e: i * 100 + 90, label: `c${i}` }));
    const packed = packClips(clips, 1, { left: 3000, width: 1200 }, { padPx: 1200 });
    // window is 3000–4200; slack takes it to 1800–5400
    expect(packed.some(p => p.left < 3000)).toBe(true);
    expect(packed.some(p => p.left > 4200)).toBe(true);
  });

  it('collapses a run of sub-pixel captions into one block', () => {
    // the whole 13:28 fits on screen: each caption is under 2px wide
    const zoom = 1.1;
    const packed = packClips(captions(), zoom, { left: 0, width: 1200 }, { padPx: 1200 });
    expect(packed.length).toBeLessThan(20);
    expect(packed[0].merged).toBeGreaterThan(100);
  });

  it('a collapsed block covers the same ground as the clips it replaced', () => {
    const zoom = 1.1;
    const clips = captions();
    const packed = packClips(clips, zoom, { left: 0, width: 100000 }, { padPx: 0 });
    const first = clips[0].s * zoom;
    const last  = clips[clips.length - 1].e * zoom;
    expect(Math.min(...packed.map(p => p.left))).toBeCloseTo(first, 1);
    expect(Math.max(...packed.map(p => p.left + p.w))).toBeCloseTo(last, 1);
  });

  it('carries no label on a collapsed block — there is no room to draw one', () => {
    const packed = packClips(captions(), 1.1, WIDE);
    for (const p of packed) if (p.merged > 1) expect(p.label).toBe('');
  });

  it('gives every caption its own clip again once you zoom in', () => {
    // 40 px per second — each 1.6s caption is 64px wide
    const packed = packClips(captions(), 40, { left: 0, width: 1200 }, { padPx: 1200 });
    expect(packed.every(p => p.merged === 1)).toBe(true);
    expect(packed.every(p => p.label.startsWith('caption line'))).toBe(true);
    // and only the visible handful are built, not all 464
    expect(packed.length).toBeLessThan(60);
  });

  it('never merges across a gap you could see', () => {
    const clips: TimelineClip[] = [
      { s: 0,   e: 1,   label: 'a' },   // 1px at zoom 1
      { s: 1.5, e: 2.5, label: 'b' },   // half a pixel away — same block
      { s: 40,  e: 41,  label: 'c' },   // 37px away — its own block
    ];
    const packed = packClips(clips, 1, WIDE);
    expect(packed).toHaveLength(2);
    expect(packed[0].merged).toBe(2);
    expect(packed[1].merged).toBe(1);
  });

  it('leaves a visible clip alone even when its neighbours are slivers', () => {
    const clips: TimelineClip[] = [
      { s: 0, e: 1, label: 'sliver' },
      { s: 1, e: 60, label: 'the video' },
      { s: 60, e: 61, label: 'sliver' },
    ];
    const packed = packClips(clips, 1, WIDE);
    const real = packed.find(p => p.label === 'the video');
    expect(real, 'the real clip was swallowed by a merge').toBeTruthy();
    expect(real!.merged).toBe(1);
  });

  it('handles an unsorted list and a zero zoom without falling over', () => {
    const clips: TimelineClip[] = [
      { s: 50, e: 90, label: 'B' },
      { s: 0,  e: 30, label: 'A' },
    ];
    expect(packClips(clips, 10, WIDE).map(p => p.label)).toEqual(['A', 'B']);
    expect(packClips(clips, 0, WIDE)).toEqual([]);
    expect(packClips([], 10, WIDE)).toEqual([]);
  });

  it('is cheap enough to run on a scroll', () => {
    const clips = captions();
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) packClips(clips, 1.1, { left: i * 8, width: 1200 });
    const per = (performance.now() - t0) / 200;
    expect(per, `packClips took ${per.toFixed(3)} ms`).toBeLessThan(2);
  });
});
