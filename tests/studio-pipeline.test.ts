/**
 * The guided Studio presents a fixed, named creative pipeline. This covers the
 * pure spine: which stages run with/without a reference, progress accounting,
 * the reference-match calculation and result framing.
 */
import { describe, it, expect } from 'vitest';
import {
  stagesForRun, markActive, markDone, pipelineProgress,
  referenceMatch, referenceMatchDetail, resultHeadline, STUDIO_STAGES,
  gradeAgreement, gradeDistinct, measuredBeatSnapRate,
} from '@/lib/studio/pipeline';

describe('stagesForRun', () => {
  it('runs every stage when a reference is provided', () => {
    const stages = stagesForRun(true);
    expect(stages.every(s => s.status === 'pending')).toBe(true);
    expect(stages.map(s => s.id)).toContain('learn-reference');
  });

  it('skips reference-only stages when no reference was given', () => {
    const stages = stagesForRun(false);
    const learn = stages.find(s => s.id === 'learn-reference')!;
    const pacing = stages.find(s => s.id === 'match-pacing')!;
    expect(learn.status).toBe('skipped');
    expect(pacing.status).toBe('skipped');
    // source-understanding and rendering still run
    expect(stages.find(s => s.id === 'understand-source')!.status).toBe('pending');
    expect(stages.find(s => s.id === 'render')!.status).toBe('pending');
  });
});

describe('stage progression', () => {
  it('moves pending -> active -> done without disturbing other stages', () => {
    let s = stagesForRun(true);
    s = markActive(s, 'understand-source');
    expect(s.find(x => x.id === 'understand-source')!.status).toBe('active');
    s = markDone(s, 'understand-source');
    expect(s.find(x => x.id === 'understand-source')!.status).toBe('done');
    expect(s.find(x => x.id === 'learn-reference')!.status).toBe('pending');
  });

  it('never flips a skipped stage to active or done', () => {
    let s = stagesForRun(false);
    s = markActive(s, 'learn-reference');
    s = markDone(s, 'learn-reference');
    expect(s.find(x => x.id === 'learn-reference')!.status).toBe('skipped');
  });

  it('progress counts only runnable stages and reaches 1', () => {
    let s = stagesForRun(false);
    expect(pipelineProgress(s)).toBe(0);
    for (const stage of s) {
      if (stage.status !== 'skipped') s = markDone(markActive(s, stage.id), stage.id);
    }
    expect(pipelineProgress(s)).toBe(1);
  });

  it('progress with a reference divides by the larger stage count', () => {
    let s = stagesForRun(true);
    const runnable = s.length;
    s = markDone(markActive(s, 'understand-source'), 'understand-source');
    expect(pipelineProgress(s)).toBeCloseTo(1 / runnable, 5);
  });
});

describe('referenceMatch', () => {
  const REF_GRADE = { brightness: 1.05, contrast: 1.28, saturation: 1.35, warmth: 0.2 };
  const base = {
    hasReference: true, editCutsPerMin: 30, refCutsPerMin: 30,
    beatSnapRate: 1, refBeatSynced: true,
    refPunchInRate: 0.4, editPunchInRate: 0.4,
    captionsWanted: true, captionsPresent: true,
    refGrade: REF_GRADE, gradeAgreement: 1,
  };

  it('is high when the edit mirrors the reference', () => {
    expect(referenceMatch(base)).toBeGreaterThanOrEqual(90);
  });

  it('is 0 without a reference', () => {
    expect(referenceMatch({ ...base, hasReference: false })).toBe(0);
  });

  it('drops when pacing diverges', () => {
    const slow = referenceMatch({ ...base, editCutsPerMin: 6 }); // reference 30
    expect(slow).toBeLessThan(referenceMatch(base));
  });

  it('punishes missing captions when they were wanted', () => {
    const noCaps = referenceMatch({ ...base, captionsPresent: false });
    expect(noCaps).toBeLessThan(referenceMatch(base));
  });

  it('never leaves the 0..100 band for extreme inputs', () => {
    const wild = referenceMatch({
      hasReference: true, editCutsPerMin: 999, refCutsPerMin: 1,
      beatSnapRate: 5, refBeatSynced: true,
      refPunchInRate: 3, editPunchInRate: -2,
      captionsWanted: true, captionsPresent: true,
      refGrade: REF_GRADE, gradeAgreement: 5,
    });
    expect(wild).toBeGreaterThanOrEqual(0);
    expect(wild).toBeLessThanOrEqual(100);
  });

  it('never credits a pacing the reference did not specify', () => {
    const detail = referenceMatchDetail({
      hasReference: true,
      editCutsPerMin: 1, refCutsPerMin: 0,       // reference: no detectable cuts
      beatSnapRate: 0.8, refBeatSynced: false,
      refPunchInRate: 0, editPunchInRate: 0,     // neither side pushes in
      captionsWanted: false, captionsPresent: false,
      refGrade: REF_GRADE, gradeAgreement: 1,
    });
    /* Only the colour grade was measurable — it cannot be diluted by
       absent-in-both aspects, and it can't claim beat-sync either. */
    expect(detail.axes.map(a => a.label)).toEqual(['colour grade']);
    expect(detail.score).toBe(100);
  });

  it('a grade-only edit against a paced reference scores low', () => {
    const detail = referenceMatchDetail({
      hasReference: true,
      editCutsPerMin: 1, refCutsPerMin: 12,      // reference cuts; edit does not
      beatSnapRate: 0, refBeatSynced: false,
      refPunchInRate: 0, editPunchInRate: 0,
      captionsWanted: false, captionsPresent: false,
      refGrade: REF_GRADE, gradeAgreement: 1,    // the ONLY thing it did match
    });
    expect(detail.axes.map(a => a.label)).toContain('pacing');
    expect(detail.axes.map(a => a.label)).toContain('colour grade');
    expect(detail.score).toBeLessThan(60);
  });

  it('a neutral reference cannot carry the score on a grade that is not there', () => {
    const detail = referenceMatchDetail({
      hasReference: true,
      editCutsPerMin: 30, refCutsPerMin: 0,
      beatSnapRate: 0, refBeatSynced: false,
      refPunchInRate: 0, editPunchInRate: 0,
      captionsWanted: false, captionsPresent: false,
      refGrade: { brightness: 1, contrast: 1, saturation: 1, warmth: 0 },
      gradeAgreement: 1,
    });
    expect(detail.score).toBe(0);
  });

  it('only counts beat-sync when the reference is verifiably on the beat', () => {
    const notSynced = referenceMatchDetail({ ...base, refBeatSynced: false, gradeAgreement: 1 });
    expect(notSynced.axes.some(a => a.label === 'beat-sync')).toBe(false);
    const synced = referenceMatchDetail({
      ...base, refBeatSynced: true, beatSnapRate: 0.4, gradeAgreement: 1,
    });
    const beat = synced.axes.find(a => a.label === 'beat-sync')!;
    expect(beat.value).toBeCloseTo(0.4);
  });
});

