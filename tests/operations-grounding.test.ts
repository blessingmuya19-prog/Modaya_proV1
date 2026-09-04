/**
 * Reference-operation mapping: groundOperations does the heavy lifting.
 * The model only supplies the approximate area of focus; the measured
 * boundaries (silent-span edges, word onsets, beat onsets, shot changes)
 * lock ranges into place, removals absorb silences, and the learned
 * reference style is enforced rather than suggested.
 */
import { describe, it, expect } from 'vitest';
import {
  groundOperations, loudnessPeaks, type Operation,
} from '@/lib/ai/operations';

const WORD_CTX = {
  durationS: 120,
  transcript: { segments: [
    { startS: 20, endS: 23.4, text: 'hello there' },
  ] },
};

describe('groundOperations — snapping to measured boundaries', () => {
  it('leaves ranges alone when no measurements were supplied', () => {
    const ops: Operation[] = [{ op: 'remove_ranges', ranges: [[12.2, 14.8]] }];
    expect(groundOperations(ops, 'cut the ramble')).toEqual(ops);
  });

  it('snaps a removal to the nearest silence boundary and absorbs the span', () => {
    const [op] = groundOperations(
      [{ op: 'remove_ranges', ranges: [[10.5, 11.5]] }],
      'cut round here',
      { durationS: 40, silences: [[10, 12]] },
    ) as [{ op: 'remove_ranges'; ranges: [number, number][] }];
    expect(op.ranges).toEqual([[10, 12]]);
  });

  it('snaps to the speaker word onset, not the model timestamp', () => {
    const [op] = groundOperations(
      [{ op: 'remove_ranges', ranges: [[20.6, 22.9]] }],
      'cut this ramble',
      WORD_CTX,
    ) as [{ op: 'remove_ranges'; ranges: [number, number][] }];
    expect(op.ranges[0]).toEqual([20, 23.4]);
  });

  it('uses beat onsets when nothing organic is in reach', () => {
    const [op] = groundOperations(
      [{ op: 'keep_ranges', ranges: [[31.0, 32.0]] }],
      'keep the drop',
      { durationS: 60, onsets: [30.4, 31.6] },
    ) as [{ op: 'keep_ranges'; ranges: [number, number][] }];
    expect(op.ranges[0]).toEqual([30.4, 31.6]);
  });

  it('prefers onsets over silence edges when the reference is beat-synced', () => {
    const style = 'warm grade; ~12 cuts per minute; beat sync';
    const ops: Operation[] = [{ op: 'keep_ranges', ranges: [[31.0, 33.4]] }];
    const [loose] = groundOperations(ops, 'match the reference', {
      durationS: 60, silences: [[29.5, 33.0]], onsets: [30.6, 34.2],
    }) as [{ op: 'keep_ranges'; ranges: [number, number][] }];
    const [synced] = groundOperations(ops, 'match the reference', {
      durationS: 60, silences: [[29.5, 33.0]], onsets: [30.6, 34.2], style,
    }) as [{ op: 'keep_ranges'; ranges: [number, number][] }];
    expect(loose.ranges[0]).toEqual([30.6, 33.0]);
    expect(synced.ranges[0]).toEqual([30.6, 34.2]);
  });

  it('snaps to picture shot changes too', () => {
    const [op] = groundOperations(
      [{ op: 'keep_ranges', ranges: [[50.2, 53.3]] }],
      'keep this section',
      { durationS: 90, cuts: [50, 53.5] },
    ) as [{ op: 'keep_ranges'; ranges: [number, number][] }];
    expect(op.ranges[0]).toEqual([50, 53.5]);
  });

  it('never moves a boundary that is already exact', () => {
    const ops: Operation[] = [{ op: 'keep_ranges', ranges: [[30, 31.2]] }];
    const [op] = groundOperations(ops, 'keep the bar', {
      durationS: 60, silences: [[30, 31.2]], onsets: [30, 31.2],
    }) as [{ op: 'keep_ranges'; ranges: [number, number][] }];
    expect(op.ranges[0]).toEqual([30, 31.2]);
  });

  it('refuses to snap a window that would end up shorter than half a second', () => {
    const [op] = groundOperations(
      [{ op: 'keep_ranges', ranges: [[30.2, 30.4]] }],
      'keep this bit',
      { durationS: 60, onsets: [30, 30.47] },
    ) as [{ op: 'keep_ranges'; ranges: [number, number][] }];
    expect(op.ranges[0]).toEqual([30.2, 30.4]);
  });

  it('a removal absorbs every silence it overlaps, not just one', () => {
    const [op] = groundOperations(
      [{ op: 'remove_ranges', ranges: [[41.0, 45.0]] }],
      'cut the middle',
      { durationS: 60, silences: [[39, 42], [44, 46.5]] },
    ) as [{ op: 'remove_ranges'; ranges: [number, number][] }];
    expect(op.ranges[0]).toEqual([39, 46.5]);
  });
});

describe('groundOperations — style locking from the reference', () => {
  const REF = 'warm grade; ~12 cuts per minute; bold captions along the bottom';

  it('forces add_captions to the reference position and flags', () => {
    const [op] = groundOperations(
      [{ op: 'add_captions', position: 'centre', everyS: 3, style: { font: 'sans' } }],
      'like the reference',
      { style: REF },
    ) as [{ op: 'add_captions'; position: string; style: Record<string, unknown> }];
    expect(op.position).toBe('lower');
    expect(op.style).toMatchObject({ bold: true });
  });

  it('injects the missing add_captions when the user asked for them', () => {
    const out = groundOperations(
      [{ op: 'style_text', target: 'captions', style: { font: 'sans' } }],
      'add captions like the reference',
      { style: REF },
    );
    expect(out[0].op).toBe('add_captions');
    const add = out[0] as Extract<Operation, { op: 'add_captions' }>;
    expect(add.position).toBe('lower');
    expect(add.style).toMatchObject({ bold: true });
    expect(out[1].op).toBe('style_text');
  });

  it('does not invent captions the user never asked for', () => {
    const ops: Operation[] = [{ op: 'grade', brightness: 1.1, contrast: 1.1, saturation: 1.2 }];
    expect(groundOperations(ops, 'punch it up', { style: REF })).toEqual(ops);
  });
});

describe('loudnessPeaks', () => {
  it('returns the strongest spaced peaks as timestamps', () => {
    const energy = [0, 1, 2, 1, 3, 2, 4, 0, 1];
    expect(loudnessPeaks(energy, 4.5, 2)).toEqual([2, 3]);
    expect(loudnessPeaks(energy, 4.5, 60)).toContain(1);
  });

  it('suppresses neighbours of a stronger peak', () => {
    /* hop 0.5s: peaks at 1.0 (2) and 2.0 (3) — 2.0 wins, 1.0 is suppressed */
    const energy = [0, 0.5, 2, 1.5, 3, 0.5, 0.5, 0];
    expect(loudnessPeaks(energy, 4, 2, 1.2)).toEqual([2]);
  });

  it('returns nothing for an empty envelope', () => {
    expect(loudnessPeaks([], 60, 10)).toEqual([]);
  });
});
