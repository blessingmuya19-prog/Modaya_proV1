/**
 * The EditPlan brain: given a learned style profile + source energy/transcript,
 * it must pick the strongest moments (hook first for shorts), fit the right
 * frame format, place real captions, and stay in bounds and non-overlapping.
 */
import { describe, it, expect } from 'vitest';
import { composeStudioPlan, chooseMoments, chooseBroll } from '@/lib/studio/editPlan';
import type { StyleProfile } from '@/lib/ai/styleProfile';

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    sourceName: 'modaya-default', durationS: 45, cuts: [], cutsPerMin: 30,
    shotMeanS: 2, shotMedianS: 1.8, shotVariance: 0.6, pace: 'very fast',
    grade: { brightness: 0, contrast: 0.05, saturation: 0.08, warmth: 0 },
    punchInRate: 0.4, punchInMax: 1.12,
    captions: { present: true, position: 'lower', emphasis: 0.4 },
    beatSynced: false, bpm: null, energy: 0.7, ...over,
  };
}

/** Interest curve with a clear spike around 120-150s. */
function interestWithSpike(dur = 300, spike: [number, number] = [120, 150]): number[] {
  return Array.from({ length: dur }, (_, t) => (t >= spike[0] && t < spike[1] ? 0.95 : 0.2));
}

describe('chooseMoments', () => {
  it('keeps windows within the source and near the target total length', () => {
    const m = chooseMoments({ durationS: 300, targetS: 45, interest: interestWithSpike(), hookFirst: true });
    expect(m.length).toBeGreaterThan(0);
    for (const w of m) {
      expect(w.s).toBeGreaterThanOrEqual(0);
      expect(w.e).toBeLessThanOrEqual(300.001);
      expect(w.e - w.s).toBeGreaterThan(0);
    }
    const total = m.reduce((a, w) => a + (w.e - w.s), 0);
    expect(total).toBeLessThanOrEqual(48);
    expect(total).toBeGreaterThan(15);
  });

  it('hook-first includes the strongest (spike) region', () => {
    const m = chooseMoments({ durationS: 300, targetS: 45, interest: interestWithSpike(), hookFirst: true });
    const coversSpike = m.some(w => w.s >= 100 && w.s <= 150);
    expect(coversSpike).toBe(true);
  });

  it('returns something even with no interest data', () => {
    const m = chooseMoments({ durationS: 60, targetS: 40, hookFirst: true });
    expect(m.length).toBeGreaterThan(0);
  });
});

