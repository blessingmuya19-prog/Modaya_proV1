/**
 * Audio Ducking & Speech Activity Detection Engine.
 *
 * Automatically reduces the volume of secondary audio (background music,
 * ambience, sound effects, B-roll audio) whenever primary dialogue or speech
 * is active, restoring normal level smoothly during pauses.
 *
 * Pure, deterministic, and fully testable without browser DOM dependencies.
 */

export interface SpeechSegment {
  startS: number;
  endS: number;
  confidence?: number;
  text?: string;
}

export interface DuckingOptions {
  /** Ducked volume multiplier between 0 and 1 (default 0.25 ≈ -12dB). */
  duckVolume: number;
  /** Normal / non-ducked volume multiplier (default 1.0 = 0dB). */
  normalVolume: number;
  /** Attack ramp duration in seconds to lower volume before/at speech start (default 0.25s). */
  attackS: number;
  /** Hold duration in seconds to stay ducked after speech segment ends (default 0.20s). */
  holdS: number;
  /** Release ramp duration in seconds to restore normal volume (default 0.60s). */
  releaseS: number;
  /** Minimum speech segment duration in seconds to trigger ducking (default 0.15s). */
  minSpeechS: number;
  /** Minimum gap between speech segments to release ducking (default 0.35s). */
  minGapS: number;
}

export const DEFAULT_DUCKING_OPTIONS: DuckingOptions = {
  duckVolume: 0.25,   // -12 dB
  normalVolume: 1.0,  // 0 dB
  attackS: 0.25,      // 250ms smooth lead-in
  holdS: 0.20,        // 200ms hold after speech
  releaseS: 0.60,     // 600ms release back to music
  minSpeechS: 0.15,
  minGapS: 0.35,
};

/**
 * Merge overlapping or closely adjacent speech segments.
 */
