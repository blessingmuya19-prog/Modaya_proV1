/**
 * Style analysis and transfer.
 *
 * The reference frames here are synthetic but built to a known style — a fixed
 * cut every 2s, a warm saturated look — so the profile can be checked against
 * ground truth rather than against itself.
 */
import { describe, it, expect } from 'vitest';
import {
  histDistance, detectCuts, shotLengths, paceOf, detectOnsets, estimateBpm,
  isBeatSynced, buildStyleProfile, describeStyle, captionTransition, FrameSample,
} from '@/lib/ai/styleProfile';
import { planCutPoints, generateEditPlan } from '@/lib/ai/styleTransfer';

/** A frame whose histogram is a single spike at `bin`. */
function frameAt(t: number, bin: number, extra: Partial<FrameSample> = {}): FrameSample {
  const hist = new Array(16).fill(0);
  hist[bin] = 1;
  return {
    t, hist, luma: bin / 15, sat: 0.5, warmth: 0, detail: 0.1, lowerDetail: 0.1, ...extra,
  };
}

/** 20s of footage, 4 samples/sec, with a hard cut every 2s. */
function referenceFrames(cutEveryS = 2, durationS = 20, fps = 4): FrameSample[] {
  const out: FrameSample[] = [];
  for (let i = 0; i < durationS * fps; i++) {
    const t = i / fps;
    const shot = Math.floor(t / cutEveryS);
    out.push(frameAt(t, shot % 2 === 0 ? 3 : 12));   // alternate dark / bright shots
  }
  return out;
}

describe('cut detection', () => {
  it('measures histogram distance', () => {
    const a = frameAt(0, 2).hist, b = frameAt(0, 2).hist, c = frameAt(0, 14).hist;
    expect(histDistance(a, b)).toBe(0);
    expect(histDistance(a, c)).toBeGreaterThan(0.5);
  });

  it('finds the cuts in footage cut every 2 seconds', () => {
    const cuts = detectCuts(referenceFrames(2, 20));
    expect(cuts.length).toBeGreaterThanOrEqual(8);
    expect(cuts.length).toBeLessThanOrEqual(10);
    // every detected cut should sit on a 2s boundary (±1 sample)
    for (const c of cuts) expect(Math.abs(c % 2)).toBeLessThanOrEqual(0.26);
  });

  it('does not invent cuts in a static shot', () => {
    const still = Array.from({ length: 80 }, (_, i) => frameAt(i / 4, 7));
    expect(detectCuts(still)).toHaveLength(0);
  });

  it('ignores retriggers within 250ms', () => {
    const frames = [frameAt(0, 2), frameAt(0.05, 14), frameAt(0.1, 2), frameAt(0.15, 14)];
    expect(detectCuts(frames).length).toBeLessThanOrEqual(1);
  });

  it('derives shot lengths and pace', () => {
    expect(shotLengths([2, 4, 6], 8)).toEqual([2, 2, 2, 2]);
    expect(paceOf(35)).toBe('very fast');
    expect(paceOf(20)).toBe('fast');
    expect(paceOf(8)).toBe('medium');
    expect(paceOf(2)).toBe('relaxed');
  });
});

describe('audio', () => {
  const hopS = 0.05;
  // a click every 0.5s → 120 BPM
  const rms = Array.from({ length: 400 }, (_, i) => (i % 10 === 0 ? 1 : 0.05));

  it('detects onsets', () => {
    const on = detectOnsets(rms, hopS);
    expect(on.length).toBeGreaterThan(20);
  });

  it('estimates BPM from onset spacing', () => {
    expect(estimateBpm(detectOnsets(rms, hopS))).toBe(120);
  });

  it('recognises beat-synced cutting', () => {
    const onsets = Array.from({ length: 40 }, (_, i) => i * 0.5);
    const onBeat  = [0.5, 1.0, 2.0, 3.5, 4.0, 5.0];
    const offBeat = [0.72, 1.31, 2.24, 3.79, 4.18, 5.61];
    expect(isBeatSynced(onBeat, onsets)).toBe(true);
    expect(isBeatSynced(offBeat, onsets)).toBe(false);
  });
});