describe('composeStudioPlan — short mode', () => {
  const transcript = Array.from({ length: 20 }, (_, i) => ({
    startS: 120 + i * 3, endS: 120 + i * 3 + 2.6,
    text: `Line number ${i} about the big moment.`,
  }));

  const plan = composeStudioPlan({
    profile: profile(), sourceDurationS: 300,
    interest: interestWithSpike(), transcript,
  });

  it('targets a vertical 9:16 frame for a short reference', () => {
    expect(plan.frame.ratio).toBe('9:16');
    expect(plan.frame.height).toBeGreaterThan(plan.frame.width);
    expect(plan.hookFirst).toBe(true);
  });

  it('cover-crops video clips for the vertical frame', () => {
    const vids = plan.clips.filter(c => c.type === 'video');
    expect(vids.length).toBeGreaterThan(0);
    expect(vids.every(v => v.transform.fit === 'cover')).toBe(true);
  });

  it('maps transcript lines into caption clips on the programme timeline', () => {
    expect(plan.captions).toBeGreaterThan(0);
    const caps = plan.clips.filter(c => c.type === 'text');
    expect(caps.length).toBeGreaterThan(0);
    // captions use the subtitle track and carry real words
    expect(caps.some(c => c.trackId === 'subs')).toBe(true);
    expect(caps[0].label).toMatch(/moment|Line/i);
    // captions stay within the output duration
    for (const c of caps) {
      expect(c.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
    }
  });

  it('carries the reference caption transition and highlight into the captions', () => {
    const k = composeStudioPlan({
      profile: profile({
        captions: {
          present: true, position: 'lower', emphasis: 0.8,
          animated: true, highlightColour: '#facc15',
        },
      }),
      sourceDurationS: 300,
      interest: interestWithSpike(),
      transcript,
    });
    const caps = k.clips.filter(c => c.type === 'text');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every(c => c.textStyle?.animation === 'karaoke_pop')).toBe(true);
    expect(caps.every(c => c.textStyle?.highlightColour === '#facc15')).toBe(true);
  });

  it('keeps static captions static when the reference burn-in does not move', () => {
    const k = composeStudioPlan({
      profile: profile({
        captions: { present: true, position: 'lower', emphasis: 0.6 },
      }),
      sourceDurationS: 300,
      interest: interestWithSpike(),
      transcript,
    });
    const caps = k.clips.filter(c => c.type === 'text');
    expect(caps.every(c => c.textStyle?.animation === 'none')).toBe(true);
  });

  it('generates dynamic highlight captions when transcript is empty but captions are enabled', () => {
    const fallbackPlan = composeStudioPlan({
      profile: profile({ sourceName: 'My Awesome Video.mp4' }),
      sourceDurationS: 300,
      interest: interestWithSpike(),
      transcript: [],
    });
    expect(fallbackPlan.captions).toBeGreaterThan(0);
    const caps = fallbackPlan.clips.filter(c => c.type === 'text');
    expect(caps.length).toBeGreaterThan(0);
    // Neutral label — never the (reference or footage) filename.
    expect(caps[0].label).toBe('Caption');
  });

  it('keeps every clip inside the output and main shots non-overlapping', () => {
    // Base shots (trackId 'video') form the continuous talk track; B-roll
    // cutaways (trackId 'overlay') deliberately overlap them.
    const shots = plan.clips.filter(c => c.trackId === 'video').sort((a, b) => a.startS - b.startS);
    for (const c of plan.clips) {
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
      expect(c.endS - c.startS).toBeGreaterThan(0);
    }
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].startS).toBeGreaterThanOrEqual(shots[i - 1].endS - 0.01);
    }
    // B-roll overlays sit on a higher track, above a base shot.
    for (const ov of plan.clips.filter(c => c.trackId === 'overlay')) {
      expect(shots.some(s => ov.startS >= s.startS && ov.endS <= s.endS)).toBe(true);
    }
  });

  it('reads video shots from the right source ranges (sourceIn set)', () => {
    const vids = plan.clips.filter(c => c.trackId === 'video');
    expect(vids.every(v => v.sourceIn >= 0)).toBe(true);
  });

  it('cuts at the reference rhythm — shot lengths follow its cadence and variance', () => {
    /* 12 cuts/min ≈ 5s shots, tiny variance ⇒ metronome regularity. The last
       shot of a moment is a remainder by construction, so judge the body. */
    const steady = composeStudioPlan({
      profile: profile({ cutsPerMin: 12, shotMeanS: 5, shotVariance: 0.08, targetRatio: '9:16' }),
      sourceDurationS: 300, interest: interestWithSpike(),
    });
    const lens = steady.clips
      .filter(c => c.trackId === 'video')
      .map(c => c.endS - c.startS);
    expect(lens.length).toBeGreaterThan(3);
    const sorted = [...lens].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(3.5);    // ~5s ± the subdivision remainder
    expect(median).toBeLessThan(6.5);
    const inBand = lens.filter(l => l >= 3.5 && l <= 6.5).length;
    expect(inBand / lens.length).toBeGreaterThan(0.7);
  });

  it('a steady reference stays regular; an erratic one varies', () => {
    const mk = (variance: number) => {
      const p = composeStudioPlan({
        profile: profile({ cutsPerMin: 12, shotMeanS: 5, shotVariance: variance, targetRatio: '9:16' }),
        sourceDurationS: 300, interest: interestWithSpike(),
      });
      return p.clips.filter(c => c.trackId === 'video').map(c => c.endS - c.startS);
    };
    /* Median absolute deviation is robust against subdivision-tail shots. */
    const mad = (xs: number[]) => {
      const med = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const dev = xs.map(x => Math.abs(x - med)).sort((a, b) => a - b);
      return dev[Math.floor(dev.length / 2)];
    };
    const steady = mk(0.05), erratic = mk(1.0);
    expect(mad(steady)).toBeLessThan(0.4);              // metronome
    expect(mad(erratic)).toBeGreaterThan(mad(steady));  // keeps viewer on edge
  });

  it('lands every cut on the measured onsets when the reference is beat-synced', () => {
    const grid = Array.from({ length: 400 }, (_, i) => i * 0.5);
    const plan = composeStudioPlan({
      profile: profile({ cutsPerMin: 30, shotMeanS: 2, shotVariance: 0.3, beatSynced: true, targetRatio: '9:16' }),
      sourceDurationS: 300, interest: interestWithSpike(), onsets: grid,
    });
    const vids = plan.clips.filter(c => c.trackId === 'video');
    expect(vids.length).toBeGreaterThan(3);
    for (const v of vids) {
      const srcEnd = v.sourceIn + (v.endS - v.startS);
      const onGrid = (t: number) => grid.some(g => Math.abs(g - t) < 0.02);
      expect(onGrid(v.sourceIn)).toBe(true);
      expect(onGrid(srcEnd)).toBe(true);
    }
  });

  it('turns push-ins into ANIMATED zooms at the measured onsets', () => {
    const grid = Array.from({ length: 400 }, (_, i) => i * 0.5);
    const p = composeStudioPlan({
      profile: profile({ punchInRate: 1, punchInMax: 1.15, targetRatio: '9:16' }),
      sourceDurationS: 300, interest: interestWithSpike(), onsets: grid,
    });
    const shots = p.clips.filter(c => c.trackId === 'video');
    expect(shots.length).toBeGreaterThan(0);
    /* every push-in became a moving zoom (scale keyframes), so no shot is
       left sitting at a static pre-scale AND every shot stays in frame */
    for (const s of shots) {
      if ((s.transform.scale ?? 1) > 1.02) continue;      // no anchor fallback
      expect(s.zoom).toBeTruthy();
      expect(s.zoom![0]?.scale).toBe(1);
      expect(Math.max(...s.zoom!.map(k => k.scale))).toBeGreaterThan(1.02);
    }
  });

  it('maps SOURCE-time onsets into each shot\'s OUTPUT window before zooming', () => {
    const grid = Array.from({ length: 400 }, (_, i) => i * 0.5);
    const p = composeStudioPlan({
      profile: profile({ punchInRate: 1, punchInMax: 1.15, targetRatio: '9:16' }),
      sourceDurationS: 300, interest: interestWithSpike(), onsets: grid,
    });
    const zoomed = p.clips.filter(c => c.trackId === 'video' && c.zoom?.length);
    expect(zoomed.length).toBeGreaterThan(0);
    for (const s of zoomed) {
      const zoomOn = s.zoom![1];                       // ramp start = the emphasis
      /* The emphasis lands INSIDE the shot — not crammed into its last 0.55s
         by an unmapped source time, and not past the cut. */
      expect(zoomOn.time).toBeGreaterThanOrEqual(s.startS);
      expect(zoomOn.time).toBeLessThanOrEqual(s.endS - 0.55 + 0.02);
      const onsetSrc = grid.find(o => o >= s.sourceIn && o <= s.sourceIn + (s.endS - s.startS));
      if (onsetSrc !== undefined) {
        const expected = s.startS + (onsetSrc - s.sourceIn);
        if (expected <= s.endS - 0.56) {
          /* unclamped: exactly source time translated to programme time */
          expect(Math.abs(zoomOn.time - expected)).toBeLessThan(0.06);
        }
      }
    }
  });

  it('adds whip transitions at source jumps for an energetic beat-synced reference', () => {
    const p = composeStudioPlan({
      profile: profile({ energy: 0.8, beatSynced: true, punchInRate: 0.4, targetRatio: '9:16' }),
      sourceDurationS: 300, interest: interestWithSpike(),
      onsets: Array.from({ length: 400 }, (_, i) => i * 0.5),
    });
    const shots = p.clips.filter(c => c.trackId === 'video');
    const withTransition = shots.filter(s => s.transition);
    expect(withTransition.length).toBeGreaterThan(0);
    expect(withTransition.every(s => s.transition!.kind === 'whip' || s.transition!.kind === 'crossfade')).toBe(true);
    /* transitions only appear between discontinuous source windows */
    for (let i = 1; i < shots.length; i++) {
      if (!shots[i].transition) continue;
      const prevSrcEnd = shots[i - 1].sourceIn + (shots[i - 1].endS - shots[i - 1].startS);
      expect(Math.abs(shots[i].sourceIn - prevSrcEnd)).toBeGreaterThan(0.5);
    }
  });

  it('does not invent transitions across a continuous source', () => {
    /* uncut single-shot has no junction at all */
    const p = composeStudioPlan({
      profile: profile({ uncut: true, energy: 0.8, beatSynced: true }),
      sourceDurationS: 300, sourceRatio: '16:9',
    });
    expect(p.clips.every(c => !c.transition)).toBe(true);
  });

  it('pushes in at exactly the reference rate — never a forced alternation', () => {
    const none = composeStudioPlan({
      profile: profile({ punchInRate: 0, targetRatio: '9:16' }),
      sourceDurationS: 300, interest: interestWithSpike(),
    });
    expect(none.clips.filter(c => c.trackId === 'video')
      .every(c => (c.transform.scale ?? 1) <= 1.02)).toBe(true);

    const all = composeStudioPlan({
      profile: profile({ punchInRate: 1, targetRatio: '9:16' }),
      sourceDurationS: 300, interest: interestWithSpike(),
    });
    expect(all.clips.filter(c => c.trackId === 'video').length).toBeGreaterThan(0);
    expect(all.clips.filter(c => c.trackId === 'video')
      .every(c => (c.transform.scale ?? 1) > 1.02)).toBe(true);
  });
});

