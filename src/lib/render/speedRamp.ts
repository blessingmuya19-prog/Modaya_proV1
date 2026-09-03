/**
 * Video Speed Ramping & Variable Time-Remapping Engine.
 *
 * Provides non-linear speed curves, dynamic time remapping (converting between
 * source media time and timeline output time), and action/montage presets.
 *
 * Fully deterministic, zero-dependency, works on browser Canvas & audio playback.
 */

export interface SpeedKeyframe {
  sourceTime: number;    // Source video timestamp in seconds
  speed: number;         // 0.25..8.0 (1.0 = normal 100% speed)
  transitionS?: number;  // Transition smoothing duration in seconds
}

export interface SpeedRampProfile {
  id: string;
  name: string;
  description: string;
  keyframes: SpeedKeyframe[];
}

export const SPEED_RAMP_PRESETS: Record<string, (durationS: number) => SpeedKeyframe[]> = {
  montage_whip: (dur: number) => [
    { sourceTime: 0, speed: 2.5, transitionS: 0 },
    { sourceTime: dur * 0.35, speed: 0.5, transitionS: 0.4 },
    { sourceTime: dur * 0.65, speed: 0.5, transitionS: 0.4 },
    { sourceTime: dur, speed: 2.5, transitionS: 0.4 },
  ],
  action_hit: (dur: number) => [
    { sourceTime: 0, speed: 1.0, transitionS: 0 },
    { sourceTime: dur * 0.45, speed: 0.35, transitionS: 0.2 },
    { sourceTime: dur * 0.60, speed: 1.5, transitionS: 0.3 },
    { sourceTime: dur, speed: 1.0, transitionS: 0.3 },
  ],
  hyperlapse: (_dur: number) => [
    { sourceTime: 0, speed: 4.0, transitionS: 0 },
  ],
  slow_cinematic: (_dur: number) => [
    { sourceTime: 0, speed: 0.5, transitionS: 0 },
  ],
};

/**
 * Get the instantaneous playback speed at any given source media timestamp.
 */
export function getSpeedAtSourceTime(keyframes: SpeedKeyframe[], sourceTime: number): number {
  if (!keyframes?.length) return 1.0;
  if (keyframes.length === 1) return Math.max(0.1, Math.min(16.0, keyframes[0].speed));

  const sorted = [...keyframes].sort((a, b) => a.sourceTime - b.sourceTime);

  if (sourceTime <= sorted[0].sourceTime) return sorted[0].speed;
  if (sourceTime >= sorted[sorted.length - 1].sourceTime) {
    return sorted[sorted.length - 1].speed;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const kf0 = sorted[i];
    const kf1 = sorted[i + 1];

    if (sourceTime >= kf0.sourceTime && sourceTime <= kf1.sourceTime) {
      const span = kf1.sourceTime - kf0.sourceTime;
      if (span <= 0.001) return kf1.speed;
      const progress = (sourceTime - kf0.sourceTime) / span;
      // Smooth cosine interpolation
      const smoothProgress = (1 - Math.cos(progress * Math.PI)) / 2;
      return kf0.speed + (kf1.speed - kf0.speed) * smoothProgress;
    }
  }

  return 1.0;
}

/**
 * Calculate the total output duration when speed ramping is applied to a source range.
 */
export function calculateRemappedDuration(
  keyframes: SpeedKeyframe[],
  sourceStartS: number,
  sourceEndS: number,
  steps = 100
): number {
  const duration = Math.max(0, sourceEndS - sourceStartS);
  if (duration <= 0) return 0;
  if (!keyframes?.length) return duration;

  const dt = duration / steps;
  let totalOutputDuration = 0;

  for (let i = 0; i < steps; i++) {
    const t = sourceStartS + (i + 0.5) * dt;
    const speed = Math.max(0.1, getSpeedAtSourceTime(keyframes, t));
    totalOutputDuration += dt / speed;
  }

  return parseFloat(totalOutputDuration.toFixed(4));
}

/**
 * Maps an output timeline time into the corresponding source video timestamp.
 */
export function mapOutputTimeToSourceTime(
  keyframes: SpeedKeyframe[],
  outputTimeS: number,
  sourceStartS: number,
  sourceEndS: number,
  steps = 200
): number {
  if (outputTimeS <= 0) return sourceStartS;
  const duration = Math.max(0, sourceEndS - sourceStartS);
  if (duration <= 0) return sourceStartS;

  const dt = duration / steps;
  let accumulatedOutputTime = 0;

  for (let i = 0; i < steps; i++) {
    const t = sourceStartS + i * dt;
    const speed = Math.max(0.1, getSpeedAtSourceTime(keyframes, t));
    const stepOutputDuration = dt / speed;

    if (accumulatedOutputTime + stepOutputDuration >= outputTimeS) {
      const remaining = outputTimeS - accumulatedOutputTime;
      const fraction = remaining / stepOutputDuration;
      return parseFloat((t + fraction * dt).toFixed(4));
    }
    accumulatedOutputTime += stepOutputDuration;
  }

  return sourceEndS;
}
