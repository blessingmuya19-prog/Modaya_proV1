/**
 * Smart Zoom & Dynamic Punch-In Keyframing Engine.
 *
 * Provides automated speaker emphasis punch-ins, cinematic slow creeps,
 * rhythmic jump zooms, and smooth keyframe interpolation curves.
 *
 * Fully deterministic, zero-dependency, works on browser Canvas compositing.
 */

export type ZoomEasing = 'instant_cut' | 'linear' | 'ease_in_out' | 'spring' | 'slow_creep';

export type ZoomStyle =
  | 'center_punch'
  | 'slow_creep'
  | 'left_focus'
  | 'right_focus'
  | 'jump_zoom'
  | 'wide_reset';

export interface ZoomKeyframe {
  time: number;          // Timestamp in seconds
  scale: number;         // 1.0 = 100% (normal), 1.25 = 125% zoom
  offsetX: number;       // -0.5..+0.5 normalized canvas offset (0 = center)
  offsetY: number;       // -0.5..+0.5 normalized canvas offset (0 = center)
  easing: ZoomEasing;    // Interpolation curve into this keyframe
  duration?: number;     // Transition duration in seconds (for smooth eases)
}

export interface SmartZoomConfig {
  enabled: boolean;
  intensity: 'subtle' | 'standard' | 'dynamic'; // 1.10x, 1.20x, 1.35x max zoom
  frequency: 'low' | 'medium' | 'high';         // Zooms per minute
  style: ZoomStyle;
  minHoldDuration: number;                      // Minimum hold time in seconds before zoom change (e.g. 1.8s)
  maxHoldDuration: number;                      // Maximum hold time in seconds (e.g. 5.0s)
  respectPunchlines: boolean;                   // Snap punch-in on strong transcript statements
}

export const DEFAULT_SMART_ZOOM_CONFIG: SmartZoomConfig = {
  enabled: true,
  intensity: 'standard',
  frequency: 'medium',
  style: 'center_punch',
  minHoldDuration: 1.8,
  maxHoldDuration: 4.5,
  respectPunchlines: true,
};

export interface TranscriptSentence {
  start: number;
  end: number;
  text: string;
  isPunchline?: boolean;
}

export interface AudioEmphasisPeak {
  time: number;
  energy: number; // 0..1
}

/**
 * Cubic ease in-out interpolation helper.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Spring-like bounce interpolation.
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Calculates current zoom scale and offsets at any given timestamp.
 */
export function getInterpolatedZoom(
  keyframes: ZoomKeyframe[],
  time: number
): { scale: number; offsetX: number; offsetY: number } {
  if (!keyframes || keyframes.length === 0) {
    return { scale: 1.0, offsetX: 0, offsetY: 0 };
  }

  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // Before first keyframe
  if (time <= sorted[0].time) {
    return { scale: sorted[0].scale, offsetX: sorted[0].offsetX, offsetY: sorted[0].offsetY };
  }

  // After last keyframe
  if (time >= sorted[sorted.length - 1].time) {
    const last = sorted[sorted.length - 1];
    return { scale: last.scale, offsetX: last.offsetX, offsetY: last.offsetY };
  }

  // Find surrounding keyframes
  let prev = sorted[0];
  let next = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const span = next.time - prev.time;
  if (span <= 0.001) {
    return { scale: next.scale, offsetX: next.offsetX, offsetY: next.offsetY };
  }

  const transDuration = Math.min(span, next.duration ?? 0.35);
  const timeIntoTransition = time - (next.time - transDuration);

  // If we haven't reached the transition window yet, hold previous keyframe
  if (timeIntoTransition <= 0) {
    return { scale: prev.scale, offsetX: prev.offsetX, offsetY: prev.offsetY };
  }

  let progress = Math.min(1.0, Math.max(0.0, timeIntoTransition / transDuration));

  // Apply easing
  switch (next.easing) {
    case 'instant_cut':
      progress = progress >= 1.0 ? 1.0 : 0.0;
      break;
    case 'ease_in_out':
      progress = easeInOutCubic(progress);
      break;
    case 'spring':
      progress = easeOutBack(progress);
      break;
    case 'slow_creep':
      progress = progress; // Linear constant drift
      break;
    case 'linear':
    default:
      break;
  }

  const scale = prev.scale + (next.scale - prev.scale) * progress;
  const offsetX = prev.offsetX + (next.offsetX - prev.offsetX) * progress;
  const offsetY = prev.offsetY + (next.offsetY - prev.offsetY) * progress;

  return {
    scale: Math.max(1.0, Math.min(2.0, scale)),
    offsetX: Math.max(-0.5, Math.min(0.5, offsetX)),
    offsetY: Math.max(-0.5, Math.min(0.5, offsetY)),
  };
}