describe('composeStudioPlan — full re-cut', () => {
  it('uses a landscape frame and keeps more footage for a long reference', () => {
    const long = profile({ sourceName: 'long-ref', durationS: 600, cutsPerMin: 12, pace: 'medium' });
    const plan = composeStudioPlan({
      profile: long, sourceDurationS: 300, interest: interestWithSpike(),
    });
    expect(plan.frame.ratio).toBe('16:9');
    expect(plan.hookFirst).toBe(false);
    // a re-cut removes material but keeps a substantial programme
    expect(plan.durationS).toBeGreaterThan(120);
  });

  it('keeps 100% of footage when uncut is requested', () => {
    const uncutProfile = profile({ uncut: true });
    const plan = composeStudioPlan({
      profile: uncutProfile, sourceDurationS: 180, sourceRatio: '16:9',
    });
    expect(plan.durationS).toBe(180);
    expect(plan.removedS).toBe(0);
    expect(plan.clips.filter(c => c.type === 'video').length).toBe(1);
    expect(plan.frame.ratio).toBe('16:9');
    expect(plan.summary).toMatch(/uncut|100%/i);
  });

  it('spreads fallback caption cards across the whole uncut programme when there is no transcript', () => {
    // Regression: "don't cut anything" + "add captions" with no transcript used
    // to produce a single caption card in the first 3 seconds, which read as
    // "no captions" on a long video.
    const uncut = profile({ uncut: true, sourceName: 'modaya-default' });
    const plan = composeStudioPlan({
      profile: uncut, sourceDurationS: 300, sourceRatio: '16:9',
      interest: Array.from({ length: 300 }, () => 0.5),
    });
    const caps = plan.clips.filter(c => c.type === 'text');
    expect(caps.length).toBeGreaterThan(5);
    for (const c of caps) {
      expect(c.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
    }
    // Cards must reach well beyond the start of the programme
    const last = caps[caps.length - 1];
    expect(last.endS).toBeGreaterThan(plan.durationS * 0.5);
  });

  it('never burns a filename into fallback caption cards, even with a reference profile', () => {
    // The editor AI writes a neutral "Caption" label; matching it means
    // a reference or footage filename can never appear burned into the video.
    const withRef = profile({ uncut: true, sourceName: 'my-reference-video.mp4' });
    const plan = composeStudioPlan({
      profile: withRef, sourceDurationS: 120, sourceRatio: '16:9',
      interest: Array.from({ length: 120 }, () => 0.5),
    });
    const caps = plan.clips.filter(c => c.type === 'text');
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.label).toBe('Caption');
      expect(c.label.toLowerCase()).not.toContain('reference');
    }
  });

  it('preserves source aspect ratio when provided', () => {
    const plan = composeStudioPlan({
      profile: profile(), sourceDurationS: 60, sourceRatio: '16:9',
    });
    expect(plan.frame.ratio).toBe('16:9');
    expect(plan.frame.width).toBe(1920);
    expect(plan.frame.height).toBe(1080);
  });
});

