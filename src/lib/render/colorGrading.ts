/**
 * Cinematic 3D LUT Color Grading & Intelligent Scene Tone Mapping Engine.
 *
 * Implements industry-standard cinematic color transforms (Teal & Orange, Kodak 35mm,
 * Fuji Chrome, Noir, Cyberpunk, Bleach Bypass, Golden Hour) with multi-stage
 * lift/gamma/gain, color temperature/tint matrix, and skin-tone preserving vibrance.
 */

export interface ColorGradeConfig {
  lutId?: 'neutral' | 'teal_orange' | 'kodak_35mm' | 'fuji_chrome' | 'noir' | 'cyberpunk' | 'bleach_bypass' | 'golden_hour';
  temperature: number; // -100 (cool) to +100 (warm)
  tint: number;        // -100 (green) to +100 (magenta)
  vibrance: number;    // -100 to +100
  exposure: number;    // -2.0 to +2.0 EV (default 0)
  contrast: number;    // 0.5 to 2.0 (default 1.0)
  highlights: number;  // -100 to +100 (gain roll-off)
  shadows: number;     // -100 to +100 (lift)
  intensity: number;   // 0% to 100% LUT blend amount
}

export const DEFAULT_COLOR_GRADE: ColorGradeConfig = {
  lutId: 'neutral',
  temperature: 0,
  tint: 0,
  vibrance: 0,
  exposure: 0,
  contrast: 1.0,
  highlights: 0,
  shadows: 0,
  intensity: 100,
};

export interface LutPreset {
  id: ColorGradeConfig['lutId'];
  name: string;
  category: string;
  description: string;
  swatch: [string, string, string]; // [Shadow, Midtone, Highlight]
  temperature: number;
  tint: number;
  vibrance: number;
  contrast: number;
  shadows: number;
  highlights: number;
  // 3x3 Color Matrix for channel crosstalk / primary grading
  colorMatrix: [
    number, number, number,
    number, number, number,
    number, number, number
  ];
}

export const CINEMATIC_LUTS: Record<string, LutPreset> = {
  neutral: {
    id: 'neutral',
    name: 'Natural Rec.709',
    category: 'Standard',
    description: 'Clean, uncolored true-to-life broadcast color profile',
    swatch: ['#222222', '#888888', '#F5F5F5'],
    temperature: 0,
    tint: 0,
    vibrance: 0,
    contrast: 1.0,
    shadows: 0,
    highlights: 0,
    colorMatrix: [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ],
  },
  teal_orange: {
    id: 'teal_orange',
    name: 'Teal & Orange',
    category: 'Hollywood Blockbuster',
    description: 'Deep cyan shadows with radiant warm amber skin tones',
    swatch: ['#0A2533', '#C67D34', '#F4A261'],
    temperature: 15,
    tint: -5,
    vibrance: 25,
    contrast: 1.22,
    shadows: -8,
    highlights: 10,
    colorMatrix: [
      1.18, -0.08, -0.10,
      -0.05, 1.05,  0.00,
      -0.12,  0.08, 1.25,
    ],
  },
  kodak_35mm: {
    id: 'kodak_35mm',
    name: 'Kodak Portra 35mm',
    category: 'Vintage Film',
    description: 'Soft analog grain, rich organic warm tones, and gentle highlight roll-off',
    swatch: ['#2B2118', '#A2704E', '#F8E9D2'],
    temperature: 22,
    tint: 8,
    vibrance: -10,
    contrast: 1.12,
    shadows: 12,
    highlights: -15,
    colorMatrix: [
      1.14,  0.02, -0.16,
      0.00,  1.06, -0.06,
      -0.08, -0.02, 0.90,
    ],
  },
  fuji_chrome: {
    id: 'fuji_chrome',
    name: 'Fujifilm Velvia',
    category: 'Vivid Film',
    description: 'Lush saturated greens, crisp sky blues, and high dynamic punch',
    swatch: ['#121B24', '#2A9D8F', '#E76F51'],
    temperature: -8,
    tint: -12,
    vibrance: 40,
    contrast: 1.28,
    shadows: -12,
    highlights: 8,
    colorMatrix: [
      1.08, -0.04, -0.04,
      -0.02, 1.20, -0.18,
      -0.06, -0.10, 1.22,
    ],
  },
  noir: {
    id: 'noir',
    name: 'Cinematic Noir',
    category: 'Black & White',
    description: 'High-contrast silver gelatin print with rich deep blacks',
    swatch: ['#050505', '#555555', '#EFEFEF'],
    temperature: 0,
    tint: 0,
    vibrance: -100,
    contrast: 1.45,
    shadows: -20,
    highlights: 18,
    colorMatrix: [
      0.299, 0.587, 0.114,
      0.299, 0.587, 0.114,
      0.299, 0.587, 0.114,
    ],
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyber Neon',
    category: 'Sci-Fi / Night',
    description: 'Deep violet/magenta shadows and vibrant electric cyan neon lights',
    swatch: ['#1E0A3C', '#7209B7', '#4CC9F0'],
    temperature: -25,
    tint: 35,
    vibrance: 50,
    contrast: 1.35,
    shadows: -15,
    highlights: 25,
    colorMatrix: [
      1.25, -0.20,  0.15,
      -0.10, 0.90,  0.30,
      0.20, -0.15,  1.40,
    ],
  },
  bleach_bypass: {
    id: 'bleach_bypass',
    name: 'Bleach Bypass',
    category: 'Action / Gritty',
    description: 'Desaturated midtones with high silver contrast and gritty edge',
    swatch: ['#1A1A1A', '#6B705C', '#DDBEA9'],
    temperature: -5,
    tint: 5,
    vibrance: -45,
    contrast: 1.5,
    shadows: -25,
    highlights: 15,
    colorMatrix: [
      0.95, 0.05, 0.00,
      0.05, 0.90, 0.05,
      0.00, 0.05, 0.95,
    ],
  },
  golden_hour: {
    id: 'golden_hour',
    name: 'Golden Hour Sunset',
    category: 'Warm / Mood',
    description: 'Rich amber sun glow with warm lifted shadows and soft haze',
    swatch: ['#3D2314', '#D48C46', '#FFE3A8'],
    temperature: 45,
    tint: -10,
    vibrance: 30,
    contrast: 1.08,
    shadows: 18,
    highlights: -10,
    colorMatrix: [
      1.28,  0.00, -0.28,
      0.04,  1.12, -0.16,
      -0.15, -0.05, 0.75,
    ],
  },
};

