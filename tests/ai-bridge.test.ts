/**
 * The Studio ⇄ editor AI bridge.
 *
 * The editor AI thinks in source time (clips laid end-to-end, gaps = removed
 * sections); the Studio thinks in programme time (condensed output, sourceIn
 * pointing back into the footage). These tests pin the conversion and the
 * round-trip invariants: footage untouched ⇒ Studio plan survives verbatim
 * (b-roll, styling, captions included); footage cut ⇒ captions are re-mapped
 * through the new programme and nothing is left dangling in a gap.
 */
import { describe, it, expect } from 'vitest';
import {
  toAiView, applyAiResult, syncProfileAfterAi, effectsForProfile,
  sourceToTimeline, timelineToSource, uncutStudioPlan, applyAiLook, parseAiLook,
  needsTranscript, wantsClips, needsVision, styleForAi,
  type ShotMap,
} from '@/lib/studio/aiBridge';
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, type StyleLayer } from '@/lib/render/sequence';
import type { StudioPlan } from '@/lib/studio/editPlan';

const styleLayer: StyleLayer = {
  'shot-1': { sourceIn: 0,  transform: { ...DEFAULT_TRANSFORM, fit: 'cover' }, effects: { ...DEFAULT_EFFECTS } },
  'shot-2': { sourceIn: 6,  transform: { ...DEFAULT_TRANSFORM, fit: 'contain' }, effects: { ...DEFAULT_EFFECTS } },
};

function plan(): StudioPlan {
  return {
    clips: [
      { id: 'shot-1', trackId: 'video', label: 'Shot 1', startS: 0, endS: 4, type: 'video', sourceIn: 0,
        transform: { ...DEFAULT_TRANSFORM, fit: 'cover' }, effects: { ...DEFAULT_EFFECTS } },
      /* B-roll cutaway overlays shot 2 — must survive an unchanged footage
         round-trip. */
      { id: 'broll-0', trackId: 'overlay', label: 'Cutaway', startS: 5, endS: 7, type: 'video', sourceIn: 1,
        transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS } },
      { id: 'shot-2', trackId: 'video', label: 'Shot 2', startS: 4, endS: 8, type: 'video', sourceIn: 6,
        transform: { ...DEFAULT_TRANSFORM, fit: 'contain' }, effects: { ...DEFAULT_EFFECTS } },
      /* Caption at programme 1–2 → source 1–2 (inside shot-1). */
      { id: 'cap-0', trackId: 'subs', label: 'Hello there', startS: 1, endS: 2, type: 'text', sourceIn: 0,
        textPosition: 'lower', textAlign: 'centre',
        textStyle: { font: 'sans', bold: true, size: 'medium', colour: '#FFFFFF', background: 'box' },
        transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS } },
    ],
    durationS: 8,
    removedS: 2,            // source was 0–10, 4–6 removed
    cutCount: 2,
    summary: 'Beat cut',
    profileName: 'Cinematic',
    frame: { width: 1080, height: 1920, ratio: '9:16' },
    captions: 1,
    broll: 1,
    brollFromLibrary: false,
    hookFirst: false,
  };
}

const profile = {
  sourceName: 'Cinematic', durationS: 10, cuts: [], cutsPerMin: 12,
  shotMeanS: 4, shotMedianS: 4, shotVariance: 0, pace: 'balanced' as const,
  grade: { brightness: 0, contrast: 0, saturation: 0.5, warmth: 0 },
  punchInRate: 0.3, punchInMax: 1.2,
  captions: { present: false, position: 'lower' as const, emphasis: 0.7 },
  beatSynced: false, bpm: null, energy: 0.5,
};

