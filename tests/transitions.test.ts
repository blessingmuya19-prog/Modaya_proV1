/**
 * The kinetic layer: animated zooms (not static pre-scale) and real
 * transitions between shots — deterministic decisions, tested math.
 */
import { describe, it, expect } from 'vitest';
import {
  zoomKeyframesForShot, zoomAt, transitionForJunction, transitionProgress,
  transitionAlpha, transitionTransform,
  type TransitionSpec,
} from '@/lib/render/transitions';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, buildSequence, videoClipsAt } from '@/lib/render/sequence';

describe('zoomKeyframesForShot', () => {
  it('ramps 1.0 → target at the measured peak, holds, then settles', () => {
    const kf = zoomKeyframesForShot(10, 15, 11.4, 1.18);
    expect(kf.length).toBeGreaterThanOrEqual(4);
    expect(kf[0]).toMatchObject({ time: 10, scale: 1 });
    /* exactly at the peak, mid-ramp: scale strictly between 1 and target */
    const mid = zoomAt(kf, 11.45);
    expect(mid.scale).toBeGreaterThan(1);
    expect(mid.scale).toBeLessThan(1.18);
    /* held on the punchline */
    const held = zoomAt(kf, 12.5);
    expect(held.scale).toBeCloseTo(1.18, 2);
    /* settled back before the cut */
    expect(zoomAt(kf, 14.95).scale).toBeCloseTo(1, 2);
  });

  it('refuses to zoom a shot too short to animate', () => {
    expect(zoomKeyframesForShot(10, 10.4, 10.2, 1.2)).toEqual([]);
  });

  it('clamps the target so a loose profile cannot over-zoom', () => {
    const kf = zoomKeyframesForShot(0, 5, 1, 9);
    expect(Math.max(...kf.map(k => k.scale))).toBeLessThanOrEqual(1.45);
  });

  it('returns neutral when there are no keyframes', () => {
    expect(zoomAt(undefined, 3)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe('transitionForJunction', () => {
  it('whips an energetic beat-synced source jump', () => {
    const t = transitionForJunction({
      energy: 0.8, beatSynced: true, punchInRate: 0.5, sourceJump: true, decision: 0.1,
    });
    expect(t?.kind).toBe('whip');
  });

  it('dissolves a calm jump (or passes when the decision misses)', () => {
    const calm = transitionForJunction({
      energy: 0.3, beatSynced: false, punchInRate: 0.1, sourceJump: true, decision: 0.1,
    });
    expect(calm?.kind).toBe('crossfade');
    expect(transitionForJunction({
      energy: 0.3, beatSynced: false, punchInRate: 0.1, sourceJump: true, decision: 0.9,
    })).toBeNull();
  });

  it('never fakes a transition on a continuous source', () => {
    expect(transitionForJunction({
      energy: 1, beatSynced: true, punchInRate: 1, sourceJump: false, decision: 0,
    })).toBeNull();
  });
});

describe('transitionProgress / alpha / transform', () => {
  it('eases 0→1 across the window', () => {
    expect(transitionProgress(10, 10, 0.4)).toBe(0);
    expect(transitionProgress(10.2, 10, 0.4)).toBeCloseTo(0.5);
    expect(transitionProgress(10.4, 10, 0.4)).toBe(1);
  });

  it('crossfade alpha complements lead and follow', () => {
    const m = transitionAlpha('crossfade', 0.5);
    expect(m.lead).toBeCloseTo(0.5);
    expect(m.follow).toBeCloseTo(0.5);
    expect(m.lead + m.follow).toBeCloseTo(1);
  });

  it('whips the incoming shot into place and recoils the outgoing', () => {
    const base = { ...DEFAULT_TRANSFORM };
    const lead = transitionTransform('whip', base, 0.5, 'lead');
    const follow = transitionTransform('whip', base, 0.5, 'follow');
    expect(lead.scale).toBeGreaterThan(1);
    expect(lead.offsetX).not.toBe(0);
    /* at the end of the window both settle at identity */
    expect(transitionTransform('whip', base, 1, 'lead')).toEqual(base);
    /* crossfade never moves the framing */
    expect(transitionTransform('crossfade', base, 0.5, 'lead')).toEqual(base);
  });
});

describe('sequence build — the overlap that makes a transition playable', () => {
  const clips = [
    { id: 'a', trackId: 'video', label: 'A', startS: 0, endS: 4,
      type: 'video' as const, sourceIn: 0 },
    { id: 'b', trackId: 'video', label: 'B', startS: 4, endS: 8,
      type: 'video' as const, sourceIn: 9, transition: { kind: 'whip' as const, durS: 0.4 } },
  ];

  it('extends the outgoing tail and keeps both clips on screen during the window', () => {
    const seq = buildSequence(clips, { durationS: 8, width: 1080, height: 1920, sourceId: 's' });
    const a = seq.clips.find(c => c.id === 'a')!;
    const b = seq.clips.find(c => c.id === 'b')!;
    expect(a.timelineOut).toBeCloseTo(4.4);       // extended by the transition
    expect(b.transition?.kind).toBe('whip');
    /* at 4.2s both clips are active — that is what the renderer composites */
    const at = videoClipsAt(seq, 4.2);
    expect(at.map(c => c.id)).toEqual(['a', 'b']);
    /* after the window the outgoing is gone */
    expect(videoClipsAt(seq, 4.6).map(c => c.id)).toEqual(['b']);
  });

  it('does not create an overlap when a transition is absent', () => {
    const seq = buildSequence(clips.map(c => ({ ...c, transition: undefined })),
      { durationS: 8, width: 1080, height: 1920, sourceId: 's' });
    const a = seq.clips.find(c => c.id === 'a')!;
    expect(a.timelineOut).toBe(4);
    expect(videoClipsAt(seq, 4.2).map(c => c.id)).toEqual(['b']);
  });

  it('reads zoom and transition from the style layer (the Studio wiring)', () => {
    /* The Studio builds the sequence from editor clips + a StyleLayer; the
       kinetic data lives in the layer. This pins that pass-through — the
       exact gap that made every plan render flat. */
    const style = {
      a: { sourceIn: 2, transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS },
          zoom: zoomKeyframesForShot(0, 4, 0.8, 1.18) },
      b: { sourceIn: 9, transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS },
          transition: { kind: 'whip', durS: 0.4 } as TransitionSpec },
    };
    const seq = buildSequence([
      { id: 'a', trackId: 'video', label: 'A', startS: 0, endS: 4, type: 'video' as const, sourceIn: 0 },
      { id: 'b', trackId: 'video', label: 'B', startS: 4, endS: 8, type: 'video' as const, sourceIn: 0 },
    ], { durationS: 8, width: 1080, height: 1920, sourceId: 's', style });
    const a = seq.clips.find(c => c.id === 'a')!;
    const b = seq.clips.find(c => c.id === 'b')!;
    expect(a.zoom?.length).toBe(5);
    expect(a.sourceIn).toBe(2);                    // styled clip reads from the edit
    expect(b.transition?.kind).toBe('whip');
    expect(a.timelineOut).toBeGreaterThan(4);      // overlap still built
  });
});
