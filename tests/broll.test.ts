/**
 * The B-roll library — separate clips uploaded purely as cutaway material.
 *
 * When a library exists the plan must read its silent cutaways from those
 * clips (each its own media object, windows inside that clip's duration),
 * and every layer below must carry the source identity through: the plan →
 * the style layer → the rendered sequence. Without a library, the old
 * behaviour — cutaways recycled from unused windows of the main footage —
 * must survive untouched.
 */
import { describe, it, expect } from 'vitest';
import { composeStudioPlan, chooseLibraryBroll, type BrollClip } from '@/lib/studio/editPlan';
import { buildSequence } from '@/lib/render/sequence';
import { buildEditMap, explainMarker } from '@/lib/studio/editMap';
import type { StyleProfile } from '@/lib/ai/styleProfile';

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    sourceName: 'modaya-default', durationS: 45, cuts: [], cutsPerMin: 30,
    shotMeanS: 2, shotMedianS: 1.8, shotVariance: 0.6, pace: 'very fast',
    grade: { brightness: 0, contrast: 0.05, saturation: 0.08, warmth: 0 },
    punchInRate: 0.4, punchInMax: 1.12,
    captions: { present: true, position: 'lower', emphasis: 0.4 },
    beatSynced: false, bpm: null, energy: 0.7, ...over,
  };
}

/** Fixed PRNG so tests are deterministic without depending on the seed hash. */
const fixedRand = () => 0.42;

const library: BrollClip[] = [
  { id: 'broll-0', durationS: 12 },
  { id: 'broll-1', durationS: 6.5 },
  { id: 'broll-2', durationS: 30 },
];

describe('chooseLibraryBroll', () => {
  it('returns nothing for an empty library or zero count', () => {
    expect(chooseLibraryBroll({ library: [], count: 5, rand: fixedRand })).toEqual([]);
    expect(chooseLibraryBroll({ library, count: 0, rand: fixedRand })).toEqual([]);
  });

  it('skips clips too short to show', () => {
    const picks = chooseLibraryBroll({
      library: [{ id: 'broll-tiny', durationS: 0.3 }, ...library],
      count: 4, rand: fixedRand,
    });
    expect(picks.length).toBe(4);
    expect(picks.every(p => p.sourceId !== 'broll-tiny')).toBe(true);
  });

  it('keeps every window inside its clip', () => {
    const picks = chooseLibraryBroll({ library, count: 6, rand: fixedRand });
    expect(picks.length).toBe(6);
    for (const p of picks) {
      const item = library.find(b => b.id === p.sourceId)!;
      expect(item).toBeTruthy();
      expect(p.inS).toBeGreaterThanOrEqual(0);
      expect(p.inS + p.lenS).toBeLessThanOrEqual(item.durationS + 0.001);
    }
  });

  it('clamps the cut length to a short clip', () => {
    const picks = chooseLibraryBroll({
      library: [{ id: 'short', durationS: 1.2 }], count: 2, cutLenS: 1.7, rand: fixedRand,
    });
    expect(picks.length).toBe(2);
    for (const p of picks) expect(p.lenS).toBeLessThanOrEqual(1.2 + 0.001);
  });

  it('is deterministic and reuses clips at different offsets', () => {
    const a = chooseLibraryBroll({ library: [{ id: 'only', durationS: 20 }], count: 4, rand: fixedRand });
    const b = chooseLibraryBroll({ library: [{ id: 'only', durationS: 20 }], count: 4, rand: fixedRand });
    expect(a).toEqual(b);
    // All four windows from the same clip, but not four identical windows.
    const offsets = new Set(a.map(p => p.inS));
    expect(offsets.size).toBeGreaterThan(1);
  });
});

