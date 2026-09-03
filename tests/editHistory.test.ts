import { describe, it, expect } from 'vitest';
import {
  diffTimelineClips,
  diffEditVersions,
  fingerprintRecipe,
} from '@/lib/studio/editHistory';
import type { EditorClip } from '@/components/editor/EditorShell';
import type { EditVersion } from '@/lib/studio/versions';

describe('AI edit timeline history & visual diff snapshot engine', () => {
  it('computes accurate clip additions, removals, and trimming between timeline states', () => {
    const stateA: EditorClip[] = [
      { id: 'c1', type: 'video', trackId: 'video', startS: 0, endS: 10, label: 'Intro' },
      { id: 'c2', type: 'video', trackId: 'video', startS: 10, endS: 25, label: 'Main Talk' },
      { id: 'c3', type: 'subtitle', trackId: 'subs', startS: 0, endS: 5, label: 'Hello world' },
    ];

    const stateB: EditorClip[] = [
      // c1 trimmed from 10s to 6s
      { id: 'c1', type: 'video', trackId: 'video', startS: 0, endS: 6, label: 'Intro' },
      // c2 removed
      // c4 added
      { id: 'c4', type: 'video', trackId: 'video', startS: 6, endS: 15, label: 'New Hook' },
      { id: 'c3', type: 'subtitle', trackId: 'subs', startS: 0, endS: 5, label: 'Hello world' },
    ];

    const diff = diffTimelineClips(stateA, stateB, 'v1', 'v2');
    expect(diff.durationDeltaS).toBe(-10); // 15s - 25s = -10s
    expect(diff.deltas).toHaveLength(3);

    const trimmed = diff.deltas.find(d => d.type === 'trimmed');
    expect(trimmed).toBeDefined();
    expect(trimmed?.clipId).toBe('c1');
    expect(trimmed?.timeDiffS).toBe(-4);

    const removed = diff.deltas.find(d => d.type === 'removed');
    expect(removed).toBeDefined();
    expect(removed?.clipId).toBe('c2');

    const added = diff.deltas.find(d => d.type === 'added');
    expect(added).toBeDefined();
    expect(added?.clipId).toBe('c4');
  });

  it('compares EditVersion recipes and detects pacing and caption differences', () => {
    const v1: EditVersion = {
      id: 'v1',
      number: 1,
      label: 'Original',
      createdAt: new Date().toISOString(),
      stats: { durationS: 60, cuts: 8, match: 75 },
      recipe: {
        profile: {
          sourceName: 'src.mp4',
          durationS: 60,
          cuts: [5, 12, 20, 28, 35, 42, 50, 58],
          cutsPerMin: 8,
          shotMeanS: 7.5,
          shotMedianS: 7.5,
          shotVariance: 0.2,
          pace: 'relaxed',
          grade: { brightness: 1, contrast: 1, saturation: 1, warmth: 0 },
          punchInRate: 0.1,
          punchInMax: 1.2,
          captions: { present: false, position: 'lower', emphasis: 0 },
          beatSynced: false,
          bpm: null,
          energy: 0.4,
        },
        seed: 42,
        hasRef: false,
      },
    };

    const v2: EditVersion = {
      id: 'v2',
      number: 2,
      label: 'Fast Paced Viral',
      createdAt: new Date().toISOString(),
      stats: { durationS: 30, cuts: 14, match: 90 },
      recipe: {
        profile: {
          sourceName: 'ref.mp4',
          durationS: 30,
          cuts: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28],
          cutsPerMin: 28,
          shotMeanS: 2.1,
          shotMedianS: 2.0,
          shotVariance: 0.4,
          pace: 'very fast',
          grade: { brightness: 1.1, contrast: 1.25, saturation: 1.2, warmth: 0.3 },
          punchInRate: 0.4,
          punchInMax: 1.4,
          captions: { present: true, position: 'centre', emphasis: 0.8 },
          beatSynced: true,
          bpm: 128,
          energy: 0.85,
        },
        seed: 43,
        hasRef: true,
      },
    };

    const diff = diffEditVersions(v1, v2);
    expect(diff.durationDeltaS).toBe(-30);
    expect(diff.cutsDelta).toBe(6);
    expect(diff.pacingSummary).toContain('Faster pace');
    expect(diff.colorGradeChanged).toBe(true);
    expect(diff.captionsChanged).toBe(true);
  });

  it('generates consistent deterministic fingerprint for version recipes', () => {
    const recipe = {
      profile: {
        sourceName: 'src.mp4',
        durationS: 60,
        cuts: [10, 20, 30],
        cutsPerMin: 20,
        shotMeanS: 3,
        shotMedianS: 3,
        shotVariance: 0.1,
        pace: 'fast' as const,
        grade: { brightness: 1, contrast: 1.1, saturation: 1, warmth: 0.1 },
        punchInRate: 0.2,
        punchInMax: 1.2,
        captions: { present: true, position: 'lower' as const, emphasis: 0.5 },
        beatSynced: false,
        bpm: null,
        energy: 0.6,
      },
      seed: 101,
      hasRef: false,
      note: 'Cut silences and make it fast',
    };

    const fp1 = fingerprintRecipe(recipe);
    const fp2 = fingerprintRecipe(recipe);
    expect(fp1).toBe(fp2);
    expect(fp1.startsWith('fp_')).toBe(true);
  });
});
