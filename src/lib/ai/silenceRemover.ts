/**
 * Auto-Silence & Filler-Word Remover Engine.
 *
 * Provides automated dead-air silence removal, filler word pruning
 * ("um", "uh", "like", "you know"), and ripple-cut timeline generation
 * with natural speech padding and anti-click micro-fades.
 *
 * Fully deterministic, zero-dependency, works on audio envelopes & transcripts.
 */

export interface SilenceRemoverConfig {
  silenceThresholdDb: number;     // e.g. -38 dB
  minSilenceDurationS: number;    // Minimum pause length to cut (e.g. 0.35s)
  speechPaddingS: number;         // Breath margin around words (e.g. 0.08s)
  removeFillerWords: boolean;     // Strip filler words from transcript
  fillerWordList: string[];       // Target filler words
  preserveDramaticPauses: boolean;// Keep longer deliberate pauses (> 2.5s) if marked
}

export const DEFAULT_SILENCE_CONFIG: SilenceRemoverConfig = {
  silenceThresholdDb: -38,
  minSilenceDurationS: 0.35,
  speechPaddingS: 0.08,
  removeFillerWords: true,
  fillerWordList: [
    'um', 'uh', 'er', 'ah', 'umm', 'uhh',
    'like', 'you know', 'i mean', 'so yeah', 'basically',
  ],
  preserveDramaticPauses: false,
};

export interface AudioEnvelopeData {
  rms: number[];      // Normalized 0..1 RMS values
  hopS: number;       // Time step per RMS point (e.g. 0.05s)
}

export interface TranscriptWordItem {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface CutInterval {
  start: number;
  end: number;
  duration: number;
  reason: 'silence' | 'filler_word';
  text?: string;
}

export interface SpeechSegment {
  sourceIn: number;
  sourceOut: number;
  duration: number;
  timelineStart: number;
  timelineEnd: number;
}

export interface SilenceRemovalResult {
  segmentsToKeep: SpeechSegment[];
  cutsToRemove: CutInterval[];
  originalDurationS: number;
  editedDurationS: number;
  timeSavedS: number;
  percentShortened: number;
}

/**
 * Detect silent intervals from RMS audio envelope data.
 */
export function detectSilenceIntervals(
  envelope: AudioEnvelopeData,
  totalDurationS: number,
  config: Partial<SilenceRemoverConfig> = {}
): CutInterval[] {
  const fullConfig = { ...DEFAULT_SILENCE_CONFIG, ...config };
  if (!envelope?.rms?.length) return [];

  const thresholdLinear = Math.pow(10, fullConfig.silenceThresholdDb / 20);
  const hopS = envelope.hopS || 0.05;
  const cuts: CutInterval[] = [];

  let inSilence = false;
  let silenceStart = 0;

  for (let i = 0; i < envelope.rms.length; i++) {
    const isSilent = envelope.rms[i] < thresholdLinear;
    const t = i * hopS;

    if (isSilent && !inSilence) {
      inSilence = true;
      silenceStart = t;
    } else if (!isSilent && inSilence) {
      inSilence = false;
      const rawDur = t - silenceStart;
      // Add speech padding margin
      const paddedStart = Math.min(totalDurationS, silenceStart + fullConfig.speechPaddingS);
      const paddedEnd = Math.max(0, t - fullConfig.speechPaddingS);
      const effectiveDur = paddedEnd - paddedStart;

      if (effectiveDur >= fullConfig.minSilenceDurationS) {
        cuts.push({
          start: parseFloat(paddedStart.toFixed(3)),
          end: parseFloat(paddedEnd.toFixed(3)),
          duration: parseFloat(effectiveDur.toFixed(3)),
          reason: 'silence',
        });
      }
    }
  }

  // Handle trailing silence
  if (inSilence) {
    const paddedStart = Math.min(totalDurationS, silenceStart + fullConfig.speechPaddingS);
    const effectiveDur = totalDurationS - paddedStart;
    if (effectiveDur >= fullConfig.minSilenceDurationS) {
      cuts.push({
        start: parseFloat(paddedStart.toFixed(3)),
        end: parseFloat(totalDurationS.toFixed(3)),
        duration: parseFloat(effectiveDur.toFixed(3)),
        reason: 'silence',
      });
    }
  }

  return cuts;
}

/**
 * Detect filler word intervals from timestamped transcript words.
 */
export function detectFillerWordIntervals(
  words: TranscriptWordItem[],
  config: Partial<SilenceRemoverConfig> = {}
): CutInterval[] {
  const fullConfig = { ...DEFAULT_SILENCE_CONFIG, ...config };
  if (!fullConfig.removeFillerWords || !words?.length) return [];

  const fillerSet = new Set(fullConfig.fillerWordList.map(w => w.toLowerCase()));
  const cuts: CutInterval[] = [];

  for (let i = 0; i < words.length; i++) {
    const item = words[i];
    const clean = item.word.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

    if (clean && fillerSet.has(clean)) {
      const dur = item.end - item.start;
      if (dur > 0.05) {
        cuts.push({
          start: parseFloat(item.start.toFixed(3)),
          end: parseFloat(item.end.toFixed(3)),
          duration: parseFloat(dur.toFixed(3)),
          reason: 'filler_word',
          text: item.word,
        });
      }
    }
  }

  return cuts;
}

/**
 * Merge overlapping and contiguous cut intervals.
 */
export function mergeCutIntervals(cuts: CutInterval[]): CutInterval[] {
  if (cuts.length <= 1) return cuts;

  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const merged: CutInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = merged[merged.length - 1];

    if (cur.start <= prev.end + 0.05) {
      // Overlapping or touching — merge
      prev.end = Math.max(prev.end, cur.end);
      prev.duration = parseFloat((prev.end - prev.start).toFixed(3));
      if (cur.reason === 'filler_word' && prev.reason !== 'filler_word') {
        prev.reason = 'filler_word';
      }
    } else {
      merged.push(cur);
    }
  }

