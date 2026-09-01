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
  applyOperations, validateOperations, parseStyle, parsePosition, parsePlacement,
  parseAlign, textTargets, groundOperations,
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


/**
 * The conversation that produced two names on screen and no way to delete
 * either: "add my name" → "move it to top corner" → a SECOND overlay appeared
 * → "remove the one on the bottom" → "I can't target just the bottom text".
 */
describe('corners', () => {
  it('reads a corner out of the phrase, and picks a side when none is named', () => {
    expect(parsePlacement('top corner')).toEqual({ position: 'top', align: 'right' });
    expect(parsePlacement('top left')).toEqual({ position: 'top', align: 'left' });
    expect(parsePlacement('bottom right corner')).toEqual({ position: 'lower', align: 'right' });
    expect(parsePlacement('middle')).toEqual({ position: 'centre', align: 'centre' });
  });

  it('reads a side on its own', () => {
    expect(parseAlign('left')).toBe('left');
    expect(parseAlign('on the right please')).toBe('right');
    expect(parseAlign('somewhere')).toBe('centre');
  });

  it('places text in the corner asked for', () => {
    const out = applyOperations(clips(), [
      { op: 'add_text', text: 'Blessing Muya', position: 'top', align: 'right', startS: 0, endS: 19 },
    ], ctx);
    const txt = out.clips.find(c => c.id.startsWith('txt-'));
    expect(txt?.textPosition).toBe('top');
    expect(txt?.textAlign).toBe('right');
    expect(out.summary).toMatch(/top right corner/i);
  });
});

describe('removing without saying which one', () => {
  const two = (): TimelineClip[] => ([
    ...clips(),
    { id: 'txt-0', trackId: 'text', label: 'Blessing Muya', startS: 0, endS: 19,
      type: 'text', textPosition: 'top', textAlign: 'right' },
    { id: 'txt-1', trackId: 'text', label: 'Subscribe', startS: 0, endS: 19,
      type: 'text', textPosition: 'lower' },
  ]);

  it('asks which one instead of deleting both', () => {
    const out = applyOperations(two(), [{ op: 'remove_text' }], ctx);
    expect(out.clips.filter(c => c.id.startsWith('txt-')),
      'both overlays were deleted on an ambiguous request').toHaveLength(2);
    expect(out.summary).toMatch(/more than one/i);
    expect(out.summary).toMatch(/Blessing Muya/);
    expect(out.summary).toMatch(/Subscribe/);
  });

  it('just does it when there is only one', () => {
    const one = two().filter(c => c.id !== 'txt-1');
    const out = applyOperations(one, [{ op: 'remove_text' }], ctx);
    expect(out.clips.filter(c => c.id.startsWith('txt-'))).toHaveLength(0);
  });

  it('just does it when they say all of them', () => {
    const out = applyOperations(two(), [{ op: 'remove_text', all: true }], ctx);
    expect(out.clips.filter(c => c.id.startsWith('txt-'))).toHaveLength(0);
  });
});

describe('reading the target out of the message when the model left it off', () => {
  it('takes the bottom from "remove the one on the buttom"', () => {
    const [op] = groundOperations([{ op: 'remove_text' }], 'remove the one on the buttom');
    expect(op).toMatchObject({ op: 'remove_text', position: 'lower' });
  });

  it('takes the top from "delete the top one"', () => {
    const [op] = groundOperations([{ op: 'remove_text' }], 'delete the top one');
    expect(op).toMatchObject({ op: 'remove_text', position: 'top' });
  });

  it('reads "remove all the text" as all of it', () => {
    const [op] = groundOperations([{ op: 'remove_text' }], 'remove all the text');
    expect(op).toMatchObject({ op: 'remove_text', all: true });
  });

  it('leaves a target the model did give alone', () => {
    const [op] = groundOperations(
      [{ op: 'remove_text', match: 'subscribe' }], 'remove the one at the top');
    expect(op).toMatchObject({ match: 'subscribe' });
    expect((op as { position?: string }).position).toBeUndefined();
  });

  it('leaves it ambiguous when the message says nothing either', () => {
    const [op] = groundOperations([{ op: 'remove_text' }], 'remove the text');
    expect((op as { position?: string }).position).toBeUndefined();
  });

  it('grounds a bare move_text the same way', () => {
    const [op] = groundOperations([{ op: 'move_text' }], 'move it to the top');
    expect(op).toMatchObject({ op: 'move_text', position: 'top' });
  });
});

