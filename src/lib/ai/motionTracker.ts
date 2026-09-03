/**
 * Motion Tracking & Dynamic Subject Anchoring Engine.
 *
 * Tracks the trajectory of on-screen visual subjects across time and
 * dynamically anchors text overlays, callouts, emojis, and stickers to
 * follow the moving target with configurable damping and smoothing.
 *
 * Pure, deterministic, and fully testable.
 */

export interface TrackPoint {
  tS: number;          // Timeline timestamp in seconds
  x: number;           // Normalized coordinate 0..1 (0 = left, 1 = right)
  y: number;           // Normalized coordinate 0..1 (0 = top, 1 = bottom)
  scale?: number;      // Scale multiplier (e.g. for zoom/depth)
  rotation?: number;   // Degrees
  confidence?: number; // 0..1 tracking quality score
}

export type TrackingMode = 'smooth_follow' | 'rigid_lock' | 'elastic_spring';

export interface MotionTrackConfig {
  enabled: boolean;
  targetName?: string;
  mode: TrackingMode;
  anchorOffset: { x: number; y: number }; // Normalized offset from target point
  smoothRadiusS: number;                 // Smoothing window in seconds (e.g. 0.2s)
  points: TrackPoint[];
}

export const DEFAULT_MOTION_TRACK: MotionTrackConfig = {
  enabled: false,
  targetName: 'Tracked Subject',
  mode: 'smooth_follow',
  anchorOffset: { x: 0, y: -0.08 }, // Hover slightly above subject by default
  smoothRadiusS: 0.20,
  points: [],
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Catmull-Rom spline interpolation between 4 points for smooth trajectory curves.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Get tracked coordinate (x, y) at timeline time `t`.
 */
export function getTrackedPositionAt(
  timeS: number,
  track: MotionTrackConfig,
): { x: number; y: number; scale: number; rotation: number } {
  if (!track || !track.points || track.points.length === 0) {
    return {
      x: 0.5 + track.anchorOffset.x,
      y: 0.5 + track.anchorOffset.y,
      scale: 1,
      rotation: 0,
    };
  }

  const pts = track.points;
  if (pts.length === 1) {
    return {
      x: clamp(pts[0].x + track.anchorOffset.x, 0, 1),
      y: clamp(pts[0].y + track.anchorOffset.y, 0, 1),
      scale: pts[0].scale ?? 1,
      rotation: pts[0].rotation ?? 0,
    };
  }

  // Clamped bounds before first point or after last point
  if (timeS <= pts[0].tS) {
    return {
      x: clamp(pts[0].x + track.anchorOffset.x, 0, 1),
      y: clamp(pts[0].y + track.anchorOffset.y, 0, 1),
      scale: pts[0].scale ?? 1,
      rotation: pts[0].rotation ?? 0,
    };
  }
  if (timeS >= pts[pts.length - 1].tS) {
    const last = pts[pts.length - 1];
    return {
      x: clamp(last.x + track.anchorOffset.x, 0, 1),
      y: clamp(last.y + track.anchorOffset.y, 0, 1),
      scale: last.scale ?? 1,
      rotation: last.rotation ?? 0,
    };
  }

  // Find surrounding segment
  let idx = 0;
  while (idx < pts.length - 1 && pts[idx + 1].tS < timeS) {
    idx++;
  }

  const p1 = pts[idx];
  const p2 = pts[idx + 1];
  const p0 = pts[Math.max(0, idx - 1)];
  const p3 = pts[Math.min(pts.length - 1, idx + 2)];

  const span = Math.max(0.001, p2.tS - p1.tS);
  const frac = clamp((timeS - p1.tS) / span, 0, 1);

  let rawX: number, rawY: number;

  if (track.mode === 'rigid_lock') {
    // Linear interpolation without curve overshoot
    rawX = p1.x + (p2.x - p1.x) * frac;
    rawY = p1.y + (p2.y - p1.y) * frac;
  } else {
    // Smooth Catmull-Rom spline for organic fluid motion
    rawX = catmullRom(p0.x, p1.x, p2.x, p3.x, frac);
    rawY = catmullRom(p0.y, p1.y, p2.y, p3.y, frac);
  }

  const rawScale = (p1.scale ?? 1) + ((p2.scale ?? 1) - (p1.scale ?? 1)) * frac;
  const rawRot   = (p1.rotation ?? 0) + ((p2.rotation ?? 0) - (p1.rotation ?? 0)) * frac;

  return {
    x: clamp(rawX + track.anchorOffset.x, 0, 1),
    y: clamp(rawY + track.anchorOffset.y, 0, 1),
    scale: Math.max(0.2, Math.min(3, rawScale)),
    rotation: Number(rawRot.toFixed(2)),
  };
}

/**
 * Smooth a sequence of raw track points using an Exponential Moving Average (EMA)
 * filter to eliminate high-frequency video jitter.
 */
export function smoothTrackPoints(
  points: TrackPoint[],
  smoothingFactor = 0.35, // 0 = maximum smoothing, 1 = raw
): TrackPoint[] {
  if (!points || points.length <= 1) return points ? [...points] : [];

  const alpha = clamp(smoothingFactor, 0.05, 1.0);
  const smoothed: TrackPoint[] = [{ ...points[0] }];

  let prevX = points[0].x;
  let prevY = points[0].y;
  let prevScale = points[0].scale ?? 1;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const newX = prevX + alpha * (pt.x - prevX);
    const newY = prevY + alpha * (pt.y - prevY);
    const newScale = prevScale + alpha * ((pt.scale ?? 1) - prevScale);

    smoothed.push({
      tS: pt.tS,
      x: Number(newX.toFixed(4)),
      y: Number(newY.toFixed(4)),
      scale: Number(newScale.toFixed(3)),
      rotation: pt.rotation,
      confidence: pt.confidence,
    });

    prevX = newX;
    prevY = newY;
    prevScale = newScale;
  }

  return smoothed;
}

