import { describe, it, expect } from 'vitest';
import {
  synthesizeSfxPcm,
  detectMusicBeats,
  generateEditSoundCues,
  DEFAULT_SFX_CONFIG,
} from '@/lib/audio/sfxEngine';

describe('procedural sound effects (SFX) & beat-synced audio cues', () => {
  it('synthesizes procedural PCM waveforms for all SFX types without crashing', () => {
    const sfxTypes = ['whoosh', 'pop', 'impact', 'riser', 'click', 'ding'] as const;

    for (const type of sfxTypes) {
      const pcm = synthesizeSfxPcm(type, 44100, { volume: 0.8 });
      expect(pcm).toBeInstanceOf(Float32Array);
      expect(pcm.length).toBeGreaterThan(100);

      // Verify PCM values are valid finite numbers in [-1, 1] range
      let maxAmp = 0;
      for (let i = 0; i < pcm.length; i++) {
        expect(Number.isFinite(pcm[i])).toBe(true);
        maxAmp = Math.max(maxAmp, Math.abs(pcm[i]));
      }
      expect(maxAmp).toBeGreaterThan(0.01);
      expect(maxAmp).toBeLessThanOrEqual(1.2);
    }
  });

  it('detects music beat transients and estimates tempo (BPM)', () => {
    const sampleRate = 44100;
    const durationS = 4.0;
    const pcm = new Float32Array(sampleRate * durationS);

    // Create synthetic 120 BPM beats (every 0.5s = 500ms)
    for (let beat = 0; beat < 8; beat++) {
      const beatStartSample = Math.floor(beat * 0.5 * sampleRate);
      for (let i = 0; i < 2000; i++) {
        const t = i / 2000;
        pcm[beatStartSample + i] = Math.sin(2 * Math.PI * 80 * t) * (1 - t);
      }
    }

    const { beatTimestampsS, estimatedBpm } = detectMusicBeats(pcm, sampleRate);
    expect(beatTimestampsS.length).toBeGreaterThanOrEqual(6);
    expect(estimatedBpm).toBeGreaterThanOrEqual(110);
    expect(estimatedBpm).toBeLessThanOrEqual(130);
  });

  it('automatically maps sound design cues to cuts, zooms, and title reveals', () => {
    const clips = [
      { id: 'v1', type: 'video', startS: 0.0, endS: 5.0, transform: { scale: 1.0 } },
      // Cut at 5.0s with punch-in zoom (scale 1.3)
      { id: 'v2', type: 'video', startS: 5.0, endS: 10.0, transform: { scale: 1.3 } },
      // Text reveal at 2.0s
      { id: 't1', type: 'text', startS: 2.0, endS: 6.0 },
    ];

    const cues = generateEditSoundCues(clips);
    expect(cues.length).toBeGreaterThanOrEqual(3);

    const whooshCue = cues.find(c => c.type === 'whoosh');
    expect(whooshCue).toBeDefined();
    expect(whooshCue?.timelineS).toBeCloseTo(4.92, 1);

    const impactCue = cues.find(c => c.type === 'impact');
    expect(impactCue).toBeDefined();
    expect(impactCue?.timelineS).toBe(5.0);

    const popCue = cues.find(c => c.type === 'pop');
    expect(popCue).toBeDefined();
    expect(popCue?.timelineS).toBe(2.0);
  });
});