describe('the Subscribe conversation', () => {
  /** Replayed from a real session where a correction deleted the overlay. */
  const withSub = (): TimelineClip[] => ([
    ...clips(),
    { id: 'txt-0', trackId: 'text', label: 'Subscribe', startS: 0, endS: 53,
      type: 'text', textPosition: 'top', textAlign: 'centre' },
  ]);

  it('reads "at top write" as the top right corner', () => {
    const out = applyOperations(withSub(),
      groundOperations([{ op: 'move_text', match: 'Subscribe' }], 'at top write'), ctx);
    const sub = out.clips.find(c => c.id === 'txt-0');
    expect(sub?.textPosition).toBe('top');
    expect(sub?.textAlign, '"write" was not read as "right"').toBe('right');
  });

  it('does not delete anything for "no top write"', () => {
    const out = applyOperations(withSub(),
      groundOperations([{ op: 'remove_text' }], 'no top write'), ctx);
    const sub = out.clips.find(c => c.id === 'txt-0');
    expect(sub, 'a correction was read as a deletion').toBeTruthy();
    expect(sub?.textPosition).toBe('top');
    expect(sub?.textAlign).toBe('right');
  });

  it('asks first when a removal was never actually asked for', () => {
    const out = applyOperations(withSub(),
      groundOperations([{ op: 'remove_text', match: 'Subscribe' }], 'hmm not sure'), ctx);
    expect(out.clips.find(c => c.id === 'txt-0')).toBeTruthy();
    expect(out.summary).toMatch(/say "remove it"/i);
  });

  it('still deletes when the words do ask for it', () => {
    const out = applyOperations(withSub(),
      groundOperations([{ op: 'remove_text', match: 'Subscribe' }],
                       'remove the subscribe text'), ctx);
    expect(out.clips.find(c => c.id === 'txt-0')).toBeFalsy();
  });

  it('puts it back instead of saying there is nothing to move', () => {
    const out = applyOperations(clips(),
      [{ op: 'move_text', match: 'Subscribe', position: 'top', align: 'right' }],
      { durationS: 53, previousClips: withSub() });
    const sub = out.clips.find(c => c.label === 'Subscribe');
    expect(sub, 'the editor refused instead of restoring it').toBeTruthy();
    expect(sub?.textPosition).toBe('top');
    expect(sub?.textAlign).toBe('right');
    expect(out.summary).toMatch(/back/i);
  });

  it('adds the words when there is nothing to put back either', () => {
    const out = applyOperations(clips(),
      [{ op: 'move_text', match: 'Subscribe', position: 'top', align: 'right' }],
      { durationS: 53 });
    const sub = out.clips.find(c => c.label === 'Subscribe');
    expect(sub?.textPosition).toBe('top');
    expect(out.summary).toMatch(/no "Subscribe" on screen, so I added it/i);
  });

  it('describes a restore as a restore, in words a person can check', () => {
    const out = applyOperations(clips(),
      [{ op: 'move_text', match: 'Subscribe', position: 'top', align: 'left' }],
      { durationS: 53, previousClips: withSub() });
    expect(out.summary).toMatch(/^put "Subscribe" back in the top left corner/);
  });

  it('still says so when there is nothing at all to go on', () => {
    const out = applyOperations(clips(), [{ op: 'move_text', position: 'top' }], ctx);
    expect(out.summary).toMatch(/no text on screen to move/i);
  });
});

describe('typos', () => {
  it('reads the ways people actually spell bottom', () => {
    for (const w of ['bottom', 'buttom', 'bottum', 'buttom corner', 'at the botom'])
      expect(parsePosition(w), `"${w}" was not understood`).toBe('lower');
  });
});

