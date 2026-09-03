/**
 * Auto-Reframe & Dynamic Aspect Ratio Fitting with Intelligent Subject Tracking.
 *
 * Converts wide (16:9 / 4:3) footage into vertical (9:16 Shorts/Reels/TikTok),
 * square (1:1), or 4:5 feed formats with continuous subject centering and
 * camera pan smoothing (deadzone hysteresis + exponential moving average).
 */

export type TargetAspectRatio = '9:16' | '16:9' | '1:1' | '4:5' | '21:9';

export interface AspectDimensions {
  width: number;
  height: number;
  ratio: number;
  label: string;
}

export const ASPECT_RATIO_PRESETS: Record<TargetAspectRatio, AspectDimensions> = {
  '9:16': { width: 1080, height: 1920, ratio: 9 / 16, label: '9:16 Vertical (Shorts / TikTok / Reels)' },
  '16:9': { width: 1920, height: 1080, ratio: 16 / 9, label: '16:9 Landscape (YouTube / Standard)' },
  '1:1':  { width: 1080, height: 1080, ratio: 1 / 1,  label: '1:1 Square (Instagram Post)' },
  '4:5':  { width: 1080, height: 1350, ratio: 4 / 5,  label: '4:5 Portrait (Social Feed)' },
  '21:9': { width: 2560, height: 1080, ratio: 21 / 9, label: '21:9 Cinematic Ultrawide' },
};

export interface SubjectFocalPoint {
  timeS: number;
  focalX: number; // 0.0 (left) to 1.0 (right)
  focalY: number; // 0.0 (top) to 1.0 (bottom)
  confidence: number;
}

export interface AutoReframeKeyframe {
  timeS: number;
  offsetX: number; // -0.5 to +0.5 normalized canvas offset
  offsetY: number;
  scale: number;
}

export interface AutoReframeConfig {
  enabled: boolean;
  targetAspectRatio: TargetAspectRatio;
  subjectTracking: boolean;
  smoothingWindowS: number;
  deadzoneRadius: number;
  motionDamping: number;
  keyframes: AutoReframeKeyframe[];
}

export const DEFAULT_AUTOREFRAME_CONFIG: AutoReframeConfig = {
  enabled: false,
  targetAspectRatio: '9:16',
  subjectTracking: true,
  smoothingWindowS: 0.8,
  deadzoneRadius: 0.05,
  motionDamping: 0.82,
  keyframes: [],
};

/**
 * Estimate visual subject saliency centroid (x, y in [0, 1]) from an image frame
 * using luminance variance, edge density, and skin-tone chrominance weighting.
 */
export function estimateSaliencyCentroid(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { focalX: number; focalY: number; confidence: number } {
  if (!pixels || width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return { focalX: 0.5, focalY: 0.5, confidence: 0 };
  }

  let totalWeight = 0;
  let sumX = 0;
  let sumY = 0;

  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 64));

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      // Luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Skin tone heuristic in RGB (rule-based detection)
      const isSkin = (r > 95 && g > 40 && b > 20 &&
                      (Math.max(r, g, b) - Math.min(r, g, b) > 15) &&
                      Math.abs(r - g) > 15 && r > g && r > b);

      // Simple horizontal edge contrast
      let edge = 0;
      if (x + stepX < width) {
        const nextIdx = (y * width + (x + stepX)) * 4;
        const nextLum = 0.299 * pixels[nextIdx] + 0.587 * pixels[nextIdx + 1] + 0.114 * pixels[nextIdx + 2];
        edge = Math.abs(lum - nextLum) / 255;
      }

      let weight = edge * 2.0 + 0.02;
      if (isSkin) {
        weight += 6.0; // Strong priority for human face / skin regions
      }

      // Slightly favor central vertical third where subjects are typically framed
      const centerProximity = 1.0 - Math.abs((y / height) - 0.45);
      weight *= (0.5 + 0.5 * centerProximity);

      totalWeight += weight;
      sumX += (x / width) * weight;
      sumY += (y / height) * weight;
    }
  }

  if (totalWeight < 0.01) {
    return { focalX: 0.5, focalY: 0.5, confidence: 0.1 };
  }

  const focalX = Math.min(1.0, Math.max(0.0, sumX / totalWeight));
  const focalY = Math.min(1.0, Math.max(0.0, sumY / totalWeight));
  const confidence = Math.min(1.0, totalWeight / ((width / stepX) * (height / stepY) * 1.5));

  return { focalX, focalY, confidence };
}