describe('composeStudioPlan with a B-roll library', () => {
  const interest = Array.from({ length: 300 }, () => 0.5);

  const plan = composeStudioPlan({
    profile: profile(), sourceDurationS: 300, interest,
    brollLibrary: library,
  });

  it('reads cutaways from the library, each within its clip', () => {
    const overlays = plan.clips.filter(c => c.trackId === 'overlay');
    expect(overlays.length).toBeGreaterThan(0);
    for (const ov of overlays) {
      expect(ov.sourceId).toBeTruthy();
      expect(ov.sourceId).toMatch(/^broll-\d+$/);
      const item = library.find(b => b.id === ov.sourceId)!;
      expect(ov.sourceIn).toBeGreaterThanOrEqual(0);
      expect(ov.sourceIn + (ov.endS - ov.startS)).toBeLessThanOrEqual(item.durationS + 0.001);
    }
    expect(plan.brollFromLibrary).toBe(true);
    expect(plan.broll).toBe(overlays.length);
    expect(plan.summary).toMatch(/b-roll \(your library\)/);
  });

  it('never points the base shots at library clips', () => {
    const base = plan.clips.filter(c => c.trackId === 'video');
    expect(base.length).toBeGreaterThan(0);
    for (const shot of base) expect(shot.sourceId).toBeUndefined();
  });

  it('falls back to source windows when no library is given', () => {
    const fallback = composeStudioPlan({
      profile: profile(), sourceDurationS: 300, interest,
      brollLibrary: [],
    });
    const overlays = fallback.clips.filter(c => c.trackId === 'overlay');
    expect(fallback.brollFromLibrary).toBe(false);
    if (overlays.length) {
      for (const ov of overlays) {
        expect(ov.sourceId).toBeUndefined();
        expect(ov.sourceIn + (ov.endS - ov.startS)).toBeLessThanOrEqual(300.001);
      }
      expect(fallback.summary).toMatch(/b-roll(?! \(your library\))/);
    }
  });
});

describe('style layer → sequence source plumbing', () => {
  it('carries a per-clip sourceId through buildSequence', () => {
    const seq = buildSequence(
      [
        { id: 'shot-0', trackId: 'video', label: 'A', startS: 0, endS: 4, type: 'video' },
        { id: 'broll-0', trackId: 'overlay', label: 'B-roll', startS: 1, endS: 2.5, type: 'video' },
      ],
      {
        durationS: 4, width: 1080, height: 1920, sourceId: 'main',
        style: {
          'shot-0':  { sourceIn: 10 },
          'broll-0': { sourceId: 'broll-0', sourceIn: 3 },
        },
      },
    );
    const shot  = seq.clips.find(c => c.id === 'shot-0')!;
    const broll = seq.clips.find(c => c.id === 'broll-0')!;
    expect(shot.sourceId).toBe('main');
    expect(broll.sourceId).toBe('broll-0');
    // A cutaway stays muted and above the base — the talk track owns audio.
    expect(broll.muted).toBe(true);
    expect(broll.z).toBeGreaterThan(shot.z);
  });
});

describe('edit map transparency', () => {
  it('marks library cutaways and explains them honestly', () => {
    const plan = composeStudioPlan({
      profile: profile(), sourceDurationS: 300,
      interest: Array.from({ length: 300 }, () => 0.5),
      brollLibrary: library,
    });
    const markers = buildEditMap(plan);
    const brollMarkers = markers.filter(m => m.type === 'broll');
    expect(brollMarkers.length).toBeGreaterThan(0);
    for (const m of brollMarkers) expect(m.fromLibrary).toBe(true);
    const why = explainMarker(brollMarkers[0], { hasRef: false });
    expect(why).toMatch(/library/i);

    // And the fallback wording is unchanged for source cutaways.
    const fallback = composeStudioPlan({
      profile: profile(), sourceDurationS: 300,
      interest: Array.from({ length: 300 }, () => 0.5),
    });
    const fbMarkers = buildEditMap(fallback).filter(m => m.type === 'broll');
    if (fbMarkers.length) {
      expect(fbMarkers[0].fromLibrary ?? false).toBe(false);
      expect(explainMarker(fbMarkers[0], { hasRef: false })).not.toMatch(/library/i);
    }
  });
});