describe('studio ⇄ editor AI bridge', () => {
  it('mirrors the source/programme timebases both ways', () => {
    const shots: ShotMap[] = [
      { id: 'a', srcS: 0, srcE: 4,  tlS: 0, tlE: 4 },
      { id: 'b', srcS: 6, srcE: 10, tlS: 4, tlE: 8 },
    ];
    expect(sourceToTimeline(shots, 7)).toBe(5);
    expect(timelineToSource(shots, 6.5)).toBe(8.5);
    expect(timelineToSource(shots, 4.2)).toBe(6.2);
    expect(sourceToTimeline(shots, 5)).toBeNull();      // the removed source gap
    expect(sourceToTimeline(shots, 9)).toBe(7);
    expect(timelineToSource(shots, 9)).toBeNull();      // programme has no more shots
  });

  it('round-trips an unchanged timeline with b-roll and caption placement intact', () => {
    const view = toAiView(plan(), styleLayer);
    const videos = view.clips.filter(c => c.type === 'video' && c.trackId === 'video');
    expect(videos.map(v => [v.startS, v.endS])).toEqual([[0, 4], [6, 10]]);
    const sub = view.clips.find(c => c.type === 'subtitle');
    expect(sub).toMatchObject({ id: 'cap-0', label: 'Hello there', startS: 1, endS: 2, textPosition: 'lower' });

    const out = applyAiResult(plan(), styleLayer, profile, 10, view.clips);
    expect(out).not.toBeNull();
    expect(out!.applied).toBe(false);
    expect(out!.plan.durationS).toBe(8);
    /* Footage untouched ⇒ the exact same shots, incl. b-roll overlay + text. */
    expect(out!.plan.clips.map(c => c.id).sort()).toEqual(['broll-0', 'cap-0', 'shot-1', 'shot-2']);
    const cap = out!.plan.clips.find(c => c.id === 'cap-0');
    expect(cap).toMatchObject({ startS: 1, endS: 2, textPosition: 'lower' });
  });

  it('condenses a re-cut and re-maps captions into the surviving programme', () => {
    const view = toAiView(plan(), styleLayer);
    /* The AI additionally removed 6–7 from the source: the surviving windows
       [0–4] [7–10] are condensed into a continuous 7s programme. */
    const cut = [
      { id: 'v1', trackId: 'video', label: 'Shot', type: 'video' as const, startS: 0, endS: 4 },
      { id: 'v2', trackId: 'video', label: 'Shot', type: 'video' as const, startS: 7, endS: 10 },
      { id: 'cap-0', trackId: 'subs', label: 'Hello there', type: 'subtitle' as const,
        startS: 1, endS: 2, textPosition: 'lower' as const, textAlign: 'centre' as const },
    ];
    const out = applyAiResult(plan(), styleLayer, profile, 10, cut);
    expect(out).not.toBeNull();
    expect(out!.applied).toBe(true);
    expect(out!.plan.durationS).toBe(7);
    expect(out!.plan.clips.filter(c => c.type === 'video' && c.trackId === 'video'))
      .toMatchObject([{ startS: 0, endS: 4, sourceIn: 0 }, { startS: 4, endS: 7, sourceIn: 7 }]);
    const cap = out!.plan.clips.find(c => c.type === 'text');
    expect(cap).toMatchObject({ startS: 1, endS: 2, sourceIn: 0, textPosition: 'lower' });
    /* cutaway artwork is dropped on a structural re-cut; nothing references
       a removed source window. */
    expect(out!.plan.clips.some(c => c.id === 'broll-0')).toBe(false);
    for (const c of out!.plan.clips.filter(c => c.type === 'video' && c.trackId === 'video')) {
      expect(c.sourceIn + (c.endS - c.startS)).toBeLessThanOrEqual(10);
    }
  });

  it('clamps captions that land on a removed span into their host shot', () => {
    const view = toAiView(plan(), styleLayer);
    const cut = [
      { id: 'v1', trackId: 'video', label: 'Shot', type: 'video' as const, startS: 0, endS: 4 },
      { id: 'v2', trackId: 'video', label: 'Shot', type: 'video' as const, startS: 7, endS: 10 },
      /* Caption was placed over the removed span: it has no home. */
      { id: 'cap-x', trackId: 'subs', label: 'Zombie', type: 'subtitle' as const,
        startS: 5, endS: 6, textPosition: 'lower' as const },
    ];
    const out = applyAiResult(plan(), styleLayer, profile, 10, cut);
    expect(out!.plan.clips.filter(c => c.type === 'text')).toHaveLength(0);
  });

  it('derives render effects from the profile grade the same way the studio does', () => {
    const e = effectsForProfile({ ...profile, grade: { brightness: -0.2, contrast: 0.3, saturation: 0, warmth: 1 } });
    expect(e.brightness).toBeCloseTo(0.92, 3);
    expect(e.contrast).toBeCloseTo(1.24, 3);
    expect(e.saturation).toBeCloseTo(1, 3);
    expect(e.colorGrade?.temperature).toBe(80);
  });

  it('syncs the profile so the next regenerate keeps the AI decisions', () => {
    const p = plan();
    const synced = syncProfileAfterAi({ ...profile, captions: { present: false, position: 'lower', emphasis: 0 } }, p);
    expect(synced.captions.present).toBe(true);
    expect(synced.captions.position).toBe('lower');
    expect(synced.cutsPerMin).toBe(15);          // 2 cuts / 8s → 15/min, rounded to 1dp
    expect(synced.uncut).toBe(false);

    const whole = {
      ...p,
      clips: [{ ...p.clips[0], startS: 0, endS: 10, sourceIn: 0 }],
      durationS: 10,
    };
    const synced2 = syncProfileAfterAi({ ...profile, captions: { present: false, position: 'lower', emphasis: 0 } }, whole);
    expect(synced2.uncut).toBe(true);
  });

  it('measures punch-ins from the plan, not the reference profile', () => {
    const punched = plan();
    punched.clips = [
      { ...punched.clips[0], transform: { ...DEFAULT_TRANSFORM, scale: 1.12 } },
      { ...punched.clips[2], transform: { ...DEFAULT_TRANSFORM, scale: 1 } },
    ];
    const synced = syncProfileAfterAi(
      { ...profile, punchInRate: 0.8 },   // reference says 80%…
      punched,
    );
    expect(synced.punchInRate).toBe(0.5); // …but only 1 of 2 shots actually pushes in
  });
});

