/**
 * Preparing audio for speech recognition, in the browser.
 *
 * Whisper wants a plain audio file, not a 200 MB mp4. We already decode the
 * media to measure loudness, so the same decode is reused here: mix to mono,
 * resample to 16 kHz (what Whisper is trained on — more is wasted bytes), and
 * emit a WAV. A 13-minute clip lands around 25 MB instead of hundreds.
 *
 * Long recordings are split into chunks on quiet boundaries where possible, so
 * a cut never lands mid-word, and each chunk carries the offset needed to put
 * its timestamps back on the project timeline.
 */

/** Whisper is trained at 16 kHz; anything above it is wasted upload. */
export const ASR_SAMPLE_RATE = 16_000;

/** Stay well under provider upload limits (Groq allows 100 MB). */
const MAX_CHUNK_BYTES = 18 * 1024 * 1024;

export interface AudioChunk {
  blob:    Blob;
  /** Seconds into the project where this chunk begins. */
  offsetS: number;
  /** Length of this chunk in seconds. */
  lengthS: number;
}

/** Decode any media blob to mono PCM at 16 kHz. Returns null if it has no audio. */
export async function decodeForAsr(file: Blob): Promise<Float32Array | null> {
  const Offline = (window.OfflineAudioContext
    ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext);
  if (!Offline) return null;

  const ctx = new Offline(1, ASR_SAMPLE_RATE, ASR_SAMPLE_RATE);
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);

    // Mix to mono: speech recognition gains nothing from stereo, and it halves
    // the upload.
    const left  = audio.getChannelData(0);
    const right = audio.getChannelData(1);
    const mono  = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
    return mono;
  } catch {
    return null;      // no audio track, or a codec this browser cannot decode
  }
}

/** 16-bit PCM WAV bytes. Separated from the Blob so it can be inspected. */
export function encodeWavBytes(samples: Float32Array, sampleRate = ASR_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view   = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);            // PCM header size
  view.setUint16(20, 1, true);             // format: PCM
  view.setUint16(22, 1, true);             // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);             // block align
  view.setUint16(34, 16, true);            // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** 16-bit PCM WAV. Small, universally accepted, no encoder dependency. */
export function encodeWav(samples: Float32Array, sampleRate = ASR_SAMPLE_RATE): Blob {
  return new Blob([encodeWavBytes(samples, sampleRate)], { type: 'audio/wav' });
}

/**
 * Find a quiet instant at or before `targetSample` so a chunk boundary does not
 * land in the middle of a word. Searching only backwards guarantees the chunk
 * never grows past the upload limit.
 */
function quietestNear(samples: Float32Array, targetSample: number, windowSamples: number): number {
  const from = Math.max(0, targetSample - windowSamples);
  const to   = Math.min(samples.length, targetSample);
  const step = Math.max(1, Math.floor(ASR_SAMPLE_RATE * 0.02));   // 20 ms

  let best = targetSample;
  let bestEnergy = Infinity;
  for (let i = from; i < to; i += step) {
    let sum = 0;
    const end = Math.min(samples.length, i + step);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    if (sum < bestEnergy) { bestEnergy = sum; best = i; }
  }
  return best > from ? best : targetSample;
}

/**
 * Split decoded audio into upload-sized WAV chunks, preferring quiet cut
 * points. Each chunk knows where it sits on the timeline.
 */
export function chunkForAsr(samples: Float32Array, sampleRate = ASR_SAMPLE_RATE): AudioChunk[] {
  const maxSamples = Math.floor((MAX_CHUNK_BYTES - 44) / 2);
  if (samples.length <= maxSamples) {
    return [{
      blob:    encodeWav(samples, sampleRate),
      offsetS: 0,
      lengthS: samples.length / sampleRate,
    }];
  }

  const chunks: AudioChunk[] = [];
  const search = Math.floor(sampleRate * 2);      // look 2 s either side for quiet
  let start = 0;

  while (start < samples.length) {
    const target = start + maxSamples;
    const end = target >= samples.length
      ? samples.length
      : quietestNear(samples, target, search);

    chunks.push({
      blob:    encodeWav(samples.slice(start, end), sampleRate),
      offsetS: start / sampleRate,
      lengthS: (end - start) / sampleRate,
    });
    start = end;
  }
  return chunks;
}