describe('style profile', () => {
  const profile = buildStyleProfile({
    sourceName: 'ref.mp4',
    durationS:  20,
    frames:     referenceFrames(2, 20).map(f => ({ ...f, sat: 0.8, warmth: 0.25 })),
    audio:      null,
  });

  it('recovers the reference pace', () => {
    expect(profile.cutsPerMin).toBeGreaterThan(20);
    expect(profile.shotMeanS).toBeGreaterThan(1.4);
    expect(profile.shotMeanS).toBeLessThan(2.6);
    expect(profile.pace === 'fast' || profile.pace === 'very fast').toBe(true);
  });

  it('reads the grade off the footage', () => {
    expect(profile.grade.saturation).toBeGreaterThan(1.1);   // saturated reference
    expect(profile.grade.warmth).toBeGreaterThan(0.1);       // warm reference
  });

  it('flags burned-in captions only when the lower third is busy', () => {
    const withCaps = buildStyleProfile({
      sourceName: 'c.mp4', durationS: 20,
      frames: referenceFrames(2, 20).map(f => ({ ...f, detail: 0.1, lowerDetail: 0.4 })),
    });
    expect(withCaps.captions.present).toBe(true);
    expect(profile.captions.present).toBe(false);
  });

  it('describes the style in words', () => {
    const text = describeStyle(profile);
    expect(text).toMatch(/cuts\/min/);
    expect(text.length).toBeGreaterThan(20);
  });

  it('detects caption transitions when the lower third pulses', () => {
    /* Captions on/off between shots: lowerDetail jumps between 0.08 (off)
       and 0.42 (on) — that motion is the transition. */
    const moving = Array.from({ length: 16 }, (_, i) =>
      frameAt(i / 4, 5, { detail: 0.1, lowerDetail: i % 2 ? 0.42 : 0.08 }));
    const look = captionTransition(moving);
    expect(look.animated).toBe(true);

    /* A steady burn-in holds the same lower band — no transition. */
    const still = Array.from({ length: 16 }, (_, i) =>
      frameAt(i / 4, 5, { detail: 0.1, lowerDetail: 0.4 }));
    expect(captionTransition(still).animated).toBe(false);
  });

  it('carries the dominant caption-band colour as the highlight', () => {
    const frames = Array.from({ length: 16 }, (_, i) =>
      frameAt(i / 4, 5, {
        detail: 0.1, lowerDetail: i % 2 ? 0.42 : 0.08,
        lowerColour: i % 3 === 0 ? '#22c55e' : '#facc15',   // green 6, yellow 10
      }));
    expect(captionTransition(frames)).toMatchObject({ animated: true, highlightColour: '#facc15' });
  });

  it('records animated captions plus their highlight in the profile', () => {
    const withMovingCaps = buildStyleProfile({
      sourceName: 'c.mp4', durationS: 20,
      frames: Array.from({ length: 80 }, (_, i) =>
        frameAt(i / 4, 5, {
          detail: 0.1, lowerDetail: i % 2 ? 0.42 : 0.08,
          lowerColour: '#facc15',
        })),
    });
    expect(withMovingCaps.captions.present).toBe(true);
    expect(withMovingCaps.captions.animated).toBe(true);
    expect(withMovingCaps.captions.highlightColour).toBe('#facc15');

    const withStaticCaps = buildStyleProfile({
      sourceName: 'c.mp4', durationS: 20,
      frames: Array.from({ length: 80 }, (_, i) =>
        frameAt(i / 4, 5, { detail: 0.1, lowerDetail: 0.4 })),
    });
    expect(withStaticCaps.captions.present).toBe(true);
    expect(withStaticCaps.captions.animated).toBeUndefined();
  });
});

