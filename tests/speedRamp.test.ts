import { describe, it, expect } from 'vitest';
import {
  getSpeedAtSourceTime,
  calculateRemappedDuration,
  mapOutputTimeToSourceTime,
  SPEED_RAMP_PRESETS,
  type SpeedKeyframe,
} from '../src/lib/render/speedRamp';

describe('Video Speed Ramping & Variable Time-Remapping Engine', () => {
  it('smoothly interpolates speeds between keyframes', () => {
    const keyframes: SpeedKeyframe[] = [
      { sourceTime: 0, speed: 1.0 },
      { sourceTime: 4.0, speed: 4.0 },
    ];

    expect(getSpeedAtSourceTime(keyframes, 0)).toBe(1.0);
    expect(getSpeedAtSourceTime(keyframes, 4.0)).toBe(4.0);
    // Midway at t=2.0, speed should be ~2.5
    const midSpeed = getSpeedAtSourceTime(keyframes, 2.0);
    expect(midSpeed).toBeCloseTo(2.5, 1);
  });

  it('calculates output duration for hyperlapse and slow-motion ramps', () => {
    // 10s clip at constant 4.0x hyperlapse should yield 2.5s output duration
    const hyperKeyframes: SpeedKeyframe[] = [{ sourceTime: 0, speed: 4.0 }];
    const hyperDur = calculateRemappedDuration(hyperKeyframes, 0, 10.0);
    expect(hyperDur).toBeCloseTo(2.5, 1);

    // 10s clip at constant 0.5x slow-mo should yield 20.0s output duration
    const slowKeyframes: SpeedKeyframe[] = [{ sourceTime: 0, speed: 0.5 }];
    const slowDur = calculateRemappedDuration(slowKeyframes, 0, 10.0);
    expect(slowDur).toBeCloseTo(20.0, 1);
  });

  it('maps timeline output timestamps back to source video frames correctly', () => {
    const keyframes = SPEED_RAMP_PRESETS.montage_whip(10.0);
    const outputDuration = calculateRemappedDuration(keyframes, 0, 10.0);
    expect(outputDuration).toBeGreaterThan(0);

    // At outputTime = 0, source time is 0
    expect(mapOutputTimeToSourceTime(keyframes, 0, 0, 10.0)).toBeCloseTo(0);

    // At outputTime = full duration, source time reaches 10.0
    const endSource = mapOutputTimeToSourceTime(keyframes, outputDuration, 0, 10.0);
    expect(endSource).toBeCloseTo(10.0, 1);
  });
});
