/**
 * Waveform extraction, caching, and resampling for editor timeline tracks.
 *
 * Extracts real audio RMS amplitude buckets from media audio tracks using
 * Web Audio API (OfflineAudioContext). Results are normalized to [0..1] and
 * cached in-memory and in IndexedDB for instant reload on reopen.
 */
import { saveRecord, loadRecord } from './mediaDb';

const waveformCache = new Map<string, number[]>();

export function setProjectWaveform(projectId: string, wave: number[]) {
  if (!projectId || !wave.length) return;
  waveformCache.set(projectId, wave);
  void saveRecord(`${projectId}:waveform`, wave).catch(() => {});
}

export function getProjectWaveform(projectId: string): number[] | null {
  return waveformCache.get(projectId) ?? null;
}

export async function loadCachedWaveform(projectId: string): Promise<number[] | null> {
  const mem = waveformCache.get(projectId);
  if (mem) return mem;
  const stored = await loadRecord<number[]>(`${projectId}:waveform`).catch(() => null);
  if (stored && stored.length > 0) {
    waveformCache.set(projectId, stored);
    return stored;
  }
  return null;
}

/**
 * Extract an amplitude envelope from an audio/video blob.
 * Returns an array of normalized floats [0..1] at `samplesPerSec` resolution.
 */
export async function extractWaveform(
  file: Blob,
  samplesPerSec = 20, // 50ms per bucket
): Promise<number[]> {
  if (!file || file.size === 0) return [];

  const Offline = (typeof window !== 'undefined'
    ? (window.OfflineAudioContext
      ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)
    : null);
  const Ctor = (typeof window !== 'undefined'
    ? (window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : null);

  if (!Offline && !Ctor) return [];

  const TARGET_RATE = 8000;
  const ctx: BaseAudioContext = Offline
    ? new Offline(1, TARGET_RATE, TARGET_RATE)
    : new Ctor!();

  try {
    const buf = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const hop = Math.max(1, Math.round(audio.sampleRate / samplesPerSec));

    const raw: number[] = [];
    for (let i = 0; i + hop <= ch.length; i += hop) {
      let sum = 0;
      for (let j = i; j < i + hop; j++) {
        sum += ch[j] * ch[j];
      }
      raw.push(Math.sqrt(sum / hop));
    }

    if (!raw.length) return [];

    // Normalize peak to 1.0 with noise floor
    let peak = 1e-5;
    for (const v of raw) if (v > peak) peak = v;

    const normalized = raw.map(v => Math.max(0.06, Math.min(1.0, v / peak)));
    return normalized;
  } catch {
    return [];
  } finally {
    try {
      if ('close' in ctx && typeof ctx.close === 'function') {
        await ctx.close();
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Resample a waveform slice for a clip of `[startS, endS]` into `barCount` bars.
 */
export function resampleWaveform(
  waveform: number[] | null | undefined,
  clipStartS: number,
  clipEndS: number,
  totalDurationS: number,
  barCount: number,
): number[] {
  const count = Math.max(1, barCount);
  if (!waveform || waveform.length === 0 || totalDurationS <= 0 || clipEndS <= clipStartS) {
    // Synthetic aesthetic fallback
    return Array.from({ length: count }, (_, i) =>
      Math.abs(Math.sin((i + clipStartS * 10) * 0.28 + 0.9) * Math.cos(i * 0.11)) * 0.75 + 0.12
    );
  }

  const dur = Math.max(0.01, totalDurationS);
  const startFrac = Math.max(0, Math.min(1, clipStartS / dur));
  const endFrac = Math.max(0, Math.min(1, clipEndS / dur));

  const startIdx = Math.floor(startFrac * waveform.length);
  const endIdx = Math.min(waveform.length, Math.ceil(endFrac * waveform.length));
  const slice = waveform.slice(startIdx, Math.max(startIdx + 1, endIdx));

  if (slice.length === 0) {
    return new Array(count).fill(0.12);
  }

  const out: number[] = [];
  const step = slice.length / count;

  for (let i = 0; i < count; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(slice.length, Math.floor((i + 1) * step));
    if (b <= a) {
      out.push(slice[Math.min(slice.length - 1, a)] ?? 0.12);
    } else {
      let maxVal = 0;
      for (let j = a; j < b; j++) {
        if (slice[j] > maxVal) maxVal = slice[j];
      }
      out.push(maxVal || 0.12);
    }
  }

  return out;
}
