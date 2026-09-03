/**
 * Multi-Speaker Diarization & Automated Speaker Level Rebalancing Engine.
 *
 * Identifies distinct speakers across a recording (who spoke when) via
 * acoustic pitch/energy analysis and conversational turn heuristics, and
 * automatically balances audio levels so quiet and loud speakers sound
 * uniform and broadcast-ready.
 *
 * Pure, deterministic, and fully testable.
 */

import type { StoredTranscriptSegment } from '../mediaDb';

export interface DiarizedUtterance {
  id: string;
  startS: number;
  endS: number;
  text: string;
  speakerId: string;
  speakerLabel: string;
  rms: number;
  pitchHz?: number;
  gainDb: number;
  gainMultiplier: number;
}

export interface SpeakerStats {
  id: string;
  label: string;
  color: string;
  totalTimeS: number;
  utteranceCount: number;
  percentage: number;
  averageRms: number;
  estimatedPitchHz?: number;
  targetGainDb: number;
  gainMultiplier: number;
}

export interface DiarizationResult {
  utterances: DiarizedUtterance[];
  speakers: SpeakerStats[];
  balanceApplied: boolean;
  targetRms: number;
}

export interface DiarizationOptions {
  /** Maximum number of distinct speakers to detect (default 4). */
  maxSpeakers?: number;
  /** Target RMS level for speech normalization (default 0.16 ≈ -16 LUFS dialogue standard). */
  targetRms?: number;
  /** Maximum gain boost in dB to prevent amplifying floor noise (default +6.0 dB). */
  maxBoostDb?: number;
  /** Maximum attenuation in dB for excessively loud speakers (default -9.0 dB). */
  maxAttenDb?: number;
  /** Minimum pause between turns to split speaker segments (default 0.4s). */
  minTurnPauseS?: number;
}

const SPEAKER_PALETTE = [
  '#38BDF8', // Sky blue - Speaker 1 / Host
  '#F472B6', // Pink - Speaker 2 / Guest 1
  '#34D399', // Emerald - Speaker 3 / Guest 2
  '#FBBF24', // Amber - Speaker 4 / Guest 3
  '#A78BFA', // Purple - Speaker 5
  '#FB7185', // Rose - Speaker 6
];

const DEFAULT_OPTIONS: Required<DiarizationOptions> = {
  maxSpeakers: 4,
  targetRms: 0.16,
  maxBoostDb: 6.0,
  maxAttenDb: -9.0,
  minTurnPauseS: 0.4,
};

/**
 * Estimate fundamental pitch ($F_0$ in Hz) and RMS energy from a slice of PCM samples.
 */
export function estimatePitchAndRms(
  samples: Float32Array | number[],
  sampleRate: number,
): { pitchHz: number | null; rms: number } {
  if (!samples || samples.length === 0 || sampleRate <= 0) {
    return { pitchHz: null, rms: 0 };
  }

  // Calculate RMS
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);

  // If too quiet, pitch is unreliable
  if (rms < 0.01) {
    return { pitchHz: null, rms: Number(rms.toFixed(4)) };
  }

  // Autocorrelation pitch estimation within human vocal range (80 Hz to 350 Hz)
  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 80);
  const windowLen = Math.min(samples.length - maxLag, Math.floor(sampleRate * 0.05)); // 50ms window

  if (windowLen <= 0) {
    return { pitchHz: null, rms: Number(rms.toFixed(4)) };
  }

  let bestLag = -1;
  let maxCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < windowLen; i++) {
      corr += samples[i] * samples[i + lag];
    }
    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }

  const pitchHz = bestLag > 0 ? sampleRate / bestLag : null;
  return {
    pitchHz: pitchHz ? Math.round(pitchHz) : null,
    rms: Number(rms.toFixed(4)),
  };
}

/**
 * Convert decibels to a linear gain factor.
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert a linear amplitude factor to decibels (dB).
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -100;
  return 20 * Math.log10(linear);
}

/**
 * Diarize transcript segments into speakers using conversational turn heuristics
 * and acoustic measurements if audio samples are available.
 */