/**
 * 2D Block matching / Optical patch tracker on consecutive video frame data.
 */
export function trackPatchMovement(
  frameA: Uint8ClampedArray | ArrayLike<number>,
  frameB: Uint8ClampedArray | ArrayLike<number>,
  width: number,
  height: number,
  currentX: number, // Normalized 0..1
  currentY: number, // Normalized 0..1
  searchRadiusPx = 16,
  patchSizePx = 12,
): { deltaX: number; deltaY: number; score: number } {
  const cx = Math.floor(currentX * width);
  const cy = Math.floor(currentY * height);

  const halfPatch = Math.floor(patchSizePx / 2);
  let bestDx = 0;
  let bestDy = 0;
  let minDiff = Infinity;

  for (let dy = -searchRadiusPx; dy <= searchRadiusPx; dy += 2) {
    for (let dx = -searchRadiusPx; dx <= searchRadiusPx; dx += 2) {
      let diff = 0;
      let count = 0;

      for (let py = -halfPatch; py <= halfPatch; py += 2) {
        for (let px = -halfPatch; px <= halfPatch; px += 2) {
          const ax = cx + px;
          const ay = cy + py;
          const bx = cx + px + dx;
          const by = cy + py + dy;

          if (ax >= 0 && ax < width && ay >= 0 && ay < height &&
              bx >= 0 && bx < width && by >= 0 && by < height) {
            const idxA = (ay * width + ax) * 4;
            const idxB = (by * width + bx) * 4;

            // Luma difference
            const lumaA = 0.299 * frameA[idxA] + 0.587 * frameA[idxA + 1] + 0.114 * frameA[idxA + 2];
            const lumaB = 0.299 * frameB[idxB] + 0.587 * frameB[idxB + 1] + 0.114 * frameB[idxB + 2];
            diff += Math.abs(lumaA - lumaB);
            count++;
          }
        }
      }

      if (count > 0) {
        const avgDiff = diff / count;
        if (avgDiff < minDiff) {
          minDiff = avgDiff;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
  }

  const normDx = width > 0 ? bestDx / width : 0;
  const normDy = height > 0 ? bestDy / height : 0;
  const score = Math.max(0, 1 - (minDiff / 128));

  return {
    deltaX: Number(normDx.toFixed(4)),
    deltaY: Number(normDy.toFixed(4)),
    score: Number(score.toFixed(3)),
  };
}

/**
 * Generate synthetic or simulated trajectory points for a named subject motion pattern.
 */
export function generateSubjectMotionTrack(
  pattern: 'center_subject' | 'left_to_right' | 'subtle_drift' | 'floating_tag' | 'head_level',
  startS: number,
  endS: number,
  stepS = 0.2,
): MotionTrackConfig {
  const points: TrackPoint[] = [];
  const duration = Math.max(0.1, endS - startS);

  for (let t = startS; t <= endS + 0.001; t += stepS) {
    const progress = clamp((t - startS) / duration, 0, 1);
    let x = 0.5;
    let y = 0.5;
    let scale = 1.0;

    if (pattern === 'center_subject') {
      x = 0.50 + 0.04 * Math.sin(progress * Math.PI * 2);
      y = 0.40 + 0.02 * Math.cos(progress * Math.PI * 2);
    } else if (pattern === 'left_to_right') {
      x = 0.30 + 0.40 * progress;
      y = 0.45 + 0.05 * Math.sin(progress * Math.PI * 4);
    } else if (pattern === 'subtle_drift') {
      x = 0.50 + 0.06 * Math.sin(progress * 3.5);
      y = 0.42 + 0.04 * Math.cos(progress * 2.8);
    } else if (pattern === 'floating_tag') {
      x = 0.50 + 0.08 * Math.sin(progress * 4.0);
      y = 0.35 + 0.03 * Math.cos(progress * 5.0);
      scale = 1.0 + 0.08 * Math.sin(progress * Math.PI * 2);
    } else if (pattern === 'head_level') {
      x = 0.50 + 0.03 * Math.sin(progress * Math.PI * 3);
      y = 0.28 + 0.015 * Math.cos(progress * Math.PI * 2);
    }

    points.push({
      tS: Number(t.toFixed(3)),
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      scale: Number(scale.toFixed(3)),
      confidence: 0.95,
    });
  }

  return {
    enabled: true,
    targetName: pattern.replace(/_/g, ' '),
    mode: 'smooth_follow',
    anchorOffset: { x: 0, y: -0.06 },
    smoothRadiusS: 0.20,
    points: smoothTrackPoints(points, 0.4),
  };
}
