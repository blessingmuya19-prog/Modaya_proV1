/**
 * Text on screen: where it sits, what it says, how it looks.
 *
 * All three were refusals until now. Asking for captions at the top moved
 * them to a different row of the timeline and changed nothing in the frame;
 * asking for a name on screen got "I can't add custom text overlays"; asking
 * for a different font got "I can't change the font style".
 */
import { describe, it, expect } from 'vitest';
import {
  applyOperations, validateOperations, parseStyle, parsePosition,
  type TimelineClip, type OperationContext,
} from '@/lib/ai/operations';
import { wrapText } from '@/lib/render/engine';

const ctx: OperationContext = { durationS: 100 };
const clips = (): TimelineClip[] => ([
  { id: 'v', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' },
]);
const withTranscript: OperationContext = {
  durationS: 100,
  transcript: { segments: [
    { startS: 1, endS: 3, text: 'first line of speech' },
    { startS: 4, endS: 7, text: 'second line of speech' },
  ] },
};

describe('reading a position out of what was asked', () => {
  it('understands the words people use', () => {
    expect(parsePosition('top')).toBe('top');
    expect(parsePosition('upper third')).toBe('top');
    expect(parsePosition('above')).toBe('top');
    expect(parsePosition('bottom')).toBe('lower');
    expect(parsePosition('under the video')).toBe('lower');
    expect(parsePosition('middle')).toBe('centre');
    expect(parsePosition('center')).toBe('centre');
  });

  it('falls back rather than guessing at nonsense', () => {
    expect(parsePosition('sideways')).toBe('lower');
    expect(parsePosition(undefined, 'centre')).toBe('centre');
    expect(parsePosition(null)).toBe('lower');
  });
});

describe('captions at the top', () => {
  it('places them at the top of the frame without changing track', () => {
    const out = applyOperations(clips(), [
      { op: 'add_captions', position: 'top', everyS: 10 },
    ], withTranscript);
    const caps = out.clips.filter(c => c.id.startsWith('cap-'));
    expect(caps).toHaveLength(2);
    expect(caps.every(c => c.textPosition === 'top')).toBe(true);
    expect(caps.every(c => c.trackId === 'subs')).toBe(true);
  });

  it('says where it put them', () => {
    for (const [where, word] of [['top','top'], ['centre','middle'], ['lower','bottom']] as const) {
      const out = applyOperations(clips(), [
        { op: 'add_captions', position: where, everyS: 10 },
      ], withTranscript);
      expect(out.summary).toMatch(new RegExp(word, 'i'));
    }
  });

  it('accepts a position the model wrote in its own words', () => {
    const ops = validateOperations([{ op: 'add_captions', position: 'upper third' }], ctx);
    expect(ops[0]).toMatchObject({ op: 'add_captions', position: 'top' });
  });
});

describe('text the person supplies', () => {
  it('puts their exact words on screen', () => {
    const out = applyOperations(clips(), [
      { op: 'add_text', text: 'Blessing Muya', position: 'lower', startS: 0, endS: 100 },
    ], ctx);
    const txt = out.clips.find(c => c.id.startsWith('txt-'));
    expect(txt?.label).toBe('Blessing Muya');
    expect(txt?.textPosition).toBe('lower');
    expect(txt?.type).toBe('text');
  });

  it('survives captions being rewritten around it', () => {
    const named = applyOperations(clips(), [
      { op: 'add_text', text: 'Blessing Muya', position: 'top', startS: 0, endS: 100 },
    ], ctx);
    const captioned = applyOperations(named.clips, [
      { op: 'add_captions', position: 'lower', everyS: 10 },
    ], withTranscript);

    expect(captioned.clips.find(c => c.label === 'Blessing Muya'),
      'the name was wiped out by regenerating captions').toBeTruthy();
    expect(captioned.clips.filter(c => c.id.startsWith('cap-')).length).toBe(2);
  });

  it('refuses an overlay with no words rather than inventing some', () => {
    expect(validateOperations([{ op: 'add_text', text: '   ', startS: 0, endS: 10 }], ctx)).toEqual([]);
    expect(validateOperations([{ op: 'add_text', position: 'top' }], ctx)).toEqual([]);
  });

  it('keeps the span inside the video', () => {
    const ops = validateOperations([
      { op: 'add_text', text: 'hello', startS: -5, endS: 9999 },
    ], ctx);
    expect(ops[0]).toMatchObject({ startS: 0, endS: 100 });
  });

  it('drops a span too short to read', () => {
    expect(validateOperations([{ op: 'add_text', text: 'hi', startS: 5, endS: 5.02 }], ctx)).toEqual([]);
  });
});

describe('how the text looks', () => {
  it('takes the five fonts, however they are described', () => {
    expect(parseStyle({ font: 'serif' })?.font).toBe('serif');
    expect(parseStyle({ font: 'Georgia' })?.font).toBe('serif');
    expect(parseStyle({ font: 'monospace' })?.font).toBe('mono');
    expect(parseStyle({ font: 'Impact' })?.font).toBe('display');
    expect(parseStyle({ font: 'handwriting script' })?.font).toBe('handwritten');
    expect(parseStyle({ font: 'Helvetica' })?.font).toBe('sans');
  });

  it('takes a colour as a name or a hex value', () => {
    expect(parseStyle({ colour: 'yellow' })?.colour).toBe('#ffd400');
    expect(parseStyle({ color: '#FF0000' })?.colour).toBe('#ff0000');
    expect(parseStyle({ colour: '#f00' })?.colour).toBe('#ff0000');
  });

  it('ignores a colour it cannot render rather than guessing', () => {
    expect(parseStyle({ colour: 'burnt sienna' })).toBeUndefined();
    expect(parseStyle({ font: 'Comic Papyrus 3000' })).toBeUndefined();
    expect(parseStyle('not an object')).toBeUndefined();
  });

  it('restyles existing captions without rewriting the words', () => {
    const captioned = applyOperations(clips(), [
      { op: 'add_captions', position: 'lower', everyS: 10 },
    ], withTranscript);
    const before = captioned.clips.filter(c => c.id.startsWith('cap-')).map(c => c.label);

    const styled = applyOperations(captioned.clips, [
      { op: 'style_text', target: 'captions', style: { font: 'display', colour: '#ffd400' } },
    ], withTranscript);
    const caps = styled.clips.filter(c => c.id.startsWith('cap-'));

    expect(caps.map(c => c.label)).toEqual(before);
    expect(caps.every(c => c.textStyle?.font === 'display')).toBe(true);
    expect(caps.every(c => c.textStyle?.colour === '#ffd400')).toBe(true);
  });

  it('merges a second restyle onto the first', () => {
    let cur = applyOperations(clips(), [
      { op: 'add_captions', position: 'lower', everyS: 10 }], withTranscript).clips;
    cur = applyOperations(cur, [{ op: 'style_text', target: 'captions', style: { font: 'serif' } }], ctx).clips;
    cur = applyOperations(cur, [{ op: 'style_text', target: 'captions', style: { size: 'large' } }], ctx).clips;
    const cap = cur.find(c => c.id.startsWith('cap-'));
    expect(cap?.textStyle).toMatchObject({ font: 'serif', size: 'large' });
  });

  it('says plainly when there is no text to restyle', () => {
    const out = applyOperations(clips(), [
      { op: 'style_text', target: 'captions', style: { font: 'serif' } },
    ], ctx);
    expect(out.summary).toMatch(/no text/i);
  });

  it('leaves a title alone when only the captions were restyled', () => {
    let cur = applyOperations(clips(), [
      { op: 'add_text', text: 'Blessing Muya', position: 'top', startS: 0, endS: 100 }], ctx).clips;
    cur = applyOperations(cur, [
      { op: 'add_captions', position: 'lower', everyS: 10 }], withTranscript).clips;
    cur = applyOperations(cur, [
      { op: 'style_text', target: 'captions', style: { font: 'mono' } }], ctx).clips;

    expect(cur.find(c => c.label === 'Blessing Muya')?.textStyle).toBeUndefined();
    expect(cur.find(c => c.id.startsWith('cap-'))?.textStyle?.font).toBe('mono');
  });
});

describe('when there is nothing to caption', () => {
  it('says so rather than reporting zero captions', () => {
    const out = applyOperations([], [
      { op: 'add_captions', position: 'lower', everyS: 10 },
    ], withTranscript);
    expect(out.summary).toMatch(/no clips on the timeline/i);
    expect(out.summary).not.toMatch(/^0 captions/);
  });

  it('says so when the transcript sits entirely in cut footage', () => {
    const late: TimelineClip[] = [
      { id: 'v', trackId: 'video', label: 'Video', startS: 50, endS: 100, type: 'video' },
    ];
    const out = applyOperations(late, [
      { op: 'add_captions', position: 'lower', everyS: 10 },
    ], withTranscript);   // transcript covers 1–7s, all of it cut away
    expect(out.summary).toMatch(/does not overlap/i);
  });
});

describe('long text in a narrow frame', () => {
  /** A measureText that charges 10px a character — enough to test wrapping. */
  const ctx2d = { measureText: (t: string) => ({ width: t.length * 10 }) } as CanvasRenderingContext2D;

  it('breaks at spaces rather than running off the frame', () => {
    const lines = wrapText(ctx2d, 'the quick brown fox jumps over the lazy dog', 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length * 10).toBeLessThanOrEqual(200);
  });

  it('keeps short text on one line', () => {
    expect(wrapText(ctx2d, 'hello there', 400)).toEqual(['hello there']);
  });

  it('never floods the frame with lines', () => {
    const lines = wrapText(ctx2d, Array.from({ length: 60 }, () => 'word').join(' '), 100);
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it('copes with empty text', () => {
    expect(wrapText(ctx2d, '   ', 200)).toEqual([]);
  });
});
