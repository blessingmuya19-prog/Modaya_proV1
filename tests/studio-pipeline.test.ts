/**
 * The guided Studio presents a fixed, named creative pipeline. This covers the
 * pure spine: which stages run with/without a reference, progress accounting,
 * the reference-match calculation and result framing.
 */
import { describe, it, expect } from 'vitest';
import {
  stagesForRun, markActive, markDone, pipelineProgress,
  referenceMatch, resultHeadline, STUDIO_STAGES,
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
  const base = {
    hasReference: true, editCutsPerMin: 30, refCutsPerMin: 30,
    beatSnapRate: 1, refPunchInRate: 0.4, editPunchInRate: 0.4,
    captionsWanted: true, captionsPresent: true,
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
      beatSnapRate: 5, refPunchInRate: 3, editPunchInRate: -2,
      captionsWanted: true, captionsPresent: true,
    });
    expect(wild).toBeGreaterThanOrEqual(0);
    expect(wild).toBeLessThanOrEqual(100);
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
});

describe('stage catalogue', () => {
  it('keeps render last and source-understanding first', () => {
    expect(STUDIO_STAGES[0].id).toBe('understand-source');
    expect(STUDIO_STAGES[STUDIO_STAGES.length - 1].id).toBe('render');
  });
});