/**
 * Generate smooth Auto-Reframe pan trajectory keyframes from subject focal points.
 * Implements camera deadzone hysteresis and critically damped low-pass smoothing
 * to keep the subject framed without micro-jitter or motion sickness.
 */
export function generateAutoReframeTrajectory(
  focalPoints: SubjectFocalPoint[],
  targetAspect: TargetAspectRatio,
  srcAspect: number = 16 / 9,
  config: Partial<AutoReframeConfig> = {},
): AutoReframeKeyframe[] {
  if (!focalPoints || focalPoints.length === 0) {
    return [{ timeS: 0, offsetX: 0, offsetY: 0, scale: 1 }];
  }

  const targetDim = ASPECT_RATIO_PRESETS[targetAspect] || ASPECT_RATIO_PRESETS['9:16'];
  const targetRatio = targetDim.ratio;

  // Maximum allowable horizontal travel offset
  let maxOffsetX = 0;
  if (srcAspect > targetRatio) {
    // Source is wider than frame -> cover crops horizontally
    const widthMultiplier = srcAspect / targetRatio;
    maxOffsetX = (widthMultiplier - 1) / (2 * widthMultiplier);
  }

  const deadzone = config.deadzoneRadius ?? DEFAULT_AUTOREFRAME_CONFIG.deadzoneRadius;
  const damping = config.motionDamping ?? DEFAULT_AUTOREFRAME_CONFIG.motionDamping;

  const sortedPoints = [...focalPoints].sort((a, b) => a.timeS - b.timeS);
  const keyframes: AutoReframeKeyframe[] = [];

  let currentSmoothedX = 0;
  let currentTargetX = 0;

  for (let i = 0; i < sortedPoints.length; i++) {
    const pt = sortedPoints[i];

    // Map focalX (0 left to 1 right, 0.5 center) to canvas offset [-maxOffsetX, +maxOffsetX]
    const rawFocalDiff = 0.5 - pt.focalX;
    const desiredOffset = Math.max(-maxOffsetX, Math.min(maxOffsetX, rawFocalDiff * maxOffsetX * 2));

    // Deadzone check: only re-target camera if subject drifts past deadzone threshold
    if (Math.abs(desiredOffset - currentTargetX) > deadzone) {
      currentTargetX = desiredOffset;
    }

    // Exponential moving average filter
    currentSmoothedX = currentSmoothedX * damping + currentTargetX * (1 - damping);

    keyframes.push({
      timeS: Math.round(pt.timeS * 1000) / 1000,
      offsetX: Math.round(currentSmoothedX * 10000) / 10000,
      offsetY: 0,
      scale: 1.0,
    });
  }

  return keyframes;
}

/**
 * Interpolate pan/tilt offset for a specific playback time from trajectory keyframes.
 */
export function getAutoReframeOffset(
  keyframes: AutoReframeKeyframe[],
  timeS: number,
): { offsetX: number; offsetY: number; scale: number } {
  if (!keyframes || keyframes.length === 0) {
    return { offsetX: 0, offsetY: 0, scale: 1 };
  }

  if (timeS <= keyframes[0].timeS) {
    return {
      offsetX: keyframes[0].offsetX,
      offsetY: keyframes[0].offsetY,
      scale: keyframes[0].scale,
    };
  }

  const last = keyframes[keyframes.length - 1];
  if (timeS >= last.timeS) {
    return {
      offsetX: last.offsetX,
      offsetY: last.offsetY,
      scale: last.scale,
    };
  }

  // Binary search for surrounding keyframes
  let low = 0;
  let high = keyframes.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (keyframes[mid].timeS <= timeS) {
      if (mid === keyframes.length - 1 || keyframes[mid + 1].timeS > timeS) {
        const k1 = keyframes[mid];
        const k2 = keyframes[mid + 1];
        const span = k2.timeS - k1.timeS;
        const t = span > 0.0001 ? (timeS - k1.timeS) / span : 0;
        // Smoothstep interpolation
        const smoothT = t * t * (3 - 2 * t);

        return {
          offsetX: k1.offsetX + (k2.offsetX - k1.offsetX) * smoothT,
          offsetY: k1.offsetY + (k2.offsetY - k1.offsetY) * smoothT,
          scale: k1.scale + (k2.scale - k1.scale) * smoothT,
        };
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return { offsetX: 0, offsetY: 0, scale: 1 };
}