  return merged;
}

/**
 * Compute ripple-cut speech segments by cutting away silences & filler words.
 */
export function generateTightenedTimeline(
  totalDurationS: number,
  envelope?: AudioEnvelopeData,
  words?: TranscriptWordItem[],
  config: Partial<SilenceRemoverConfig> = {}
): SilenceRemovalResult {
  const silenceCuts = envelope ? detectSilenceIntervals(envelope, totalDurationS, config) : [];
  const fillerCuts = words ? detectFillerWordIntervals(words, config) : [];
  const allCuts = mergeCutIntervals([...silenceCuts, ...fillerCuts]);

  const segmentsToKeep: SpeechSegment[] = [];
  let curSourceIn = 0;
  let timelineCursor = 0;

  for (let i = 0; i < allCuts.length; i++) {
    const cut = allCuts[i];
    if (cut.start > curSourceIn + 0.08) {
      const segDuration = cut.start - curSourceIn;
      segmentsToKeep.push({
        sourceIn: parseFloat(curSourceIn.toFixed(3)),
        sourceOut: parseFloat(cut.start.toFixed(3)),
        duration: parseFloat(segDuration.toFixed(3)),
        timelineStart: parseFloat(timelineCursor.toFixed(3)),
        timelineEnd: parseFloat((timelineCursor + segDuration).toFixed(3)),
      });
      timelineCursor += segDuration;
    }
    curSourceIn = cut.end;
  }

  // Trailing segment
  if (curSourceIn < totalDurationS - 0.08) {
    const segDuration = totalDurationS - curSourceIn;
    segmentsToKeep.push({
      sourceIn: parseFloat(curSourceIn.toFixed(3)),
      sourceOut: parseFloat(totalDurationS.toFixed(3)),
      duration: parseFloat(segDuration.toFixed(3)),
      timelineStart: parseFloat(timelineCursor.toFixed(3)),
      timelineEnd: parseFloat((timelineCursor + segDuration).toFixed(3)),
    });
    timelineCursor += segDuration;
  }

  const editedDurationS = parseFloat(timelineCursor.toFixed(3));
  const timeSavedS = parseFloat((totalDurationS - editedDurationS).toFixed(3));
  const percentShortened = totalDurationS > 0
    ? Math.round((timeSavedS / totalDurationS) * 100)
    : 0;

  return {
    segmentsToKeep,
    cutsToRemove: allCuts,
    originalDurationS: totalDurationS,
    editedDurationS,
    timeSavedS,
    percentShortened,
  };
}