export function diarizeTranscript(
  segments: StoredTranscriptSegment[],
  pcmSamples?: Float32Array,
  sampleRate = 16000,
  options?: DiarizationOptions,
): DiarizationResult {
  const opts = { ...DEFAULT_OPTIONS, ...(options ?? {}) };

  if (!segments || segments.length === 0) {
    return {
      utterances: [],
      speakers: [],
      balanceApplied: false,
      targetRms: opts.targetRms,
    };
  }

  // Analyze each segment's acoustics and turn timing
  const measuredSegments = segments.map((seg, idx) => {
    let rms = seg.rms ?? 0.15;
    let pitchHz: number | null = null;

    if (pcmSamples && sampleRate > 0) {
      const startSample = Math.max(0, Math.floor(seg.startS * sampleRate));
      const endSample = Math.min(pcmSamples.length, Math.ceil(seg.endS * sampleRate));
      if (endSample > startSample) {
        const slice = pcmSamples.subarray(startSample, endSample);
        const ac = estimatePitchAndRms(slice, sampleRate);
        rms = ac.rms || rms;
        pitchHz = ac.pitchHz;
      }
    }

    const prevSeg = idx > 0 ? segments[idx - 1] : null;
    const gapFromPrev = prevSeg ? seg.startS - prevSeg.endS : 0;
    const isQuestion = /\?$/.test(seg.text.trim());
    const prevWasQuestion = prevSeg ? /\?$/.test(prevSeg.text.trim()) : false;

    return {
      seg,
      rms,
      pitchHz,
      gapFromPrev,
      isQuestion,
      prevWasQuestion,
    };
  });

  // Determine speaker assignments
  // Priority: 1. Existing segment.speaker if specified
  //           2. Acoustic clustering (pitch & rms differences)
  //           3. Turn-taking / pause alternation heuristics

  let currentSpeakerIdx = 0;
  const numSpeakers = Math.max(1, Math.min(opts.maxSpeakers, 4));

  const assigned = measuredSegments.map((m, idx) => {
    if (m.seg.speakerId) {
      return { ...m, speakerIdx: parseInt(m.seg.speakerId.replace(/\D/g, ''), 10) - 1 || 0 };
    }

    if (idx === 0) {
      return { ...m, speakerIdx: 0 };
    }

    const prev = measuredSegments[idx - 1];

    // Speaker change indicators:
    // a) Significant pitch difference (> 35 Hz) if pitch is detected on both
    const pitchJump = m.pitchHz && prev.pitchHz && Math.abs(m.pitchHz - prev.pitchHz) > 35;
    // b) Previous was question and notable gap exists (> 0.3s)
    const qaTurn = prev.prevWasQuestion || (prev.isQuestion && m.gapFromPrev > 0.25);
    // c) Noticeable speech pause (> minTurnPauseS) and substantial energy shift
    const pauseTurn = m.gapFromPrev >= opts.minTurnPauseS && Math.abs(m.rms - prev.rms) > 0.04;

    if ((pitchJump || qaTurn || pauseTurn) && numSpeakers > 1) {
      currentSpeakerIdx = (currentSpeakerIdx + 1) % numSpeakers;
    }

    return {
      ...m,
      speakerIdx: currentSpeakerIdx,
    };
  });

  // Aggregate speaker statistics
  const speakerMap = new Map<number, {
    totalTimeS: number;
    count: number;
    sumRms: number;
    sumPitch: number;
    pitchCount: number;
  }>();

  for (const a of assigned) {
    const dur = Math.max(0.1, a.seg.endS - a.seg.startS);
    const existing = speakerMap.get(a.speakerIdx) ?? {
      totalTimeS: 0, count: 0, sumRms: 0, sumPitch: 0, pitchCount: 0,
    };
    existing.totalTimeS += dur;
    existing.count += 1;
    existing.sumRms += a.rms * dur;
    if (a.pitchHz) {
      existing.sumPitch += a.pitchHz;
      existing.pitchCount += 1;
    }
    speakerMap.set(a.speakerIdx, existing);
  }

  const totalDurationAll = Array.from(speakerMap.values()).reduce((sum, s) => sum + s.totalTimeS, 0) || 1;

  // Build SpeakerStats with rebalancing gains
  const speakers: SpeakerStats[] = [];

  for (const [idx, s] of Array.from(speakerMap.entries()).sort((a, b) => a[0] - b[0])) {
    const id = `speaker-${idx + 1}`;
    const label = idx === 0 ? 'Speaker 1 (Host)' : `Speaker ${idx + 1}`;
    const color = SPEAKER_PALETTE[idx % SPEAKER_PALETTE.length];
    const avgRms = s.totalTimeS > 0 ? s.sumRms / s.totalTimeS : opts.targetRms;
    const avgPitch = s.pitchCount > 0 ? Math.round(s.sumPitch / s.pitchCount) : undefined;

    // Calculate level rebalancing gain to bring avgRms to targetRms
    const rawGainRatio = avgRms > 0.01 ? opts.targetRms / avgRms : 1.0;
    const rawDb = linearToDb(rawGainRatio);
    // Clamp to allowable boost / attenuation limits
    const clampedDb = Math.max(opts.maxAttenDb, Math.min(opts.maxBoostDb, rawDb));
    const gainMultiplier = Number(dbToLinear(clampedDb).toFixed(3));

    speakers.push({
      id,
      label,
      color,
      totalTimeS: Number(s.totalTimeS.toFixed(2)),
      utteranceCount: s.count,
      percentage: Math.round((s.totalTimeS / totalDurationAll) * 100),
      averageRms: Number(avgRms.toFixed(4)),
      estimatedPitchHz: avgPitch,
      targetGainDb: Number(clampedDb.toFixed(1)),
      gainMultiplier,
    });
  }

  // Format utterances
  const utterances: DiarizedUtterance[] = assigned.map((a, i) => {
    const spk = speakers.find(s => s.id === `speaker-${a.speakerIdx + 1}`) ?? speakers[0];
    return {
      id: `utt-${i}`,
      startS: Number(a.seg.startS.toFixed(3)),
      endS: Number(a.seg.endS.toFixed(3)),
      text: a.seg.text,
      speakerId: spk.id,
      speakerLabel: spk.label,
      rms: a.rms,
      pitchHz: a.pitchHz ?? undefined,
      gainDb: spk.targetGainDb,
      gainMultiplier: spk.gainMultiplier,
    };
  });

  return {
    utterances,
    speakers,
    balanceApplied: true,
    targetRms: opts.targetRms,
  };
}