describe('one-AI first pass and look decisions', () => {
  it('builds a single uncut source clip as the canvas the AI edits', () => {
    const base = uncutStudioPlan(profile, 10, '9:16');
    expect(base.clips).toHaveLength(1);
    expect(base.clips[0]).toMatchObject({
      type: 'video', trackId: 'video', startS: 0, endS: 10, sourceIn: 0,
    });
    expect(base.frame.ratio).toBe('9:16');
    expect(base.durationS).toBe(10);
  });

  it('renders a grade operation onto the layer exactly as the AI asked', () => {
    const base = uncutStudioPlan(profile, 10, '16:9');
    const layer: StyleLayer = { 'shot-1': { sourceIn: 0, effects: { ...DEFAULT_EFFECTS } } };
    const out = applyAiLook(layer, profile, [
      { op: 'grade', brightness: 1.12, contrast: 0.9, saturation: 1.4 },
      { op: 'punch_in', rate: 0.6 },
    ]);
    expect(out.changed).toBe(true);
    expect(out.layer['shot-1']!.effects).toMatchObject({
      brightness: 1.12, contrast: 0.9, saturation: 1.4,
    });
    expect(out.layer['shot-1']!.effects!.colorGrade?.vibrance).toBe(28);
    /* profile keeps the look for the next regenerate (relative grade + punch) */
    expect(out.profile.punchInRate).toBe(0.6);
    expect(out.profile.grade.saturation).toBeCloseTo((1.4 - 1) / 0.85, 3);
    expect(out.profile.grade.brightness).toBeCloseTo((1.12 - 1) / 0.4, 3);
  });

  it('detects look ops but not timeline ops', () => {
    expect(parseAiLook([{ op: 'grade', brightness: 1 }]).changed).toBe(true);
    expect(parseAiLook([{ op: 'remove_ranges', ranges: [] }]).changed).toBe(false);
    expect(parseAiLook([]).changed).toBe(false);
    expect(applyAiLook({}, profile, []).layer).toEqual({});
  });

  it('routes the same word intents the Pro Editor used', () => {
    expect(needsTranscript('add captions')).toBe(true);
    expect(needsTranscript('remove the ums')).toBe(true);
    expect(needsTranscript('what did he say about money')).toBe(true);
    expect(needsTranscript('make it vibrant')).toBe(false);

    expect(wantsClips('find me 5 clips')).toBe(true);
    expect(wantsClips('give me 3 viral shorts')).toBe(true);
    expect(wantsClips('90 second tiktok')).toBe(true);
    expect(wantsClips('cut the first 30 seconds')).toBe(false);

    expect(needsVision('describe the video')).toBe(true);
    expect(needsVision('what colour is the jersey?')).toBe(true);
    expect(needsVision('what is happening in this scene')).toBe(true);
    expect(needsVision('add bold captions')).toBe(false);
  });

  it('describes the learned reference style for the AI hint', () => {
    const s = styleForAi({
      ...profile,
      grade: { brightness: 0.08, contrast: 0.38, saturation: 0.45, warmth: 0.24 },
      captions: { present: true, position: 'lower', emphasis: 0.7 },
      cutsPerMin: 12,
    });
    expect(s).toContain('warm');
    expect(s).toContain('saturation +45%');
    expect(s).toContain('12 cuts per minute');
    expect(s).toContain('bold captions along the bottom');

    const neutral = styleForAi({ ...profile, grade: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 } });
    expect(neutral).toContain('neutral grade');
    expect(neutral).toContain('no captions');
  });

  it('sends the full measured rule card — rhythm, beat, push-ins and opening shot', () => {
    const s = styleForAi({
      ...profile,
      cutsPerMin: 12, shotMeanS: 5, shotMedianS: 4.8, shotVariance: 0.3,
      cuts: [4.8],
      beatSynced: true, bpm: 120, energy: 0.8,
      punchInRate: 0.4,
      grade: { brightness: 0.08, contrast: 0.38, saturation: 0.45, warmth: 0.24 },
      captions: { present: true, position: 'lower', emphasis: 0.7 },
    });
    expect(s).toContain('rhythm character: punctuated');
    expect(s).toContain('~120 BPM');
    expect(s).toContain('push-ins on ~40% of shots');
    expect(s).toContain('opening shot: 4.8s long');
  });

  it('tells the AI when the reference captions transition and what colour pulses', () => {
    const moving = styleForAi({
      ...profile,
      captions: {
        present: true, position: 'lower', emphasis: 0.9,
        animated: true, highlightColour: '#facc15',
      },
    });
    expect(moving).toContain('bold captions along the bottom, animated pop-in');
    expect(moving).toContain('yellow highlights');

    const staticCaps = styleForAi({
      ...profile,
      captions: { present: true, position: 'centre', emphasis: 0.5 },
    });
    expect(staticCaps).toContain('bold captions along the middle');
    expect(staticCaps).not.toContain('animated');
  });

  it('cuts the chosen source window into its own programme (cut-to-clip)', () => {
    const p = plan();
    const window = [
      { id: 'cut-1', trackId: 'video', label: 'The hook', type: 'video' as const,
        startS: 7, endS: 9 },           // inside shot-2's source (6–10)
    ];
    const out = applyAiResult(p, styleLayer, profile, 10, window);
    expect(out!.applied).toBe(true);
    expect(out!.plan.durationS).toBe(2);
    expect(out!.plan.clips.filter(c => c.type === 'video' && c.trackId === 'video'))
      .toMatchObject([{ startS: 0, endS: 2, sourceIn: 7 }]);
    /* The caption at source 1–2 falls outside the window — dropped. */
    expect(out!.plan.clips.filter(c => c.type === 'text')).toHaveLength(0);
  });
});
