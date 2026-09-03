/**
 * Multi-track Sound Mixing & Audio Balancing Engine.
 *
 * Provides track-level mixing (Master, Voice/Dialogue, Background Music,
 * Sound Effects, B-roll Audio), soft-knee dynamic range compression,
 * speech enhancement, and auto-ducking integration.
 *
 * Pure, deterministic, and fully testable.
 */

import {
  DuckingOptions,
  DEFAULT_DUCKING_OPTIONS,
  SpeechSegment,
  getDuckingGainAt,
} from './ducking';
import type { SfxMixConfig } from './sfxEngine';
import { DEFAULT_SFX_CONFIG } from './sfxEngine';

export type TrackType = 'master' | 'voice' | 'music' | 'sfx' | 'broll';

export interface ChannelMix {
  volume: number;       // 0..2 (1.0 = 0dB unity gain)
  muted: boolean;       // mute track
  solo: boolean;        // solo track
  pan?: number;         // -1.0 (L) to +1.0 (R), default 0
  ducking?: boolean;    // whether this track is ducked during speech
}

export interface MultiTrackMixerConfig {
  master: ChannelMix;
  voice:  ChannelMix;
  music:  ChannelMix;
  sfx:    ChannelMix;
  broll:  ChannelMix;
  ducking: DuckingOptions & { enabled: boolean };
  sfxDesign?: SfxMixConfig;
  voiceEnhance: boolean;   // dialogue clarity & leveling
  preset?: 'dialogue_focus' | 'cinematic' | 'music_forward' | 'clean' | 'custom';
}

export const DEFAULT_MIXER_CONFIG: MultiTrackMixerConfig = {
  master: { volume: 1.0, muted: false, solo: false, pan: 0 },
  voice:  { volume: 1.0, muted: false, solo: false, pan: 0, ducking: false },
  music:  { volume: 0.70, muted: false, solo: false, pan: 0, ducking: true },
  sfx:    { volume: 0.80, muted: false, solo: false, pan: 0, ducking: false },
  broll:  { volume: 0.40, muted: false, solo: false, pan: 0, ducking: true },
  ducking: {
    ...DEFAULT_DUCKING_OPTIONS,
    enabled: true,
    duckVolume: 0.22, // ~ -13dB
  },
  sfxDesign: DEFAULT_SFX_CONFIG,
  voiceEnhance: true,
  preset: 'dialogue_focus',
};

export const MIX_PRESETS: Record<string, Partial<MultiTrackMixerConfig>> = {
  'dialogue_focus': {
    preset: 'dialogue_focus',
    master: { volume: 1.0, muted: false, solo: false, pan: 0 },
    voice:  { volume: 1.05, muted: false, solo: false, pan: 0, ducking: false },
    music:  { volume: 0.60, muted: false, solo: false, pan: 0, ducking: true },
    sfx:    { volume: 0.75, muted: false, solo: false, pan: 0, ducking: false },
    broll:  { volume: 0.35, muted: false, solo: false, pan: 0, ducking: true },
    ducking: {
      ...DEFAULT_DUCKING_OPTIONS,
      enabled: true,
      duckVolume: 0.18, // -15 dB
      attackS: 0.20,
      releaseS: 0.50,
    },
    voiceEnhance: true,
  },
  'cinematic': {
    preset: 'cinematic',
    master: { volume: 1.0, muted: false, solo: false, pan: 0 },
    voice:  { volume: 0.95, muted: false, solo: false, pan: 0, ducking: false },
    music:  { volume: 0.80, muted: false, solo: false, pan: 0, ducking: true },
    sfx:    { volume: 0.85, muted: false, solo: false, pan: 0, ducking: false },
    broll:  { volume: 0.50, muted: false, solo: false, pan: 0, ducking: true },
    ducking: {
      ...DEFAULT_DUCKING_OPTIONS,
      enabled: true,
      duckVolume: 0.32, // -10 dB
      attackS: 0.35,
      releaseS: 0.80,
    },
    voiceEnhance: false,
  },
  'music_forward': {
    preset: 'music_forward',
    master: { volume: 1.0, muted: false, solo: false, pan: 0 },
    voice:  { volume: 0.90, muted: false, solo: false, pan: 0, ducking: false },
    music:  { volume: 0.95, muted: false, solo: false, pan: 0, ducking: true },
    sfx:    { volume: 0.70, muted: false, solo: false, pan: 0, ducking: false },
    broll:  { volume: 0.40, muted: false, solo: false, pan: 0, ducking: true },
    ducking: {
      ...DEFAULT_DUCKING_OPTIONS,
      enabled: true,
      duckVolume: 0.45, // -7 dB
      attackS: 0.40,
      releaseS: 0.70,
    },
    voiceEnhance: false,
  },
  'clean': {
    preset: 'clean',
    master: { volume: 1.0, muted: false, solo: false, pan: 0 },
    voice:  { volume: 1.0, muted: false, solo: false, pan: 0, ducking: false },
    music:  { volume: 0.75, muted: false, solo: false, pan: 0, ducking: false },
    sfx:    { volume: 0.75, muted: false, solo: false, pan: 0, ducking: false },
    broll:  { volume: 0.50, muted: false, solo: false, pan: 0, ducking: false },
    ducking: {
      ...DEFAULT_DUCKING_OPTIONS,
      enabled: false,
    },
    voiceEnhance: false,
  },
};

