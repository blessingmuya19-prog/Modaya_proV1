import { describe, it, expect } from 'vitest';
import {
  estimateSaliencyCentroid,
  generateAutoReframeTrajectory,
  getAutoReframeOffset,
  ASPECT_RATIO_PRESETS,
  DEFAULT_AUTOREFRAME_CONFIG,
} from '@/lib/render/autoReframe';

describe('auto-reframe & dynamic subject tracking', () => {
  it('has valid aspect ratio presets and dimensions', () => {
    expect(ASPECT_RATIO_PRESETS['9:16'].width).toBe(1080);
    expect(ASPECT_RATIO_PRESETS['9:16'].height).toBe(1920);
    expect(ASPECT_RATIO_PRESETS['16:9'].width).toBe(1920);
    expect(ASPECT_RATIO_PRESETS['16:9'].height).toBe(1080);
    expect(ASPECT_RATIO_PRESETS['1:1'].ratio).toBe(1);
  });

  it('estimates saliency centroid prioritizing face/skin pixels and high contrast', () => {
    const width = 64;
    const height = 64;
    const pixels = new Uint8ClampedArray(width * height * 4);

    // Fill background with dark gray
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 30; pixels[i + 1] = 30; pixels[i + 2] = 30; pixels[i + 3] = 255;
    }

    // Place warm skin-toned subject on right side (x: 45 to 55, y: 20 to 35)
    for (let y = 20; y <= 35; y++) {
      for (let x = 45; x <= 55; x++) {
        const idx = (y * width + x) * 4;
        // Typical skin tone (R > G > B)
        pixels[idx] = 220; pixels[idx + 1] = 160; pixels[idx + 2] = 120; pixels[idx + 3] = 255;
      }
    }

    const centroid = estimateSaliencyCentroid(pixels, width, height);
    expect(centroid.confidence).toBeGreaterThan(0.15);
    // Focal point x should be weighted toward right side (> 0.55)
    expect(centroid.focalX).toBeGreaterThan(0.55);
  });

  it('generates smoothed reframe pan trajectory with deadzone damping', () => {
    const focalPoints = [
      { timeS: 0.0, focalX: 0.5, focalY: 0.5, confidence: 1.0 },
      // Subject steps to left (focalX = 0.2)
      { timeS: 1.0, focalX: 0.2, focalY: 0.5, confidence: 1.0 },
      { timeS: 2.0, focalX: 0.2, focalY: 0.5, confidence: 1.0 },
      // Subject steps to right (focalX = 0.8)
      { timeS: 3.0, focalX: 0.8, focalY: 0.5, confidence: 1.0 },
      { timeS: 4.0, focalX: 0.8, focalY: 0.5, confidence: 1.0 },
    ];

    const keyframes = generateAutoReframeTrajectory(focalPoints, '9:16', 16 / 9, {
      deadzoneRadius: 0.04,
      motionDamping: 0.8,
    });

    expect(keyframes).toHaveLength(5);
    expect(keyframes[0].timeS).toBe(0.0);
    // At t=0, camera centered
    expect(keyframes[0].offsetX).toBeCloseTo(0, 2);

    // At t=1.0 & 2.0, camera pans to re-center the left subject (positive offset shifts source rightward)
    expect(keyframes[1].offsetX).toBeGreaterThan(0);
    expect(keyframes[2].offsetX).toBeGreaterThan(keyframes[1].offsetX);

    // At t=3.0 & 4.0, camera pans to the right (negative offset)
    expect(keyframes[4].offsetX).toBeLessThan(0);
  });

  it('interpolates smooth pan offset at arbitrary timestamps between keyframes', () => {
    const keyframes = [
      { timeS: 0.0, offsetX: 0.0, offsetY: 0.0, scale: 1.0 },
      { timeS: 2.0, offsetX: 0.2, offsetY: 0.0, scale: 1.0 },
      { timeS: 4.0, offsetX: -0.1, offsetY: 0.0, scale: 1.0 },
    ];

    // At exact keyframe
    const at0 = getAutoReframeOffset(keyframes, 0.0);
    expect(at0.offsetX).toBeCloseTo(0.0, 3);

    // At midpoint t=1.0 (between 0.0 and 0.2)
    const atMid = getAutoReframeOffset(keyframes, 1.0);
    expect(atMid.offsetX).toBeCloseTo(0.1, 2);

    // Before first keyframe clamped
    const before = getAutoReframeOffset(keyframes, -1.0);
    expect(before.offsetX).toBe(0.0);

    // After last keyframe clamped
    const after = getAutoReframeOffset(keyframes, 10.0);
    expect(after.offsetX).toBe(-0.1);
  });
});