/**
 * Automatically generate smart zoom keyframes across video timeline.
 */
export function generateSmartZoomTrack(
  totalDurationSeconds: number,
  sentences: TranscriptSentence[] = [],
  peaks: AudioEmphasisPeak[] = [],
  config: Partial<SmartZoomConfig> = {}
): ZoomKeyframe[] {
  const fullConfig: SmartZoomConfig = {
    ...DEFAULT_SMART_ZOOM_CONFIG,
    ...config,
  };

  if (!fullConfig.enabled || totalDurationSeconds <= 1.0) {
    return [{ time: 0, scale: 1.0, offsetX: 0, offsetY: 0, easing: 'instant_cut' }];
  }

  const zoomScale =
    fullConfig.intensity === 'subtle' ? 1.12 :
    fullConfig.intensity === 'dynamic' ? 1.32 : 1.22;

  const keyframes: ZoomKeyframe[] = [
    { time: 0, scale: 1.0, offsetX: 0, offsetY: 0, easing: 'instant_cut', duration: 0 },
  ];

  let currentTime = 0;
  let isZoomedIn = false;

  // If sentences exist, align punch-ins with sentence boundaries and punchlines
  if (sentences.length > 0) {
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceDuration = sentence.end - sentence.start;
      
      // Check if enough time has elapsed since last zoom change
      if (sentence.start - currentTime >= fullConfig.minHoldDuration) {
        if (sentence.isPunchline || !isZoomedIn) {
          // Punch in
          isZoomedIn = true;
          currentTime = sentence.start;
          keyframes.push({
            time: sentence.start,
            scale: zoomScale,
            offsetX: 0,
            offsetY: -0.05, // Slight upward compensation for speaker headroom
            easing: fullConfig.style === 'jump_zoom' ? 'instant_cut' : 'ease_in_out',
            duration: 0.25,
          });
        } else if (isZoomedIn && sentenceDuration >= fullConfig.minHoldDuration) {
          // Reset to wide shot
          isZoomedIn = false;
          currentTime = sentence.start;
          keyframes.push({
            time: sentence.start,
            scale: 1.0,
            offsetX: 0,
            offsetY: 0,
            easing: 'ease_in_out',
            duration: 0.30,
          });
        }
      }
    }
  } else {
    // Rhythmic cadenced zoom intervals (every 3 to 4 seconds)
    const interval =
      fullConfig.frequency === 'high' ? 2.5 :
      fullConfig.frequency === 'low' ? 5.0 : 3.5;

    let t = interval;
    while (t < totalDurationSeconds) {
      isZoomedIn = !isZoomedIn;
      keyframes.push({
        time: t,
        scale: isZoomedIn ? zoomScale : 1.0,
        offsetX: 0,
        offsetY: isZoomedIn ? -0.04 : 0,
        easing: fullConfig.style === 'jump_zoom' ? 'instant_cut' : 'ease_in_out',
        duration: 0.28,
      });
      t += interval;
    }
  }

  // Ensure keyframes are strictly ordered and non-duplicate
  return keyframes.filter((kf, idx, arr) => {
    return idx === 0 || kf.time > arr[idx - 1].time + 0.05;
  });
}