/**
 * Apply soft-knee limiter to prevent digital clipping when summing tracks.
 */
export function softLimit(sample: number, threshold = 0.92): number {
  const abs = Math.abs(sample);
  if (abs <= threshold) return sample;
  const sign = Math.sign(sample);
  // Soft saturation compression above threshold
  const excess = abs - threshold;
  const compressed = threshold + (1 - threshold) * Math.tanh(excess / (1 - threshold));
  return sign * Math.min(0.999, compressed);
}

/**
 * Calculate effective gain for a track type at a specific timeline instant `t`.
 */
export function getEffectiveTrackGain(
  track: TrackType,
  timeS: number,
  config: MultiTrackMixerConfig,
  speechSegments: SpeechSegment[] = [],
): number {
  if (config.master.muted) return 0;

  const hasSolo = config.voice.solo || config.music.solo || config.sfx.solo || config.broll.solo;

  const ch = track === 'voice' ? config.voice
           : track === 'music' ? config.music
           : track === 'sfx'   ? config.sfx
           : track === 'broll' ? config.broll
           : config.master;

  if (ch.muted) return 0;
  if (hasSolo && !ch.solo) return 0;

  let gain = ch.volume * config.master.volume;

  // Apply ducking if enabled on this track and globally
  if (config.ducking.enabled && ch.ducking && speechSegments.length > 0) {
    const duckFactor = getDuckingGainAt(timeS, speechSegments, config.ducking);
    gain *= duckFactor;
  }

  // Voice enhance boost
  if (track === 'voice' && config.voiceEnhance) {
    gain *= 1.08;
  }

  return Number(Math.max(0, gain).toFixed(4));
}

/**
 * Mix multiple PCM audio channels into a unified stereo or mono output buffer.
 */
export function mixdownPcmTracks(
  tracks: {
    voice?: Float32Array;
    music?: Float32Array;
    sfx?: Float32Array;
    broll?: Float32Array;
  },
  sampleRate: number,
  config: MultiTrackMixerConfig,
  speechSegments: SpeechSegment[] = [],
): Float32Array {
  const maxLen = Math.max(
    tracks.voice?.length ?? 0,
    tracks.music?.length ?? 0,
    tracks.sfx?.length ?? 0,
    tracks.broll?.length ?? 0,
  );

  if (maxLen === 0) return new Float32Array(0);

  const out = new Float32Array(maxLen);
  const dt = 1 / sampleRate;

  for (let i = 0; i < maxLen; i++) {
    const t = i * dt;

    const voiceGain = tracks.voice ? getEffectiveTrackGain('voice', t, config, speechSegments) : 0;
    const musicGain = tracks.music ? getEffectiveTrackGain('music', t, config, speechSegments) : 0;
    const sfxGain   = tracks.sfx   ? getEffectiveTrackGain('sfx',   t, config, speechSegments) : 0;
    const brollGain = tracks.broll ? getEffectiveTrackGain('broll', t, config, speechSegments) : 0;

    const sVoice = tracks.voice && i < tracks.voice.length ? tracks.voice[i] * voiceGain : 0;
    const sMusic = tracks.music && i < tracks.music.length ? tracks.music[i] * musicGain : 0;
    const sSfx   = tracks.sfx   && i < tracks.sfx.length   ? tracks.sfx[i] * sfxGain   : 0;
    const sBroll = tracks.broll && i < tracks.broll.length ? tracks.broll[i] * brollGain : 0;

    const sum = (sVoice + sMusic + sSfx + sBroll) * config.master.volume;
    out[i] = softLimit(sum);
  }

  return out;
}
