/**
 * Reference analysis in the browser.
 *
 * Decodes a video, samples frames into a small canvas, and turns them into the
 * measurements styleProfile.ts needs; separately decodes the audio into an RMS
 * envelope for onset/BPM detection. No server, no upload — the file never
 * leaves the machine.
 */
import {
  FrameSample, AudioEnvelope, StyleProfile,
  buildStyleProfile, detectOnsets, estimateBpm,
} from './styleProfile';

const SAMPLE_W = 96;
const SAMPLE_H = 54;
const BINS     = 16;

export interface AnalysisProgress {
  stage:    'decoding' | 'frames' | 'audio' | 'profiling' | 'done';
  progress: number;      // 0..1
  message:  string;
}

/** Pull one frame's measurements out of a canvas context. */
export function measureFrame(ctx: CanvasRenderingContext2D, t: number): FrameSample {
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  const hist = new Array(BINS).fill(0);

  let lumaSum = 0, satSum = 0, warmSum = 0, n = 0;
  const lumaGrid: number[] = new Array(SAMPLE_W * SAMPLE_H);

  for (let p = 0, i = 0; p < data.length; p += 4, i++) {
    const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;

    lumaGrid[i] = luma;
    hist[Math.min(BINS - 1, Math.floor(luma * BINS))]++;
    lumaSum += luma; satSum += sat; warmSum += r - b; n++;
  }

  for (let i = 0; i < BINS; i++) hist[i] /= n || 1;

  // Edge energy overall and in the lower third (caption/graphics proxy)
  let detail = 0, lower = 0, lowerN = 0, detailN = 0;
  const lowerStart = Math.floor(SAMPLE_H * 0.66);
  for (let y = 1; y < SAMPLE_H; y++) {
    for (let x = 1; x < SAMPLE_W; x++) {
      const i = y * SAMPLE_W + x;
      const gx = Math.abs(lumaGrid[i] - lumaGrid[i - 1]);
      const gy = Math.abs(lumaGrid[i] - lumaGrid[i - SAMPLE_W]);
      const g  = gx + gy;
      detail += g; detailN++;
      if (y >= lowerStart) { lower += g; lowerN++; }
    }
  }

  return {
    t,
    hist,
    luma:        lumaSum / n,
    sat:         satSum / n,
    warmth:      warmSum / n,
    detail:      detail / (detailN || 1),
    lowerDetail: lower / (lowerN || 1),
  };
}

/** Sample frames across a video at roughly `fps` samples per second. */
export async function sampleFrames(
  url: string, durationS: number, fps = 4, maxFrames = 480,
  onProgress?: (p: number) => void,
): Promise<FrameSample[]> {
  const count = Math.max(8, Math.min(maxFrames, Math.round(durationS * fps)));
  const step  = durationS / count;

  const video = document.createElement('video');
  video.src = url; video.muted = true; video.playsInline = true; video.preload = 'auto';

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W; canvas.height = SAMPLE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const once = (ev: string, ms: number) => new Promise<boolean>(res => {
    const to = setTimeout(() => { cleanup(); res(false); }, ms);
    const ok = () => { cleanup(); res(true); };
    const no = () => { cleanup(); res(false); };
    const cleanup = () => {
      clearTimeout(to);
      video.removeEventListener(ev, ok);
      video.removeEventListener('error', no);
    };
    video.addEventListener(ev, ok, { once: true });
    video.addEventListener('error', no, { once: true });
  });

  const frames: FrameSample[] = [];
  try {
    video.load();
    if (!(await once('loadeddata', 15000))) return [];

    for (let i = 0; i < count; i++) {
      const t = Math.min(durationS - 0.05, i * step);
      video.currentTime = t;
      if (!(await once('seeked', 5000))) break;
      try {
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        frames.push(measureFrame(ctx, t));
      } catch { /* tainted or not ready — skip */ }
      if (i % 8 === 0) onProgress?.(i / count);
    }
  } finally {
    video.src = ''; video.removeAttribute('src');
  }
  onProgress?.(1);
  return frames;
}

/** RMS envelope + onsets + BPM from a media file's audio track. */
export async function analyseAudio(file: Blob): Promise<AudioEnvelope | null> {
  const Offline = (window.OfflineAudioContext
    ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext);
  const Ctor = (window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Offline && !Ctor) return null;

  /**
   * Decode at 8 kHz instead of the file's own rate. A loudness envelope needs
   * nothing finer, and a full-rate decode of a long recording is enormous:
   * 13 minutes at 48 kHz stereo is ~310 MB of float samples, which is slow at
   * best and fails outright on phones. At 8 kHz the same file is ~26 MB.
   * decodeAudioData resamples to the context's rate, so this is free.
   */
  const TARGET_RATE = 8000;
  const ctx: BaseAudioContext = Offline
    ? new Offline(1, TARGET_RATE, TARGET_RATE)
    : new Ctor!();

  try {
    const buf   = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    const ch    = audio.getChannelData(0);
    const hopS  = 0.05;
    const hop   = Math.max(1, Math.round(audio.sampleRate * hopS));

    const rms: number[] = [];
    for (let i = 0; i + hop <= ch.length; i += hop) {
      let sum = 0;
      for (let j = i; j < i + hop; j++) sum += ch[j] * ch[j];
      rms.push(Math.sqrt(sum / hop));
    }

    // A spread here would blow the argument limit on a long file, so loop.
    let peak = 1e-6;
    for (const v of rms) if (v > peak) peak = v;
    const norm = rms.map(v => v / peak);

    const onsets = detectOnsets(norm, hopS);
    return { rms: norm, hopS, onsets, bpm: estimateBpm(onsets) };
  } catch {
    return null;      // no audio track, or an undecodable codec
  } finally {
    try { await (ctx as AudioContext).close?.(); } catch { /* offline contexts have no close */ }
  }
}

/** Per-second interest curve for the target footage, used to pick what to keep. */
export function interestCurve(env: AudioEnvelope | null, durationS: number): number[] {
  const out = new Array(Math.max(1, Math.ceil(durationS))).fill(0.5);
  if (!env?.rms.length) return out;

  const perS = Math.round(1 / env.hopS);
  for (let s = 0; s < out.length; s++) {
    const a = s * perS, b = Math.min(env.rms.length, a + perS);
    if (b <= a) break;
    let sum = 0;
    for (let i = a; i < b; i++) sum += env.rms[i];
    out[s] = sum / (b - a);
  }
  return out;
}

/** Full reference analysis: file in, style profile out. */
export async function analyseReference(
  file: File | Blob,
  meta: { name: string; durationS: number },
  onProgress?: (p: AnalysisProgress) => void,
): Promise<{ profile: StyleProfile; audio: AudioEnvelope | null } | null> {
  const url = URL.createObjectURL(file);
  try {
    onProgress?.({ stage: 'frames', progress: 0.05, message: 'Watching the reference…' });
    const frames = await sampleFrames(url, meta.durationS, 4, 480,
      p => onProgress?.({ stage: 'frames', progress: 0.05 + p * 0.6, message: 'Watching the reference…' }));

    if (frames.length < 4) return null;

    onProgress?.({ stage: 'audio', progress: 0.7, message: 'Listening for the beat…' });
    const audio = await analyseAudio(file);

    onProgress?.({ stage: 'profiling', progress: 0.9, message: 'Working out the style…' });
    const profile = buildStyleProfile({
      sourceName: meta.name,
      durationS:  meta.durationS,
      frames,
      audio,
    });

    onProgress?.({ stage: 'done', progress: 1, message: 'Style learned' });
    return { profile, audio };
  } finally {
    URL.revokeObjectURL(url);
  }
}