describe('gradeAgreement', () => {
  it('is 1 for identical grades and 0 for opposite extremes', () => {
    const g = { brightness: 1.05, contrast: 1.3, saturation: 1.4, warmth: 0.2 };
    expect(gradeAgreement(g, { ...g })).toBe(1);
    expect(gradeAgreement(
      { brightness: 1, contrast: 1, saturation: 1, warmth: 0 },
      { brightness: 1.35, contrast: 1.35, saturation: 1.55, warmth: 0.8 },
    )).toBe(0);
  });

  it('drops proportionally for a partial miss', () => {
    const a = { brightness: 1, contrast: 1.2, saturation: 1.3, warmth: 0.1 };
    const b = { ...a, saturation: 1.6 };   // 0.3 off on one axis
    expect(gradeAgreement(a, b)).toBeGreaterThan(0.6);
    expect(gradeAgreement(a, b)).toBeLessThan(1);
  });
});

describe('gradeDistinct', () => {
  it('is false for neutral and true for anything the profiler produces', () => {
    expect(gradeDistinct({ brightness: 1, contrast: 1, saturation: 1, warmth: 0 })).toBe(false);
    expect(gradeDistinct({ brightness: 1.02, contrast: 1.22, saturation: 1.26, warmth: 0.07 })).toBe(true);
  });
});

describe('measuredBeatSnapRate', () => {
  const clips = [
    { startS: 0, endS: 4.0 },
    { startS: 4.0, endS: 8.0 },
    { startS: 8.0, endS: 12.0 },
  ];

  it('counts boundaries that land on real onsets', () => {
    expect(measuredBeatSnapRate(clips, [0, 4, 8, 12])).toBe(1);
    expect(measuredBeatSnapRate(clips, [0.5, 4.1, 7.9, 11])).toBeCloseTo(2 / 4, 5);
  });

  it('is 0 without onsets or clips — never assumed', () => {
    expect(measuredBeatSnapRate(clips, [])).toBe(0);
    expect(measuredBeatSnapRate([], [0, 4])).toBe(0);
  });
});

describe('resultHeadline', () => {
  it('mentions the match score with a reference', () => {
    expect(resultHeadline({ hasReference: true, match: 94, durationS: 72 })).toMatch(/94%|1:12/);
  });
  it('omits a match without a reference', () => {
    const h = resultHeadline({ hasReference: false, match: 0, durationS: 34 });
    expect(h).not.toContain('%');
    expect(h).toContain('0:34');
  });
  it('names what the score actually covers', () => {
    const h = resultHeadline({
      hasReference: true, match: 93, durationS: 48, coverage: ['colour grade'],
    });
    expect(h).toContain('93% match');
    expect(h).toContain('(colour grade)');
  });
});

describe('stage catalogue', () => {
  it('keeps render last and source-understanding first', () => {
    expect(STUDIO_STAGES[0].id).toBe('understand-source');
    expect(STUDIO_STAGES[STUDIO_STAGES.length - 1].id).toBe('render');
  });
});
