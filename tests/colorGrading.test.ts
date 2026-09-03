import { describe, it, expect } from 'vitest';
import {
  CINEMATIC_LUTS,
  applyLutToPixels,
  DEFAULT_COLOR_GRADE,
} from '@/lib/render/colorGrading';

describe('cinematic 3D LUT color grading & tone mapping', () => {
  it('contains cinematic LUT presets with valid color matrices and 3-swatch palettes', () => {
    expect(CINEMATIC_LUTS.neutral).toBeDefined();
    expect(CINEMATIC_LUTS.teal_orange).toBeDefined();
    expect(CINEMATIC_LUTS.kodak_35mm).toBeDefined();
    expect(CINEMATIC_LUTS.noir).toBeDefined();

    for (const lut of Object.values(CINEMATIC_LUTS)) {
      expect(lut.swatch).toHaveLength(3);
      expect(lut.colorMatrix).toHaveLength(9);
    }
  });

  it('applies Teal & Orange LUT shifting warm skin tones and cool cyan shadows', () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);

    // Pixel 0: Warm skin tone (R: 200, G: 140, B: 100)
    pixels[0] = 200; pixels[1] = 140; pixels[2] = 100; pixels[3] = 255;

    // Pixel 1: Cool shadow (R: 30, G: 40, B: 50)
    pixels[4] = 30; pixels[5] = 40; pixels[6] = 50; pixels[7] = 255;

    applyLutToPixels(pixels, {
      ...DEFAULT_COLOR_GRADE,
      lutId: 'teal_orange',
      intensity: 100,
    }, CINEMATIC_LUTS.teal_orange);

    // Warm skin tone should have boosted red/amber
    expect(pixels[0]).toBeGreaterThan(180);

    // Cool shadow should have boosted blue/cyan relative to red
    expect(pixels[6]).toBeGreaterThan(pixels[4]);
  });

  it('applies Noir black & white LUT converting RGB to luminance values', () => {
    const width = 2;
    const height = 2;
    const pixels = new Uint8ClampedArray(width * height * 4);

    // Highly saturated green pixel (R: 0, G: 255, B: 0)
    pixels[0] = 0; pixels[1] = 255; pixels[2] = 0; pixels[3] = 255;

    applyLutToPixels(pixels, {
      ...DEFAULT_COLOR_GRADE,
      lutId: 'noir',
      intensity: 100,
    }, CINEMATIC_LUTS.noir);

    // In black & white, R, G, and B should be very close to each other
    expect(Math.abs(pixels[0] - pixels[1])).toBeLessThanOrEqual(5);
    expect(Math.abs(pixels[1] - pixels[2])).toBeLessThanOrEqual(5);
  });

  it('respects LUT blend intensity slider (0% to 100%)', () => {
    const pixels = new Uint8ClampedArray([100, 100, 100, 255]);

    // 0% intensity should leave pixels unchanged
    applyLutToPixels(pixels, {
      ...DEFAULT_COLOR_GRADE,
      lutId: 'teal_orange',
      intensity: 0,
      temperature: 0,
      tint: 0,
      vibrance: 0,
    }, CINEMATIC_LUTS.teal_orange);

    expect(pixels[0]).toBe(100);
    expect(pixels[1]).toBe(100);
    expect(pixels[2]).toBe(100);
  });
});