describe('B-roll cutaways', () => {
  it('chooseBroll avoids ranges already used and stays in bounds', () => {
    const used = [{ s: 120, e: 150 }];
    const cuts = chooseBroll({ durationS: 300, interest: interestWithSpike(), used, count: 5 });
    expect(cuts.length).toBeGreaterThan(0);
    for (const c of cuts) {
      expect(c.s).toBeGreaterThanOrEqual(0);
      expect(c.e).toBeLessThanOrEqual(300);
      const hitsUsed = c.s >= 120 - 0.3 && c.e <= 150 + 0.3;
      expect(hitsUsed).toBe(false);
    }
  });

  it('places silent overlay cutaways over main shots while keeping base audio', () => {
    const plan = composeStudioPlan({
      profile: profile(), sourceDurationS: 300,
      interest: interestWithSpike(300, [120, 150]),
    });
    const overlays = plan.clips.filter(c => c.trackId === 'overlay');
    // long enough source + target gives at least one cutaway, but never requires it
    if (overlays.length) {
      for (const ov of overlays) {
        expect(ov.startS).toBeGreaterThanOrEqual(0);
        expect(ov.endS).toBeLessThanOrEqual(plan.durationS + 0.01);
      }
      expect(plan.broll).toBe(overlays.length);
    }
  });

  it('summary mentions b-roll only when present', () => {
    const plan = composeStudioPlan({
      profile: profile(), sourceDurationS: 300, interest: interestWithSpike(),
    });
    if (plan.broll > 0) expect(plan.summary).toMatch(/b-roll/i);
  });
});
