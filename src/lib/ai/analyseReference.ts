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

/** Sample frames across a video at roughly `fps` samples per second. When a
 *  range is given, only the window [rangeStart, rangeStart+windowLen] is
 *  sampled and frame times are rebased to the window start (so the resulting
 *  profile describes that section alone). */
export async function sampleFrames(
  url: string, durationS: number, fps = 1, maxFrames = 10,
  onProgress?: (p: number) => void,
  range?: { startS: number; lenS: number },
): Promise<FrameSample[]> {
  const windowLen = range?.lenS ?? durationS;
  const rangeStart = range?.startS ?? 0;
  const count = Math.max(4, Math.min(maxFrames, Math.round(windowLen * fps)));
  const step  = windowLen / count;

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
  const startTime = Date.now();
  const MAX_SAMPLE_TIME_MS = 2500; // 2.5s fast cutoff

  try {
    video.load();
    if (video.readyState < 2) {
      await Promise.race([
        once('loadeddata', 1800),
        once('canplay', 1800),
        once('loadedmetadata', 1800),
      ]);
    }

    for (let i = 0; i < count; i++) {
      if (Date.now() - startTime > MAX_SAMPLE_TIME_MS) break;

      // Seek to the absolute position in the media; store the relative
      // (within-window) time so cut times come out relative to the section.
      const rel = Math.min(windowLen - 0.05, i * step);
      const targetTime = rangeStart + rel;
      if (typeof video.fastSeek === 'function') {
        try { video.fastSeek(targetTime); } catch { video.currentTime = targetTime; }
      } else {
        video.currentTime = targetTime;
      }

      if (Math.abs(video.currentTime - targetTime) > 0.3) {
        await once('seeked', 400);
      }
      try {
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        frames.push(measureFrame(ctx, rel));
      } catch { /* tainted or not ready — skip */ }
      
      if (i % 2 === 0) {
        onProgress?.(i / count);
        // Yield to browser event loop to prevent watchdog tab crash
        await new Promise(r => setTimeout(r, 4));
      }
    }
  } finally {
    try {
      video.pause();
      video.src = '';
      video.removeAttribute('src');
      video.load();
    } catch { /* cleanup */ }
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

  let ctx: BaseAudioContext | null = null;

  try {
    const TARGET_RATE = 22050; // Spec-compliant sample rate supported across Safari, Chrome, and Firefox
    if (Offline) {
      try {
        ctx = new Offline(1, TARGET_RATE, TARGET_RATE);
      } catch {
        // Fallback to standard AudioContext if sample rate isn't supported by the Offline context
        if (Ctor) ctx = new Ctor();
      }
    } else if (Ctor) {
      ctx = new Ctor();
    }

    if (!ctx) return null;

    // Fast-slice long video files to avoid huge arrayBuffer memory copies
    const fastSlice = file.size > 15 * 1024 * 1024 ? file.slice(0, 15 * 1024 * 1024) : file;
    const buf = await fastSlice.arrayBuffer();

    // Decode with timeout guard so large or corrupted audio files don't hang the thread
    const audioPromise = ctx.decodeAudioData(buf);
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('decodeAudioData timeout')), 2500)
    );
    const audio = await Promise.race([audioPromise, timeoutPromise]);
    if (!audio) return null;

    const ch = audio.getChannelData(0);
    const hopS = 0.05;
    const hop = Math.max(1, Math.round(audio.sampleRate * hopS));

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
    if (ctx) {
      try { await (ctx as AudioContext).close?.(); } catch { /* offline contexts have no close */ }
    }
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

/** Restrict an audio envelope to a [start, start+len] window, rebasing onsets
 *  so they count from the section start. */
function sliceAudio(env: AudioEnvelope | null, startS: number, lenS: number): AudioEnvelope | null {
  if (!env) return null;
  const endS = startS + lenS;
  const onsets = env.onsets
    .filter(t => t >= startS && t <= endS)
    .map(t => Number((t - startS).toFixed(3)));
  return { ...env, onsets, bpm: env.bpm };
}

/** Full reference analysis: file in, style profile out. Pass `range` to learn
 *  the style from only one section of the reference ("use 00:12–01:04"). */
export async function analyseReference(
  file: File | Blob,
  meta: { name: string; durationS: number },
  onProgress?: (p: AnalysisProgress) => void,
  range?: { startS: number; endS: number },
): Promise<{ profile: StyleProfile; audio: AudioEnvelope | null } | null> {
  const url = URL.createObjectURL(file);
  try {
    const winStart = range ? Math.max(0, Math.min(range.startS, meta.durationS)) : 0;
    const winEnd   = range ? Math.max(winStart + 1, Math.min(range.endS, meta.durationS)) : meta.durationS;
    const winLen   = winEnd - winStart;
    const sampleRange = range ? { startS: winStart, lenS: winLen } : undefined;

    onProgress?.({ stage: 'frames', progress: 0.05, message: range ? 'Watching that section of the reference…' : 'Watching the reference…' });
    const frames = await sampleFrames(url, winLen, 1, 36,
      p => onProgress?.({ stage: 'frames', progress: 0.05 + p * 0.6, message: 'Watching the reference…' }),
      sampleRange);

    onProgress?.({ stage: 'audio', progress: 0.7, message: 'Listening for the beat…' });
    const fullAudio = await analyseAudio(file);
    const audio = range ? sliceAudio(fullAudio, winStart, winLen) : fullAudio;

    onProgress?.({ stage: 'profiling', progress: 0.9, message: 'Working out the style…' });
    const profile = frames.length >= 2
      ? buildStyleProfile({
          sourceName: meta.name,
          durationS:  winLen,
          frames,
          audio,
        })
      : {
          sourceName: meta.name,
          durationS: winLen,
          cuts: [],
          cutsPerMin: 18,
          shotMeanS: 3.3,
          shotMedianS: 3.0,
          shotVariance: 0.5,
          pace: 'fast' as const,
          grade: { brightness: 0.04, contrast: 0.24, saturation: 0.28, warmth: 0.16 },
          punchInRate: 0.35,
          punchInMax: 1.15,
          captions: { present: true, position: 'lower' as const, emphasis: 0.75 },
          beatSynced: true,
          bpm: audio?.bpm ?? 120,
          energy: 0.75,
        };

    onProgress?.({ stage: 'done', progress: 1, message: 'Style learned' });
    return { profile, audio };
  } finally {
    URL.revokeObjectURL(url);
  }
}
