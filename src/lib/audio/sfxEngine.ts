/**
 * Procedural Sound Effects (SFX) & Beat-Synced Audio Cue Engine.
 *
 * Synthesizes zero-dependency cinematic SFX (Whoosh, Pop, Impact, Riser, Click, Ding)
 * using WebAudio DSP synthesis (oscillators, filtered noise envelopes), detects musical
 * beat transients, and automatically arranges sound cues for cuts and graphic reveals.
 */

export type SfxType = 'whoosh' | 'pop' | 'impact' | 'riser' | 'click' | 'ding';

export interface SoundCue {
  id: string;
  type: SfxType;
  timelineS: number;
  volume: number; // 0.0 to 1.0
  pitchMultiplier?: number;
}

export interface SfxMixConfig {
  enabled: boolean;
  volume: number; // 0.0 to 1.5
  autoSoundDesign: boolean;
  beatSync: boolean;
  cues: SoundCue[];
}

export const DEFAULT_SFX_CONFIG: SfxMixConfig = {
  enabled: true,
  volume: 0.75,
  autoSoundDesign: true,
  beatSync: true,
  cues: [],
};

/**
 * Procedurally synthesize PCM audio data for a sound effect.
 * Output is raw Float32Array (single-channel 44.1kHz PCM).
 */
export function synthesizeSfxPcm(
  type: SfxType,
  sampleRate: number = 44100,
  options: { durationS?: number; volume?: number; pitch?: number } = {},
): Float32Array {
  const vol = options.volume ?? 1.0;
  const pitch = options.pitch ?? 1.0;

  switch (type) {
    case 'whoosh': {
      // Filtered noise with exponential frequency envelope
      const durS = options.durationS ?? 0.35;
      const totalSamples = Math.floor(durS * sampleRate);
      const out = new Float32Array(totalSamples);

      let lastSample = 0;
      for (let i = 0; i < totalSamples; i++) {
        const t = i / totalSamples; // 0 to 1
        // Bell-shaped amplitude envelope
        const env = Math.sin(t * Math.PI) ** 2;
        // White noise
        const white = Math.random() * 2 - 1;
        // Simple low-pass smoothing with dynamic cutoff
        const alpha = Math.min(0.85, 0.05 + 0.8 * env * pitch);
        lastSample = lastSample + alpha * (white - lastSample);

        out[i] = lastSample * env * vol * 0.9;
      }
      return out;
    }

    case 'pop': {
      // Rapid sine pitch drop: 750Hz -> 100Hz in 50ms
      const durS = options.durationS ?? 0.06;
      const totalSamples = Math.floor(durS * sampleRate);
      const out = new Float32Array(totalSamples);

      let phase = 0;
      for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const progress = i / totalSamples;
        // Exponential frequency decay
        const freq = (750 * pitch) * Math.exp(-progress * 5) + 80;
        phase += (2 * Math.PI * freq) / sampleRate;
        // Fast decay envelope
        const env = Math.exp(-progress * 6);
        out[i] = Math.sin(phase) * env * vol;
      }
      return out;
    }

    case 'impact': {
      // Sub-bass sine drop + short noise transient
      const durS = options.durationS ?? 0.8;
      const totalSamples = Math.floor(durS * sampleRate);
      const out = new Float32Array(totalSamples);

      let phase = 0;
      for (let i = 0; i < totalSamples; i++) {
        const progress = i / totalSamples;
        const freq = (120 * pitch) * Math.exp(-progress * 3.5) + 35;
        phase += (2 * Math.PI * freq) / sampleRate;

        const subEnv = Math.exp(-progress * 4.0);
        const noiseTransient = progress < 0.05 ? (Math.random() * 2 - 1) * Math.exp(-progress * 60) : 0;

        out[i] = (Math.sin(phase) * 0.75 + noiseTransient * 0.25) * subEnv * vol;
      }
      return out;
    }

    case 'riser': {
      // Exponential rising pitch & amplitude
      const durS = options.durationS ?? 1.5;
      const totalSamples = Math.floor(durS * sampleRate);
      const out = new Float32Array(totalSamples);

      let phase = 0;
      for (let i = 0; i < totalSamples; i++) {
        const t = i / totalSamples;
        const freq = (150 * pitch) * Math.exp(t * 2.8); // 150Hz -> 2500Hz
        phase += (2 * Math.PI * freq) / sampleRate;
        const env = t ** 2.2; // crescendo
        out[i] = Math.sin(phase) * env * vol * 0.8;
      }
      return out;
    }

    case 'click': {
      // Micro bandpassed transient: 12ms
      const durS = options.durationS ?? 0.015;
      const totalSamples = Math.floor(durS * sampleRate);
      const out = new Float32Array(totalSamples);

      for (let i = 0; i < totalSamples; i++) {
        const progress = i / totalSamples;
        const freq = 2200 * pitch;
        const phase = (2 * Math.PI * freq * i) / sampleRate;
        const env = Math.exp(-progress * 12);
        out[i] = Math.sin(phase) * env * vol * 0.7;
      }
      return out;
    }

    case 'ding': {
      // Dual harmonic sine bell
      const durS = options.durationS ?? 0.9;
      const totalSamples = Math.floor(durS * sampleRate);
      const out = new Float32Array(totalSamples);

      const f1 = 2093 * pitch; // C7
      const f2 = 4186 * pitch; // C8

      for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 4.5);
        const s1 = Math.sin(2 * Math.PI * f1 * t);
        const s2 = Math.sin(2 * Math.PI * f2 * t) * 0.4;
        out[i] = (s1 + s2) * env * vol * 0.65;
      }
      return out;
    }
  }
}