export function mergeSpeechSegments(
  segments: SpeechSegment[],
  minGapS = DEFAULT_DUCKING_OPTIONS.minGapS,
): SpeechSegment[] {
  if (!segments || segments.length === 0) return [];

  const sorted = [...segments]
    .filter(s => s.endS > s.startS && (s.endS - s.startS) >= 0.05)
    .sort((a, b) => a.startS - b.startS);

  if (sorted.length === 0) return [];

  const merged: SpeechSegment[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const prev = merged[merged.length - 1];

    if (current.startS <= prev.endS + minGapS) {
      // Overlap or small gap: merge into previous
      prev.endS = Math.max(prev.endS, current.endS);
      if (current.text && prev.text) {
        prev.text = `${prev.text} ${current.text}`;
      } else if (current.text) {
        prev.text = current.text;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Extract speech segments from a timed transcript.
 */
export function speechSegmentsFromTranscript(
  transcript: { segments?: Array<{ startS: number; endS: number; text?: string }> } | null | undefined,
  minGapS = DEFAULT_DUCKING_OPTIONS.minGapS,
): SpeechSegment[] {
  if (!transcript || !Array.isArray(transcript.segments)) return [];
  const raw: SpeechSegment[] = transcript.segments.map(s => ({
    startS: Number(s.startS) || 0,
    endS: Number(s.endS) || 0,
    text: s.text,
  }));
  return mergeSpeechSegments(raw, minGapS);
}

/**
 * Detect speech segments from raw PCM samples using root-mean-square (RMS)
 * energy windowing with adaptive silence thresholds.
 */
export function detectSpeechFromPcm(
  samples: Float32Array | number[],
  sampleRate: number,
  opts?: {
    thresholdRms?: number;
    windowMs?: number;
    minSpeechMs?: number;
    minSilenceMs?: number;
  },
): SpeechSegment[] {
  if (!samples || samples.length === 0 || sampleRate <= 0) return [];

  const windowMs = opts?.windowMs ?? 30;
  const windowSize = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const minSpeechS = (opts?.minSpeechMs ?? 150) / 1000;
  const minSilenceS = (opts?.minSilenceMs ?? 300) / 1000;

  // Calculate RMS for each window
  const windowCount = Math.floor(samples.length / windowSize);
  if (windowCount === 0) return [];

  const rmsValues = new Float32Array(windowCount);
  let totalEnergy = 0;

  for (let w = 0; w < windowCount; w++) {
    const offset = w * windowSize;
    let sumSquares = 0;
    for (let i = 0; i < windowSize; i++) {
      const sample = samples[offset + i];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    rmsValues[w] = rms;
    totalEnergy += rms;
  }

  const avgEnergy = totalEnergy / windowCount;
  // Dynamic threshold based on average energy, clamped to sensible noise floor
  const threshold = opts?.thresholdRms ?? Math.max(0.015, avgEnergy * 0.4);

  const rawSegments: SpeechSegment[] = [];
  let inSpeech = false;
  let speechStartS = 0;

  for (let w = 0; w < windowCount; w++) {
    const t = (w * windowSize) / sampleRate;
    const isAbove = rmsValues[w] >= threshold;

    if (!inSpeech && isAbove) {
      inSpeech = true;
      speechStartS = t;
    } else if (inSpeech && !isAbove) {
      inSpeech = false;
      const speechEndS = t;
      if (speechEndS - speechStartS >= minSpeechS) {
        rawSegments.push({
          startS: Number(speechStartS.toFixed(3)),
          endS: Number(speechEndS.toFixed(3)),
        });
      }
    }
  }

  if (inSpeech) {
    const endS = (windowCount * windowSize) / sampleRate;
    if (endS - speechStartS >= minSpeechS) {
      rawSegments.push({
        startS: Number(speechStartS.toFixed(3)),
        endS: Number(endS.toFixed(3)),
      });
    }
  }

  return mergeSpeechSegments(rawSegments, minSilenceS);
}

/**
 * Smooth Hermite / S-curve interpolation between 0 and 1.
 */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Calculate the instantaneous ducking gain multiplier [0..1] at timeline time `t`.
 */
export function getDuckingGainAt(
  timeS: number,
  speechSegments: SpeechSegment[],
  opts?: Partial<DuckingOptions>,
): number {
  const cfg: DuckingOptions = { ...DEFAULT_DUCKING_OPTIONS, ...(opts ?? {}) };
  if (!speechSegments || speechSegments.length === 0) {
    return cfg.normalVolume;
  }

  let minGain = cfg.normalVolume;

  for (const seg of speechSegments) {
    const attackStart = Math.max(0, seg.startS - cfg.attackS);
    const attackEnd = seg.startS;
    const holdEnd = seg.endS + cfg.holdS;
    const releaseEnd = holdEnd + cfg.releaseS;

    let segmentGain = cfg.normalVolume;

    if (timeS < attackStart || timeS > releaseEnd) {
      // Outside the influence window of this speech segment
      segmentGain = cfg.normalVolume;
    } else if (timeS >= attackEnd && timeS <= holdEnd) {
      // Inside active speech or hold window -> fully ducked
      segmentGain = cfg.duckVolume;
    } else if (timeS >= attackStart && timeS < attackEnd) {
      // Attack ramp down (from normal to ducked)
      const rampProgress = (timeS - attackStart) / Math.max(0.001, cfg.attackS);
      const eased = smoothstep(rampProgress);
      segmentGain = cfg.normalVolume - (cfg.normalVolume - cfg.duckVolume) * eased;
    } else if (timeS > holdEnd && timeS <= releaseEnd) {
      // Release ramp up (from ducked back to normal)
      const rampProgress = (timeS - holdEnd) / Math.max(0.001, cfg.releaseS);
      const eased = smoothstep(rampProgress);
      segmentGain = cfg.duckVolume + (cfg.normalVolume - cfg.duckVolume) * eased;
    }

    if (segmentGain < minGain) {
      minGain = segmentGain;
    }
  }

  return Number(Math.max(0, Math.min(1, minGain)).toFixed(4));
}

/**
 * Timeline automation keyframe point.
 */
export interface DuckingKeyframe {
  timeS: number;
  gain: number;
  type: 'normal' | 'duck_start' | 'duck_hold' | 'release';
}

/**
 * Generate discrete automation keyframe points for WebAudio or timeline displays.
 */
export function generateDuckingKeyframes(
  speechSegments: SpeechSegment[],
  durationS: number,
  opts?: Partial<DuckingOptions>,
): DuckingKeyframe[] {
  const cfg: DuckingOptions = { ...DEFAULT_DUCKING_OPTIONS, ...(opts ?? {}) };
  const merged = mergeSpeechSegments(speechSegments, cfg.minGapS);

  if (merged.length === 0 || durationS <= 0) {
    return [
      { timeS: 0, gain: cfg.normalVolume, type: 'normal' },
      { timeS: durationS, gain: cfg.normalVolume, type: 'normal' },
    ];
  }

  const rawPoints: DuckingKeyframe[] = [];

  for (const seg of merged) {
    const attackStart = Math.max(0, seg.startS - cfg.attackS);
    const attackEnd   = Math.max(0, seg.startS);
    const holdEnd     = Math.min(durationS, seg.endS + cfg.holdS);
    const releaseEnd  = Math.min(durationS, holdEnd + cfg.releaseS);

    rawPoints.push({ timeS: attackStart, gain: cfg.normalVolume, type: 'normal' });
    rawPoints.push({ timeS: attackEnd,   gain: cfg.duckVolume,   type: 'duck_start' });
    rawPoints.push({ timeS: holdEnd,     gain: cfg.duckVolume,   type: 'duck_hold' });
    rawPoints.push({ timeS: releaseEnd,  gain: cfg.normalVolume, type: 'release' });
  }

  // Sort by timestamp and deduplicate overlapping points
  rawPoints.sort((a, b) => a.timeS - b.timeS);

  const clean: DuckingKeyframe[] = [];
  for (const pt of rawPoints) {
    if (pt.timeS < 0 || pt.timeS > durationS) continue;
    const last = clean[clean.length - 1];
    if (last && Math.abs(last.timeS - pt.timeS) < 0.01) {
      // Keep lower gain if simultaneous
      if (pt.gain < last.gain) {
        clean[clean.length - 1] = pt;
      }
    } else {
      clean.push(pt);
    }
  }

  if (clean.length === 0 || clean[0].timeS > 0.01) {
    clean.unshift({ timeS: 0, gain: cfg.normalVolume, type: 'normal' });
  }
  if (clean[clean.length - 1].timeS < durationS - 0.01) {
    clean.push({ timeS: durationS, gain: cfg.normalVolume, type: 'normal' });
  }

  return clean;
}

/**
 * Apply ducking attenuation to a secondary PCM audio channel in-place.
 */
export function applyDuckingToPcmBuffer(
  secondaryPcm: Float32Array,
  sampleRate: number,
  speechSegments: SpeechSegment[],
  opts?: Partial<DuckingOptions>,
): Float32Array {
  const out = new Float32Array(secondaryPcm.length);
  const cfg = { ...DEFAULT_DUCKING_OPTIONS, ...(opts ?? {}) };
  const merged = mergeSpeechSegments(speechSegments, cfg.minGapS);

  if (merged.length === 0) {
    for (let i = 0; i < secondaryPcm.length; i++) {
      out[i] = secondaryPcm[i] * cfg.normalVolume;
    }
    return out;
  }

  const dt = 1 / sampleRate;
  for (let i = 0; i < secondaryPcm.length; i++) {
    const t = i * dt;
    const gain = getDuckingGainAt(t, merged, cfg);
    out[i] = secondaryPcm[i] * gain;
  }

  return out;
}