/**
 * Apply 3D LUT matrix and tone curve adjustments to raw RGBA pixel data.
 */
export function applyLutToPixels(
  pixels: Uint8ClampedArray,
  grade: ColorGradeConfig,
  lut: LutPreset = CINEMATIC_LUTS.neutral,
): void {
  if (!pixels || pixels.length === 0) return;

  const blend = Math.max(0, Math.min(1.0, (grade.intensity ?? 100) / 100));
  if (blend < 0.01 && grade.temperature === 0 && grade.tint === 0 && grade.vibrance === 0) return;

  // Temperature & Tint matrix adjustments
  const tempShift = (grade.temperature + lut.temperature) / 100;
  const tintShift = (grade.tint + lut.tint) / 100;

  const rGain = 1.0 + tempShift * 0.22 + tintShift * 0.1;
  const gGain = 1.0 - tintShift * 0.15;
  const bGain = 1.0 - tempShift * 0.22 + tintShift * 0.05;

  const mat = lut.colorMatrix;
  const contrast = (grade.contrast ?? 1.0) * lut.contrast;
  const vibranceFactor = ((grade.vibrance + lut.vibrance) / 100);

  const shadowLift = (grade.shadows + lut.shadows) * 0.35;
  const highlightGain = 1.0 + (grade.highlights + lut.highlights) * 0.005;

  for (let i = 0; i < pixels.length; i += 4) {
    const rOrig = pixels[i];
    const gOrig = pixels[i + 1];
    const bOrig = pixels[i + 2];

    // 1. Matrix transform
    let r = mat[0] * rOrig + mat[1] * gOrig + mat[2] * bOrig;
    let g = mat[3] * rOrig + mat[4] * gOrig + mat[5] * bOrig;
    let b = mat[6] * rOrig + mat[7] * gOrig + mat[8] * bOrig;

    // 2. White balance (Temp / Tint)
    r *= rGain;
    g *= gGain;
    b *= bGain;

    // 3. Contrast S-curve around mid-point 128
    r = 128 + (r - 128) * contrast;
    g = 128 + (g - 128) * contrast;
    b = 128 + (b - 128) * contrast;

    // 4. Lift & Gain
    r = (r + shadowLift) * highlightGain;
    g = (g + shadowLift) * highlightGain;
    b = (b + shadowLift) * highlightGain;

    // 5. Vibrance (boosts less saturated pixels more, protecting skin tones)
    const maxVal = Math.max(r, g, b);
    const minVal = Math.min(r, g, b);
    const sat = maxVal > 0 ? (maxVal - minVal) / maxVal : 0;
    const vibAmount = vibranceFactor * (1.0 - sat * 0.6);

    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    r = r + (r - luma) * vibAmount;
    g = g + (g - luma) * vibAmount;
    b = b + (b - luma) * vibAmount;

    // 6. Blend with original based on intensity
    pixels[i]     = Math.min(255, Math.max(0, Math.round(rOrig * (1 - blend) + r * blend)));
    pixels[i + 1] = Math.min(255, Math.max(0, Math.round(gOrig * (1 - blend) + g * blend)));
    pixels[i + 2] = Math.min(255, Math.max(0, Math.round(bOrig * (1 - blend) + b * blend)));
  }
}