describe('style transfer', () => {
  const profile = buildStyleProfile({
    sourceName: 'ref.mp4', durationS: 20,
    frames: referenceFrames(2, 20), audio: null,
  });

  it('cuts the target at the reference cadence', () => {
    const points = planCutPoints(profile, 60, [], 42);
    expect(points.length).toBeGreaterThan(10);
    const gaps = points.slice(1).map((p, i) => p - points[i]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(0.8);
    expect(mean).toBeLessThan(4);
  });

  it('snaps cuts to the beat when the reference is beat-synced', () => {
    const onsets = Array.from({ length: 120 }, (_, i) => Number((i * 0.5).toFixed(3)));
    const synced = { ...profile, beatSynced: true };
    const points = planCutPoints(synced, 60, onsets, 7);
    const onBeat = points.filter(p => onsets.some(o => Math.abs(o - p) < 0.01));
    expect(onBeat.length / points.length).toBeGreaterThan(0.6);
  });

  it('is deterministic for the same inputs', () => {
    const a = generateEditPlan({ profile, durationS: 60, seed: 3 });
    const b = generateEditPlan({ profile, durationS: 60, seed: 3 });
    expect(a.clips.map(c => c.id + c.startS)).toEqual(b.clips.map(c => c.id + c.startS));
  });

  it('produces a gapless programme that is shorter than the original', () => {
    const plan = generateEditPlan({ profile, durationS: 60, seed: 5 });
    const video = plan.clips.filter(c => c.type === 'video');
    expect(video.length).toBeGreaterThan(3);
    expect(plan.durationS).toBeLessThan(60);
    expect(plan.removedS).toBeGreaterThan(0);
    // laid end to end, no holes
    video.slice(1).forEach((c, i) => expect(c.startS).toBeCloseTo(video[i].endS, 3));
  });

  it('keeps each clip pointing at real source footage', () => {
    const plan = generateEditPlan({ profile, durationS: 60, seed: 9 });
    for (const c of plan.clips.filter(v => v.type === 'video')) {
      expect(c.sourceIn).toBeGreaterThanOrEqual(0);
      expect(c.sourceIn).toBeLessThan(60);
    }
  });

  it('applies the reference grade to every shot', () => {
    const plan = generateEditPlan({ profile, durationS: 30, seed: 2 });
    for (const c of plan.clips.filter(v => v.type === 'video')) {
      expect(c.effects.saturation).toBe(profile.grade.saturation);
      expect(c.effects.contrast).toBe(profile.grade.contrast);
    }
  });

  it('adds captions only when the reference burns them in', () => {
    const withCaps = { ...profile, captions: { present: true, position: 'lower' as const, emphasis: 0.8 } };
    const plan = generateEditPlan({ profile: withCaps, durationS: 40, seed: 4 });
    expect(plan.clips.some(c => c.type === 'text')).toBe(true);
    const plain = generateEditPlan({ profile, durationS: 40, seed: 4 });
    expect(plain.clips.some(c => c.type === 'text')).toBe(false);
  });

  it('a relaxed reference keeps nearly all the footage', () => {
    const calm = { ...profile, energy: 0.1 };
    const plan = generateEditPlan({ profile: calm, durationS: 60, seed: 11 });
    expect(plan.durationS).toBeGreaterThan(60 * 0.8);   // barely trimmed
  });

  it('an energetic reference drops the quiet sections', () => {
    const punchy   = { ...profile, energy: 0.95 };
    const interest = Array.from({ length: 60 }, (_, s) => (s < 20 ? 0.95 : 0.05));
    const plan = generateEditPlan({ profile: punchy, durationS: 60, interest, seed: 11 });
    const fromLoudHalf = plan.clips
      .filter(c => c.type === 'video')
      .filter(c => c.sourceIn < 20).length;
    const total = plan.clips.filter(c => c.type === 'video').length;
    expect(fromLoudHalf / total).toBeGreaterThan(0.5);
  });
});

describe('style reaches the renderer', () => {
  it('a styled plan drives sourceIn, push-in and grade in the sequence', async () => {
    const { buildSequence, videoClipAt, sourceTimeFor } = await import('@/lib/render/sequence');
    const profile = buildStyleProfile({
      sourceName: 'ref.mp4', durationS: 20,
      frames: referenceFrames(2, 20), audio: null,
    });
    // a reference with camera movement in it, so the style includes push-ins
    const punchy = { ...profile, energy: 0.9, punchInRate: 0.8, punchInMax: 1.15 };
    const plan = generateEditPlan({ profile: punchy, durationS: 60, seed: 12 });

    const seq = buildSequence(
      plan.clips.map(c => ({
        id: c.id, trackId: c.trackId, label: c.label,
        startS: c.startS, endS: c.endS, type: c.type,
      })),
      {
        durationS: plan.durationS, width: 1920, height: 1080, sourceId: 'p1',
        style: Object.fromEntries(plan.clips.map(c => [
          c.id, { sourceIn: c.sourceIn, transform: c.transform, effects: c.effects },
        ])),
      },
    );

    // A ripple edit: programme time is continuous, source time jumps
    const second = plan.clips.filter(c => c.type === 'video')[1];
    const clip = videoClipAt(seq, second.startS + 0.1)!;
    expect(clip.sourceIn).toBe(second.sourceIn);
    expect(sourceTimeFor(clip, second.startS + 0.1)).toBeCloseTo(second.sourceIn + 0.1, 3);
    // dropped segments mean later clips read from further into the file than
    // their timeline position — that is the ripple
    const rippled = seq.clips.filter(c => c.kind === 'video' && c.sourceIn > c.timelineIn + 0.01);
    expect(rippled.length).toBeGreaterThan(0);

    // grade + push-ins survived into the render layer
    expect(clip.effects.saturation).toBe(profile.grade.saturation);
    const scales = seq.clips.filter(c => c.kind === 'video').map(c => c.transform.scale);
    expect(Math.max(...scales)).toBeGreaterThan(1);
  });
});
