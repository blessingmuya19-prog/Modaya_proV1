import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DUCKING_OPTIONS,
  mergeSpeechSegments,
  speechSegmentsFromTranscript,
  detectSpeechFromPcm,
  getDuckingGainAt,
  generateDuckingKeyframes,
  applyDuckingToPcmBuffer,
  type SpeechSegment,
} from '@/lib/audio/ducking';

describe('audio ducking - speech segment processing', () => {
  it('merges overlapping and adjacent speech segments within minGapS', () => {
    const raw: SpeechSegment[] = [
      { startS: 1.0, endS: 3.0, text: 'Hello' },
      { startS: 3.2, endS: 5.0, text: 'world' }, // gap is 0.2s <= 0.35s default
      { startS: 8.0, endS: 10.0, text: 'next phrase' },
    ];

    const merged = mergeSpeechSegments(raw, 0.35);
    expect(merged).toHaveLength(2);
    expect(merged[0].startS).toBe(1.0);
    expect(merged[0].endS).toBe(5.0);
    expect(merged[0].text).toBe('Hello world');
    expect(merged[1].startS).toBe(8.0);
    expect(merged[1].endS).toBe(10.0);
  });

  it('extracts speech segments correctly from timed transcript', () => {
    const transcript = {
      segments: [
        { startS: 0.5, endS: 2.5, text: 'First line of speech' },
        { startS: 2.6, endS: 4.0, text: 'Second line' },
        { startS: 7.0, endS: 9.0, text: 'Third line' },
      ],
    };

    const segments = speechSegmentsFromTranscript(transcript);
    expect(segments).toHaveLength(2);
    expect(segments[0].startS).toBe(0.5);
    expect(segments[0].endS).toBe(4.0);
    expect(segments[1].startS).toBe(7.0);
    expect(segments[1].endS).toBe(9.0);
  });

  it('detects speech segments from raw PCM samples using energy thresholding', () => {
    const sampleRate = 16000;
    const durationS = 4;
    const samples = new Float32Array(sampleRate * durationS);

    // Add quiet background noise throughout
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (Math.random() - 0.5) * 0.005;
    }

    // Add active speech signal between 1.0s and 2.5s (loud sine wave)
    const speechStart = 1.0 * sampleRate;
    const speechEnd = 2.5 * sampleRate;
    for (let i = speechStart; i < speechEnd; i++) {
      samples[i] += Math.sin((i / sampleRate) * 2 * Math.PI * 300) * 0.4;
    }

    const detected = detectSpeechFromPcm(samples, sampleRate, {
      windowMs: 30,
      thresholdRms: 0.05,
    });

    expect(detected.length).toBeGreaterThanOrEqual(1);
    expect(detected[0].startS).toBeCloseTo(1.0, 1);
    expect(detected[0].endS).toBeCloseTo(2.5, 1);
  });
});

describe('audio ducking - gain curve and envelope calculations', () => {
  const speech: SpeechSegment[] = [
    { startS: 2.0, endS: 5.0 },
  ];

  const opts = {
    duckVolume: 0.20,
    normalVolume: 1.0,
    attackS: 0.25,
    holdS: 0.20,
    releaseS: 0.60,
  };

  it('returns normal volume well before speech onset', () => {
    const gain = getDuckingGainAt(1.0, speech, opts);
    expect(gain).toBe(1.0);
  });

  it('smoothly ramps down during attack window before speech starts', () => {
    // Attack starts at 2.0 - 0.25 = 1.75s
    const gainBeforeAttack = getDuckingGainAt(1.70, speech, opts);
    const gainMidAttack = getDuckingGainAt(1.875, speech, opts);
    const gainAtSpeech = getDuckingGainAt(2.0, speech, opts);

    expect(gainBeforeAttack).toBe(1.0);
    expect(gainMidAttack).toBeGreaterThan(0.20);
    expect(gainMidAttack).toBeLessThan(1.0);
    expect(gainAtSpeech).toBe(0.20);
  });

  it('maintains ducked volume throughout active speech and hold duration', () => {
    expect(getDuckingGainAt(3.0, speech, opts)).toBe(0.20);
    expect(getDuckingGainAt(5.0, speech, opts)).toBe(0.20); // end of speech
    expect(getDuckingGainAt(5.15, speech, opts)).toBe(0.20); // inside 200ms hold window
  });

  it('smoothly releases back to normal volume after hold window expires', () => {
    // Hold ends at 5.0 + 0.20 = 5.20s. Release ends at 5.20 + 0.60 = 5.80s
    const gainMidRelease = getDuckingGainAt(5.50, speech, opts);
    const gainAfterRelease = getDuckingGainAt(6.0, speech, opts);

    expect(gainMidRelease).toBeGreaterThan(0.20);
    expect(gainMidRelease).toBeLessThan(1.0);
    expect(gainAfterRelease).toBe(1.0);
  });

  it('generates accurate discrete automation keyframes across timeline', () => {
    const keyframes = generateDuckingKeyframes(speech, 10, opts);
    expect(keyframes.length).toBeGreaterThanOrEqual(4);

    expect(keyframes[0].timeS).toBe(0);
    expect(keyframes[0].gain).toBe(1.0);

    const duckStart = keyframes.find(k => k.type === 'duck_start');
    expect(duckStart).toBeDefined();
    expect(duckStart?.gain).toBe(0.20);

    const duckHold = keyframes.find(k => k.type === 'duck_hold');
    expect(duckHold).toBeDefined();
    expect(duckHold?.gain).toBe(0.20);

    const release = keyframes.find(k => k.type === 'release');
    expect(release).toBeDefined();
    expect(release?.gain).toBe(1.0);
  });

  it('applies ducking attenuation to PCM audio buffers accurately', () => {
    const sampleRate = 1000;
    const durationS = 8;
    const musicPcm = new Float32Array(sampleRate * durationS);
    musicPcm.fill(0.5); // constant 0.5 amplitude

    const ducked = applyDuckingToPcmBuffer(musicPcm, sampleRate, speech, opts);
    expect(ducked.length).toBe(musicPcm.length);

    // At 1s (before speech): gain = 1.0 => output = 0.5
    expect(ducked[1000]).toBeCloseTo(0.5, 2);

    // At 3.5s (during speech): gain = 0.20 => output = 0.5 * 0.20 = 0.10
    expect(ducked[3500]).toBeCloseTo(0.10, 2);

    // At 7s (after release): gain = 1.0 => output = 0.5
    expect(ducked[7000]).toBeCloseTo(0.5, 2);
  });
});
