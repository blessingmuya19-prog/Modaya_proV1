import { describe, it, expect } from 'vitest';
import {
  createBeatGrid,
  snapToNearestBeat,
  generateRhythmicCutTimestamps,
} from '../src/lib/audio/beatGrid';

describe('Real-Time Audio Beat & Rhythm Snap Grid Engine', () => {
  it('creates an accurate 120 BPM beat grid with downbeats and quarter notes', () => {
    // 120 BPM = 0.5s per beat, 2.0s per 4/4 bar
    const grid = createBeatGrid(120, 10.0, 0, [4, 4], 'quarter');
    expect(grid.bpm).toBe(120);
    expect(grid.secondsPerBeat).toBeCloseTo(0.5);
    expect(grid.ticks.length).toBeGreaterThanOrEqual(20);

    // Beat 1 (t=0) should be a downbeat
    expect(grid.ticks[0].time).toBe(0);
    expect(grid.ticks[0].isDownbeat).toBe(true);
    expect(grid.ticks[0].subdivision).toBe('downbeat');

    // Beat 2 (t=0.5) should be a regular quarter note
    expect(grid.ticks[1].time).toBeCloseTo(0.5);
    expect(grid.ticks[1].isDownbeat).toBe(false);

    // Beat 5 (t=2.0) should be the next downbeat
    const bar2Downbeat = grid.ticks.find(t => Math.abs(t.time - 2.0) < 0.01);
    expect(bar2Downbeat).toBeDefined();
    expect(bar2Downbeat?.isDownbeat).toBe(true);
  });

  it('magnetically snaps timestamps within the snap threshold', () => {
    const grid = createBeatGrid(120, 10.0, 0, [4, 4], 'quarter');

    // Time 1.03s is close to 1.0s (delta 0.03s <= 0.12s threshold) -> snaps to 1.0s
    const snapNear = snapToNearestBeat(1.03, grid, 0.12);
    expect(snapNear.isSnapped).toBe(true);
    expect(snapNear.snappedTime).toBeCloseTo(1.0);
    expect(snapNear.delta).toBeCloseTo(-0.03);

    // Time 1.25s is midway between 1.0s and 1.5s (delta 0.25s > 0.12s threshold) -> does not snap
    const snapFar = snapToNearestBeat(1.25, grid, 0.12);
    expect(snapFar.isSnapped).toBe(false);
    expect(snapFar.snappedTime).toBe(1.25);
  });

  it('generates rhythmic cuts on musical bar boundaries', () => {
    // 120 BPM, 4 beats per cut = cut every 2.0 seconds
    const cuts = generateRhythmicCutTimestamps(120, 10.0, 0, 4);
    expect(cuts.length).toBe(4); // 2.0, 4.0, 6.0, 8.0
    expect(cuts[0]).toBeCloseTo(2.0);
    expect(cuts[1]).toBeCloseTo(4.0);
    expect(cuts[2]).toBeCloseTo(6.0);
    expect(cuts[3]).toBeCloseTo(8.0);
  });
});
