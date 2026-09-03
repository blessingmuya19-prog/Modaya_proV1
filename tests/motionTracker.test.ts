import { describe, it, expect } from 'vitest';
import {
  getTrackedPositionAt,
  smoothTrackPoints,
  trackPatchMovement,
  generateSubjectMotionTrack,
  type MotionTrackConfig,
  type TrackPoint,
} from '@/lib/ai/motionTracker';

describe('motion tracking & dynamic subject anchoring', () => {
  it('interpolates trajectory positions smoothly across timeline time', () => {
    const track: MotionTrackConfig = {
      enabled: true,
      mode: 'smooth_follow',
      anchorOffset: { x: 0, y: -0.1 },
      smoothRadiusS: 0.2,
      points: [
        { tS: 0.0, x: 0.2, y: 0.4, scale: 1.0 },
        { tS: 2.0, x: 0.8, y: 0.6, scale: 1.2 },
      ],
    };

    // At start (t = 0.0s)
    const at0 = getTrackedPositionAt(0.0, track);
    expect(at0.x).toBeCloseTo(0.2, 2);
    expect(at0.y).toBeCloseTo(0.3, 2); // 0.4 - 0.1 offset
    expect(at0.scale).toBeCloseTo(1.0, 2);

    // At midpoint (t = 1.0s)
    const at1 = getTrackedPositionAt(1.0, track);
    expect(at1.x).toBeGreaterThan(0.2);
    expect(at1.x).toBeLessThan(0.8);
    expect(at1.y).toBeCloseTo(0.4, 1); // 0.5 - 0.1 offset
    expect(at1.scale).toBeCloseTo(1.1, 1);

    // At end (t = 2.0s)
    const at2 = getTrackedPositionAt(2.0, track);
    expect(at2.x).toBeCloseTo(0.8, 2);
    expect(at2.y).toBeCloseTo(0.5, 2); // 0.6 - 0.1 offset
    expect(at2.scale).toBeCloseTo(1.2, 2);
  });

  it('clamps coordinates to [0, 1] screen bounds even with large offsets', () => {
    const track: MotionTrackConfig = {
      enabled: true,
      mode: 'rigid_lock',
      anchorOffset: { x: 0.5, y: -0.8 },
      smoothRadiusS: 0.2,
      points: [
        { tS: 1.0, x: 0.9, y: 0.1 },
      ],
    };

    const pos = getTrackedPositionAt(1.0, track);
    expect(pos.x).toBe(1.0); // clamped at right edge
    expect(pos.y).toBe(0.0); // clamped at top edge
  });

  it('smoothes noisy tracking points using exponential moving average (EMA)', () => {
    const noisy: TrackPoint[] = [
      { tS: 0.0, x: 0.50, y: 0.50 },
      { tS: 0.1, x: 0.70, y: 0.65 }, // jitter jump
      { tS: 0.2, x: 0.52, y: 0.51 }, // back to path
      { tS: 0.3, x: 0.54, y: 0.52 },
    ];

    const smoothed = smoothTrackPoints(noisy, 0.35);
    expect(smoothed).toHaveLength(4);

    // Jitter jump at index 1 is damped
    expect(smoothed[1].x).toBeLessThan(0.70);
    expect(smoothed[1].x).toBeGreaterThan(0.50);
  });

  it('tracks patch displacement using 2D block matching', () => {
    const width = 64;
    const height = 64;
    const frameA = new Uint8ClampedArray(width * height * 4);
    const frameB = new Uint8ClampedArray(width * height * 4);

    // Place a bright white square target at center (32, 32) in frameA
    for (let y = 30; y <= 34; y++) {
      for (let x = 30; x <= 34; x++) {
        const idx = (y * width + x) * 4;
        frameA[idx] = 255;
        frameA[idx + 1] = 255;
        frameA[idx + 2] = 255;
        frameA[idx + 3] = 255;
      }
    }

    // Shift the target 4 pixels to the right in frameB (36, 32)
    for (let y = 30; y <= 34; y++) {
      for (let x = 34; x <= 38; x++) {
        const idx = (y * width + x) * 4;
        frameB[idx] = 255;
        frameB[idx + 1] = 255;
        frameB[idx + 2] = 255;
        frameB[idx + 3] = 255;
      }
    }

    const match = trackPatchMovement(frameA, frameB, width, height, 0.5, 0.5, 12, 8);
    expect(match.deltaX).toBeGreaterThan(0); // detected rightward movement
    expect(match.score).toBeGreaterThan(0.5);
  });

  it('generates deterministic subject motion tracks for animated presets', () => {
    const track = generateSubjectMotionTrack('head_level', 0.0, 5.0, 0.5);
    expect(track.enabled).toBe(true);
    expect(track.points.length).toBeGreaterThan(5);
    expect(track.points[0].tS).toBe(0.0);
    expect(track.points[track.points.length - 1].tS).toBeCloseTo(5.0, 1);
  });
});
