import { describe, it, expect } from 'vitest';
import {
  getInterpolatedZoom,
  generateSmartZoomTrack,
  easeInOutCubic,
  DEFAULT_SMART_ZOOM_CONFIG,
  type ZoomKeyframe,
} from '../src/lib/render/smartZoom';

describe('Smart Zoom & Dynamic Punch-In Engine', () => {
  it('interpolates smooth cubic eases between zoom keyframes', () => {
    const keyframes: ZoomKeyframe[] = [
      { time: 0, scale: 1.0, offsetX: 0, offsetY: 0, easing: 'instant_cut' },
      { time: 2.0, scale: 1.3, offsetX: 0.1, offsetY: -0.1, easing: 'ease_in_out', duration: 0.5 },
    ];

    // At t=0, scale should be 1.0
    const at0 = getInterpolatedZoom(keyframes, 0);
    expect(at0.scale).toBeCloseTo(1.0);

    // At t=1.0 (before transition window starting at 1.5), scale should still be 1.0
    const at1 = getInterpolatedZoom(keyframes, 1.0);
    expect(at1.scale).toBeCloseTo(1.0);

    // At t=1.75 (midway through transition window 1.5..2.0), scale should be between 1.0 and 1.3
    const atMid = getInterpolatedZoom(keyframes, 1.75);
    expect(atMid.scale).toBeGreaterThan(1.0);
    expect(atMid.scale).toBeLessThan(1.3);

    // At t=2.0 (end of transition), scale should be 1.3
    const at2 = getInterpolatedZoom(keyframes, 2.0);
    expect(at2.scale).toBeCloseTo(1.3);
  });

  it('generates sentence and punchline-aware dynamic keyframes', () => {
    const sentences = [
      { start: 0.5, end: 3.0, text: 'Welcome to the channel!' },
      { start: 3.5, end: 6.0, text: 'Here is the most important secret.', isPunchline: true },
      { start: 6.5, end: 9.0, text: 'Make sure to subscribe for more.' },
    ];

    const keyframes = generateSmartZoomTrack(10.0, sentences, [], {
      enabled: true,
      intensity: 'dynamic',
      style: 'center_punch',
    });

    expect(keyframes.length).toBeGreaterThanOrEqual(2);
    // Dynamic intensity should reach ~1.32x scale
    const hasDynamicPunch = keyframes.some(kf => kf.scale > 1.25);
    expect(hasDynamicPunch).toBe(true);
  });

  it('generates cadenced rhythmic zoom track when no transcript is provided', () => {
    const keyframes = generateSmartZoomTrack(15.0, [], [], {
      frequency: 'medium',
    });

    expect(keyframes.length).toBeGreaterThan(2);
    expect(keyframes[0].time).toBe(0);
    // Keyframes should be strictly ascending in time
    for (let i = 1; i < keyframes.length; i++) {
      expect(keyframes[i].time).toBeGreaterThan(keyframes[i - 1].time);
    }
  });

  it('handles empty keyframe list and out-of-bound timestamps safely', () => {
    const emptyResult = getInterpolatedZoom([], 5.0);
    expect(emptyResult.scale).toBe(1.0);
    expect(emptyResult.offsetX).toBe(0);
    expect(emptyResult.offsetY).toBe(0);

    const singleKeyframe: ZoomKeyframe[] = [
      { time: 1.0, scale: 1.2, offsetX: 0, offsetY: 0, easing: 'instant_cut' },
    ];
    const beforeResult = getInterpolatedZoom(singleKeyframe, 0.5);
    expect(beforeResult.scale).toBe(1.2);

    const afterResult = getInterpolatedZoom(singleKeyframe, 2.5);
    expect(afterResult.scale).toBe(1.2);
  });
});
