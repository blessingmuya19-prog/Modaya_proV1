/**
 * Turning a measured loudness curve into something a language model can reason
 * about.
 *
 * The model cannot see or hear the footage. Without this it answers "the best
 * 30 seconds" with the first 30 seconds, because the opening is the only part
 * of the timeline it knows exists. Loudness is a crude proxy for excitement —
 * a crowd reaction, a shout, a hit — but it is a real measurement of the actual
 * file, and it is far better than the start of the video.
 *
 * Everything here is deterministic: the same curve always yields the same
 * answer, so an edit can be reproduced.
 */

/** Mean energy over a time span, in seconds. */
export function meanOver(energy: number[], durationS: number, fromS: number, toS: number): number {
  if (energy.length === 0 || durationS <= 0) return 0;
  const perS = energy.length / durationS;
  const a = Math.max(0, Math.floor(fromS * perS));
  const b = Math.min(energy.length, Math.ceil(toS * perS));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += energy[i];
  return sum / (b - a);
}

/**
 * The loudest contiguous window of `windowS` seconds.
 * Returns null when there is nothing measured to go on.
 */
export function loudestWindow(
  energy: number[], durationS: number, windowS: number,
): [number, number] | null {
  if (energy.length === 0 || durationS <= 0 || windowS <= 0) return null;
  if (windowS >= durationS) return [0, durationS];

  // Step at a tenth of the window, which is precise enough to matter and cheap.
  const step = Math.max(0.1, windowS / 10);
  let best: [number, number] | null = null;
  let bestScore = -1;

  for (let start = 0; start + windowS <= durationS + 1e-6; start += step) {
    const score = meanOver(energy, durationS, start, start + windowS);
    if (score > bestScore) {
      bestScore = score;
      best = [Number(start.toFixed(2)), Number((start + windowS).toFixed(2))];
    }
  }
  return best;
}

/**
 * A compact 0–9 sparkline of loudness over time, normalised to the loudest
 * moment in this video. Cheap in tokens, and readable by a model.
 */
export function loudnessSparkline(
  energy: number[], durationS: number, buckets = 40,
): string {
  if (energy.length === 0 || durationS <= 0) return '';
  const width = durationS / buckets;
  const values = Array.from({ length: buckets }, (_, i) =>
    meanOver(energy, durationS, i * width, (i + 1) * width));
  const peak = Math.max(...values);
  if (peak <= 0) return '';
  return values.map(v => String(Math.min(9, Math.round((v / peak) * 9)))).join('');
}

/**
 * The block handed to the model. Names the loudest candidate windows outright
 * so the model does not have to do arithmetic on a sparkline.
 */
export function describeLoudness(
  energy: number[], durationS: number,
  state: 'pending' | 'ready' | 'failed' = 'ready',
): string {
  if (energy.length === 0 || durationS <= 0) {
    if (state === 'pending') {
      return '(the browser is still decoding this file\'s audio — say it is still measuring and ' +
             'ask the user to try again in a few seconds; do NOT guess which part is strongest, ' +
             'and do NOT tell them to reopen the project)';
    }
    if (state === 'failed') {
      return '(this file\'s audio could not be decoded, so there is no loudness to go on — ' +
             'say so plainly; it may have no audio track or use a codec this browser cannot read)';
    }
    return '(no audio measured yet — do not guess which part is strongest; ask the user to reopen the project)';
  }

  const spark = loudnessSparkline(energy, durationS);
  if (!spark) return '(audio measured, but silent throughout)';

  const lines = [
    `loudness 0-9 across the whole video, left to right (each character is ${(durationS / 40).toFixed(1)}s):`,
    spark,
  ];

  const windows = [10, 15, 30, 60].filter(w => w < durationS);
  if (windows.length) {
    lines.push('loudest continuous window of each length:');
    for (const w of windows) {
      const win = loudestWindow(energy, durationS, w);
      if (win) lines.push(`  ${w}s -> [${win[0].toFixed(1)}, ${win[1].toFixed(1)}]`);
    }
  }
  return lines.join('\n');
}