describe('moving text that is already on screen', () => {
  const named = () => applyOperations(clips(), [
    { op: 'add_text', text: 'Blessing Muya', position: 'lower', startS: 0, endS: 19 },
  ], ctx).clips;

  it('moves the one that is there instead of adding a second', () => {
    const moved = applyOperations(named(), [
      { op: 'move_text', match: 'Blessing', position: 'top', align: 'right' },
    ], ctx);
    const overlays = moved.clips.filter(c => c.id.startsWith('txt-'));
    expect(overlays, 'a second copy was created').toHaveLength(1);
    expect(overlays[0].textPosition).toBe('top');
    expect(overlays[0].textAlign).toBe('right');
  });

  it('treats re-adding the same words over the same span as a move, not a twin', () => {
    const again = applyOperations(named(), [
      { op: 'add_text', text: 'Blessing Muya', position: 'top', align: 'right', startS: 0, endS: 19 },
    ], ctx);
    const overlays = again.clips.filter(c => c.id.startsWith('txt-'));
    expect(overlays, 'the editor ended up with two of the same name').toHaveLength(1);
    expect(overlays[0].textPosition).toBe('top');
    expect(again.summary).toMatch(/^moved/);
  });

  it('still allows the same words twice at different times', () => {
    const twice = applyOperations(named(), [
      { op: 'add_text', text: 'Blessing Muya', position: 'top', startS: 30, endS: 40 },
    ], { durationS: 100 });
    expect(twice.clips.filter(c => c.id.startsWith('txt-'))).toHaveLength(2);
  });

  it('says there is nothing to move when the screen is bare', () => {
    const out = applyOperations(clips(), [{ op: 'move_text', position: 'top' }], ctx);
    expect(out.summary).toMatch(/no text on screen to move/i);
  });
});

describe('removing one piece of text and keeping the other', () => {
  /** Exactly the state the editor was left in: two overlays, top and bottom. */
  const twoOverlays = (): TimelineClip[] => ([
    ...clips(),
    { id: 'txt-0', trackId: 'text', label: 'blessing muya', startS: 0, endS: 19,
      type: 'text', textPosition: 'lower' },
    { id: 'txt-1', trackId: 'text', label: 'blessing muya', startS: 0, endS: 19,
      type: 'text', textPosition: 'top' },
  ]);

  it('removes the one at the bottom and leaves the one at the top', () => {
    const out = applyOperations(twoOverlays(), [
      { op: 'remove_text', position: 'lower' },
    ], ctx);
    const left = out.clips.filter(c => c.id.startsWith('txt-'));
    expect(left).toHaveLength(1);
    expect(left[0].textPosition).toBe('top');
  });

  it('removes by the words when there is only one of them', () => {
    const mixed: TimelineClip[] = [
      ...clips(),
      { id: 'txt-0', trackId: 'text', label: 'Blessing Muya', startS: 0, endS: 19, type: 'text', textPosition: 'top' },
      { id: 'txt-1', trackId: 'text', label: 'Subscribe', startS: 0, endS: 19, type: 'text', textPosition: 'lower' },
    ];
    const out = applyOperations(mixed, [{ op: 'remove_text', match: 'subscribe' }], ctx);
    const left = out.clips.filter(c => c.id.startsWith('txt-'));
    expect(left.map(c => c.label)).toEqual(['Blessing Muya']);
  });

  it('takes everything off when asked for all of it', () => {
    const out = applyOperations(twoOverlays(), [{ op: 'remove_text', all: true }], ctx);
    expect(out.clips.filter(c => c.type === 'text' || c.type === 'subtitle')).toHaveLength(0);
  });

  it('leaves the captions alone when removing an overlay', () => {
    let cur = applyOperations(twoOverlays(), [
      { op: 'add_captions', position: 'lower', everyS: 10 }], withTranscript).clips;
    cur = applyOperations(cur, [{ op: 'remove_text', position: 'top' }], ctx).clips;
    expect(cur.filter(c => c.id.startsWith('cap-')).length).toBe(2);
    expect(cur.filter(c => c.id.startsWith('txt-')).length).toBe(1);
  });

  it('says so plainly when nothing matches, rather than removing the wrong thing', () => {
    const out = applyOperations(twoOverlays(), [{ op: 'remove_text', match: 'never written' }], ctx);
    expect(out.summary).toMatch(/no text matched/i);
    expect(out.clips.filter(c => c.id.startsWith('txt-'))).toHaveLength(2);
  });

  it('picks out targets by words or by where they sit', () => {
    const cl = twoOverlays();
    expect(textTargets(cl, undefined, 'lower')).toEqual(['txt-0']);
    expect(textTargets(cl, undefined, 'top')).toEqual(['txt-1']);
    expect(textTargets(cl, 'blessing')).toEqual(['txt-0', 'txt-1']);
    expect(textTargets(cl, 'nothing like this')).toEqual([]);
  });
});
