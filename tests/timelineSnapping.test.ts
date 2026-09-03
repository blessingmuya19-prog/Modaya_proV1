import { describe, it, expect } from 'vitest';
import {
  collectSnapTargets,
  calculateSnapPoint,
  resolveRippleCollisions,
  closeTimelineGaps,
  type TimelineClipItem,
} from '../src/lib/studio/timelineSnapping';

describe('Multi-Track Timeline Magnetism & Snapping Engine', () => {
  const sampleClips: TimelineClipItem[] = [
    { id: 'clip-1', trackId: 'video', startS: 0, endS: 3.5, label: 'Intro' },
    { id: 'clip-2', trackId: 'video', startS: 3.5, endS: 8.0, label: 'Main' },
    { id: 'broll-1', trackId: 'broll', startS: 2.0, endS: 4.5, label: 'Cutaway' },
  ];

  it('collects clip edges, playhead, and musical beat snap targets', () => {
    const targets = collectSnapTargets(sampleClips, 5.0, [1.0, 2.0, 3.0, 4.0], [{ time: 6.5, label: 'Hook' }]);
    expect(targets.length).toBeGreaterThan(6);

    const hasPlayhead = targets.some(t => t.type === 'playhead' && t.time === 5.0);
    expect(hasPlayhead).toBe(true);

    const hasClipEnd = targets.some(t => t.type === 'clip_edge' && t.time === 3.5);
    expect(hasClipEnd).toBe(true);
  });

  it('magnetically snaps within threshold distance', () => {
    const targets = collectSnapTargets(sampleClips, undefined, [], []);
    // Snap close to 3.5s (clip-1 end / clip-2 start)
    const snapResult = calculateSnapPoint(3.54, targets, 0.12);
    expect(snapResult.isSnapped).toBe(true);
    expect(snapResult.snappedTime).toBeCloseTo(3.5);
    expect(snapResult.snapDelta).toBeCloseTo(-0.04);
  });

  it('resolves ripple collisions by shifting downstream clips', () => {
    // Expanding clip-1 from 0..3.5 to 0..5.0 should push clip-2 from 3.5 to 5.0
    const resolution = resolveRippleCollisions(sampleClips, 'clip-1', 0, 5.0);
    expect(resolution.hasCollisions).toBe(true);

    const pushedClip2 = resolution.adjustedClips.find(c => c.id === 'clip-2');
    expect(pushedClip2?.startS).toBeCloseTo(5.0);
    expect(pushedClip2?.endS).toBeCloseTo(9.5); // Preserves 4.5s duration
  });

  it('closes timeline gaps on target track without altering other tracks', () => {
    const clipsWithGap: TimelineClipItem[] = [
      { id: 'v1', trackId: 'video', startS: 0, endS: 2.0 },
      { id: 'v2', trackId: 'video', startS: 2.8, endS: 5.0 }, // 0.8s gap
      { id: 'a1', trackId: 'audio', startS: 1.0, endS: 4.0 },
    ];

    const closed = closeTimelineGaps(clipsWithGap, 'video');
    const closedV2 = closed.find(c => c.id === 'v2');
    expect(closedV2?.startS).toBeCloseTo(2.0);
    expect(closedV2?.endS).toBeCloseTo(4.2);

    // Audio clip unchanged
    const audioClip = closed.find(c => c.id === 'a1');
    expect(audioClip?.startS).toBe(1.0);
  });
});