/**
 * Detect musical beat onsets / energy peaks in an audio PCM channel.
 */
export function detectMusicBeats(
  pcm: Float32Array,
  sampleRate: number,
  options: { minPeakDistanceS?: number; thresholdRatio?: number } = {},
): { beatTimestampsS: number[]; estimatedBpm: number } {
  if (!pcm || pcm.length === 0 || sampleRate <= 0) {
    return { beatTimestampsS: [], estimatedBpm: 120 };
  }

  const hopSize = Math.floor(sampleRate * 0.02); // 20ms frames
  const numFrames = Math.floor(pcm.length / hopSize);
  const energies = new Float32Array(numFrames);

  let maxEnergy = 0;
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hopSize;
    for (let i = 0; i < hopSize; i++) {
      sum += pcm[start + i] * pcm[start + i];
    }
    const rms = Math.sqrt(sum / hopSize);
    energies[f] = rms;
    if (rms > maxEnergy) maxEnergy = rms;
  }

  if (maxEnergy < 0.001) {
    return { beatTimestampsS: [], estimatedBpm: 120 };
  }

  // Spectral flux / positive energy derivative
  const minDistanceFrames = Math.floor((options.minPeakDistanceS ?? 0.28) / 0.02);
  const threshold = maxEnergy * (options.thresholdRatio ?? 0.35);

  const beatTimestampsS: number[] = [];
  let lastPeakFrame = -minDistanceFrames;

  for (let f = 1; f < numFrames - 1; f++) {
    const diff = energies[f] - energies[f - 1];
    if (diff > 0 && energies[f] > energies[f + 1] && energies[f] > threshold) {
      if (f - lastPeakFrame >= minDistanceFrames) {
        beatTimestampsS.push(Math.round(f * 0.02 * 100) / 100);
        lastPeakFrame = f;
      }
    }
  }

  // Estimate BPM from median beat intervals
  let estimatedBpm = 120;
  if (beatTimestampsS.length >= 4) {
    const intervals: number[] = [];
    for (let i = 1; i < beatTimestampsS.length; i++) {
      intervals.push(beatTimestampsS[i] - beatTimestampsS[i - 1]);
    }
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    if (medianInterval > 0.2 && medianInterval < 2.0) {
      estimatedBpm = Math.round(60 / medianInterval);
      while (estimatedBpm < 70) estimatedBpm *= 2;
      while (estimatedBpm > 180) estimatedBpm /= 2;
    }
  }

  return { beatTimestampsS, estimatedBpm };
}

/**
 * Automatically generate sound design cues for timeline clips, cuts, and graphic overlays.
 */
export function generateEditSoundCues(
  clips: Array<{
    id: string;
    type?: string;
    kind?: string;
    startS: number;
    endS: number;
    transform?: { scale?: number };
  }>,
  options: {
    includeCuts?: boolean;
    includeZooms?: boolean;
    includeTextPop?: boolean;
  } = {},
): SoundCue[] {
  const cues: SoundCue[] = [];
  const includeCuts = options.includeCuts ?? true;
  const includeZooms = options.includeZooms ?? true;
  const includeTextPop = options.includeTextPop ?? true;

  const videoClips = clips
    .filter(c => c.type === 'video' || c.kind === 'video')
    .sort((a, b) => a.startS - b.startS);

  const textClips = clips
    .filter(c => c.type === 'text' || c.kind === 'text')
    .sort((a, b) => a.startS - b.startS);

  // 1. Whoosh / cut transitions on video cuts
  if (includeCuts) {
    for (let i = 1; i < videoClips.length; i++) {
      const prev = videoClips[i - 1];
      const cur = videoClips[i];
      if (Math.abs(cur.startS - prev.endS) < 0.1 && cur.startS > 0.1) {
        cues.push({
          id: `sfx-cut-${cur.id}`,
          type: 'whoosh',
          timelineS: Math.max(0, cur.startS - 0.08),
          volume: 0.65,
        });
      }
    }
  }

  // 2. Punch-in zoom impacts
  if (includeZooms) {
    for (const v of videoClips) {
      if (v.transform && (v.transform.scale ?? 1.0) > 1.15) {
        cues.push({
          id: `sfx-zoom-${v.id}`,
          type: 'impact',
          timelineS: v.startS,
          volume: 0.55,
        });
      }
    }
  }

  // 3. Pop / Click sound on text and sticker reveals
  if (includeTextPop) {
    for (const t of textClips) {
      if (t.startS > 0.05) {
        cues.push({
          id: `sfx-text-${t.id}`,
          type: 'pop',
          timelineS: t.startS,
          volume: 0.7,
        });
      }
    }
  }

  return cues.sort((a, b) => a.timelineS - b.timelineS);
}
