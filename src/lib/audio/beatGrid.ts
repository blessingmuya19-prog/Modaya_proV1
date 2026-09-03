/**
 * Real-Time Audio Beat & Rhythm Snap Grid Engine.
 *
 * Provides musical tempo grid generation, subdivision ticks (1/4 downbeats, 1/8 notes, 1/16 notes),
 * magnetic playhead/clip snapping, and automated rhythmic cut placement.
 *
 * Fully deterministic and zero-dependency.
 */

export interface BeatTick {
  time: number;          // Timestamp in seconds
  beatNumber: number;    // Absolute beat counter (1, 2, 3...)
  isDownbeat: boolean;   // True on bar start (e.g., beat 1 of 4)
  subdivision: 'downbeat' | 'quarter' | 'eighth' | 'sixteenth';
}

export interface BeatGrid {
  bpm: number;
  timeSignature: [number, number]; // e.g. [4, 4] or [3, 4]
  firstBeatOffset: number;        // Downbeat start timestamp in seconds
  secondsPerBeat: number;
  ticks: BeatTick[];
}

export interface BeatSnapResult {
  originalTime: number;
  snappedTime: number;
  isSnapped: boolean;
  snappedTick?: BeatTick;
  delta: number; // snappedTime - originalTime
}

/**
 * Generate a complete musical beat grid across a timeline.
 */
export function createBeatGrid(
  bpm: number,
  totalDurationSeconds: number,
  firstBeatOffset = 0,
  timeSignature: [number, number] = [4, 4],
  subdivisions: 'quarter' | 'eighth' | 'sixteenth' = 'quarter'
): BeatGrid {
  const safeBpm = Math.max(30, Math.min(300, bpm));
  const secondsPerBeat = 60 / safeBpm;
  const beatsPerBar = timeSignature[0];
  const ticks: BeatTick[] = [];

  const subDivisionFactor =
    subdivisions === 'sixteenth' ? 4 :
    subdivisions === 'eighth' ? 2 : 1;

  const stepSeconds = secondsPerBeat / subDivisionFactor;
  let t = firstBeatOffset;
  let stepIndex = 0;

  while (t <= totalDurationSeconds) {
    if (t >= 0) {
      const beatIndex = Math.floor(stepIndex / subDivisionFactor);
      const subIndex = stepIndex % subDivisionFactor;
      const isDownbeat = subIndex === 0 && (beatIndex % beatsPerBar === 0);

      let subdivision: BeatTick['subdivision'] = 'quarter';
      if (isDownbeat) {
        subdivision = 'downbeat';
      } else if (subIndex === 0) {
        subdivision = 'quarter';
      } else if (subIndex % 2 === 0) {
        subdivision = 'eighth';
      } else {
        subdivision = 'sixteenth';
      }

      ticks.push({
        time: parseFloat(t.toFixed(4)),
        beatNumber: beatIndex + 1,
        isDownbeat,
        subdivision,
      });
    }

    t += stepSeconds;
    stepIndex++;
  }

  return {
    bpm: safeBpm,
    timeSignature,
    firstBeatOffset,
    secondsPerBeat,
    ticks,
  };
}

/**
 * Magnetically snap any timestamp to the closest musical beat tick
 * if within snapThreshold seconds.
 */
export function snapToNearestBeat(
  time: number,
  grid: BeatGrid,
  snapThresholdSeconds = 0.12
): BeatSnapResult {
  if (!grid.ticks || grid.ticks.length === 0) {
    return { originalTime: time, snappedTime: time, isSnapped: false, delta: 0 };
  }

  let closestTick: BeatTick | undefined;
  let minDiff = Infinity;

  for (let i = 0; i < grid.ticks.length; i++) {
    const tick = grid.ticks[i];
    const diff = Math.abs(tick.time - time);
    if (diff < minDiff) {
      minDiff = diff;
      closestTick = tick;
    }
  }

  if (closestTick && minDiff <= snapThresholdSeconds) {
    return {
      originalTime: time,
      snappedTime: closestTick.time,
      isSnapped: true,
      snappedTick: closestTick,
      delta: closestTick.time - time,
    };
  }

  return {
    originalTime: time,
    snappedTime: time,
    isSnapped: false,
    delta: 0,
  };
}

/**
 * Generate rhythmic cut timestamps synchronized to musical bars.
 */
export function generateRhythmicCutTimestamps(
  bpm: number,
  totalDurationSeconds: number,
  firstBeatOffset = 0,
  beatsPerCut = 4
): number[] {
  const secondsPerBeat = 60 / Math.max(30, Math.min(300, bpm));
  const cutInterval = secondsPerBeat * Math.max(1, beatsPerCut);
  const cuts: number[] = [];

  let t = firstBeatOffset + cutInterval;
  while (t < totalDurationSeconds) {
    cuts.push(parseFloat(t.toFixed(4)));
    t += cutInterval;
  }

  return cuts;
}