/**
 * Get the speaker rebalanced volume multiplier at timeline time `t`.
 */
export function getSpeakerGainAt(
  timeS: number,
  diarization: DiarizationResult,
): number {
  if (!diarization || !diarization.balanceApplied || diarization.utterances.length === 0) {
    return 1.0;
  }

  // Find utterance covering time t
  const hit = diarization.utterances.find(u => timeS >= u.startS - 0.1 && timeS <= u.endS + 0.1);
  if (hit) {
    return hit.gainMultiplier;
  }

  return 1.0;
}

/**
 * Apply speaker loudness rebalancing to a PCM audio buffer in-place.
 */
export function applySpeakerRebalanceToPcm(
  samples: Float32Array,
  sampleRate: number,
  diarization: DiarizationResult,
): Float32Array {
  const out = new Float32Array(samples.length);
  if (!diarization || !diarization.balanceApplied || diarization.utterances.length === 0) {
    out.set(samples);
    return out;
  }

  out.set(samples);

  for (const utt of diarization.utterances) {
    const startIdx = Math.max(0, Math.floor(utt.startS * sampleRate));
    const endIdx = Math.min(samples.length, Math.ceil(utt.endS * sampleRate));
    const gain = utt.gainMultiplier;

    if (Math.abs(gain - 1.0) > 0.01) {
      for (let i = startIdx; i < endIdx; i++) {
        out[i] = Math.max(-0.999, Math.min(0.999, out[i] * gain));
      }
    }
  }

  return out;
}
