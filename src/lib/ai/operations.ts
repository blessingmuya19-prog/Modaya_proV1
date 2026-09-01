/**
 * Edit operations — the contract between the model and the timeline.
 *
 * The LLM is good at understanding "tighten the intro and drop the bit where I
 * ramble" and bad at arithmetic on timecodes. So it only ever chooses
 * *operations with parameters*; the actual edit is executed here, in code that
 * is deterministic, bounded and tested. A hallucinated timestamp gets clamped
 * or dropped rather than corrupting the timeline.
 */

/** Where words sit in the frame. Nothing to do with which track holds them:
 *  the timeline is a list of tracks, the frame is a picture, and confusing
 *  the two is why asking for captions at the top used to move them to the
 *  text track and change nothing on screen. */
export type TextPosition = 'top' | 'centre' | 'lower';

/** Across the frame. With TextPosition this gives the nine placements people
 *  mean by "top corner", "bottom right", "centred" and so on. */
export type TextAlign = 'left' | 'centre' | 'right';

export interface Placement { position: TextPosition; align: TextAlign }

/** How words look. Deliberately a short list of choices rather than free CSS:
 *  every font here is one the browser already has, so nothing has to be
 *  downloaded and captions can never render in a fallback face. */
export interface TextStyle {
  font?:       'sans' | 'serif' | 'mono' | 'display' | 'handwritten';
  size?:       'small' | 'medium' | 'large';
  /** #rgb or #rrggbb, or one of a few plain colour names. */
  colour?:     string;
  background?: 'box' | 'shadow' | 'none';
  bold?:       boolean;
  uppercase?:  boolean;
}

export interface TimelineClip {
  id:      string;
  trackId: string;
  label:   string;
  startS:  number;
  endS:    number;
  type:    'video' | 'audio' | 'text' | 'subtitle';
  /** Text clips only. */
  textPosition?: TextPosition;
  textAlign?:    TextAlign;
  textStyle?:    TextStyle;
}

export type Operation =
  | { op: 'remove_ranges'; ranges: [number, number][] }
  | { op: 'keep_ranges';   ranges: [number, number][] }
  | { op: 'trim_to';       targetS: number }
  | { op: 'add_captions';  position: TextPosition; align?: TextAlign; everyS: number; style?: TextStyle }
  | { op: 'add_text';      text: string; position: TextPosition; align?: TextAlign;
                           startS: number; endS: number; style?: TextStyle }
  | { op: 'move_text';     match?: string; position?: TextPosition; align?: TextAlign }
  | { op: 'remove_text';   match?: string; position?: TextPosition; all?: boolean }
  | { op: 'style_text';    target: 'captions' | 'all'; style: TextStyle }
  | { op: 'punch_in';      rate: number }
  | { op: 'grade';         brightness: number; contrast: number; saturation: number }
  | { op: 'none' };

export interface OperationContext {
  durationS: number;
  /** Silent spans measured in the browser, [start, end] in seconds. */
  silences?: [number, number][];
  /** Speech recognition output, when it has run. Gives captions real words. */
  transcript?: { segments: { startS: number; endS: number; text: string }[] } | null;
}

export interface EditOutcome {
  clips:       TimelineClip[];
  removedS:    number;
  affectedIds: string[];
  summary:     string;
  applied:     Operation[];
}

/** Which text clips a request is about: by words, by where they sit, or all
 *  of them. Vague enough to match how people describe what is on screen,
 *  strict enough that "remove the bottom one" never takes the top one too. */
export function textTargets(
  clips: TimelineClip[], match?: string, position?: TextPosition,
): string[] {
  const text = clips.filter(c => c.type === 'text' || c.type === 'subtitle');
  const needle = (match ?? '').trim().toLowerCase();

  let hits = text;
  if (needle) hits = hits.filter(c => c.label.trim().toLowerCase().includes(needle));
  if (position) {
    hits = hits.filter(c =>
      (c.textPosition ?? (c.trackId === 'subs' ? 'lower' : 'centre')) === position);
  }
  // Nothing described? Then it means the overlays, not the captions.
  if (!needle && !position) hits = text.filter(c => c.id.startsWith('txt-'));
  return hits.map(c => c.id);
}

const ALIGN_SAID: Record<TextAlign, string> = {
  left: 'on the left', centre: '', right: 'on the right',
};

function placeSaid(position: TextPosition, align?: TextAlign): string {
  const where = WHERE_SAID[position];
  const side  = align ? ALIGN_SAID[align] : '';
  if (!side) return where;
  // "across the top on the right" reads better as "in the top right corner"
  if (position === 'top')   return `in the top ${align} corner`;
  if (position === 'lower') return `in the bottom ${align} corner`;
  return `${where} ${side}`;
}

const WHERE_SAID: Record<TextPosition, string> = {
  top: 'across the top', centre: 'in the middle', lower: 'along the bottom',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && isFinite(v) ? v : fallback;

/* ─────────────── validation ─────────────── */

const POSITIONS: TextPosition[] = ['top', 'centre', 'lower'];

/** Which side of the frame, from the words people use. */
export function parseAlign(raw: unknown, fallback: TextAlign = 'centre'): TextAlign {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (/\bleft\b/.test(v))  return 'left';
  if (/\bright\b/.test(v)) return 'right';
  if (/\b(centre|center|middle)\b/.test(v)) return 'centre';
  return fallback;
}

/**
 * A whole placement out of one phrase — "top corner", "bottom right",
 * "middle". A corner with no side named is the right-hand one, where a
 * watermark normally goes; the reply says which corner was chosen so it can
 * be moved with one word.
 */
export function parsePlacement(raw: unknown, fallback: Placement = { position: 'lower', align: 'centre' }): Placement {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return fallback;

  const position = parsePosition(v, fallback.position);
  let align = parseAlign(v, /corner/.test(v) ? 'right' : fallback.align);
  if (/corner/.test(v) && align === 'centre') align = 'right';
  return { position, align };
}

/** Words people actually use for a position, mapped to the three we render. */
export function parsePosition(raw: unknown, fallback: TextPosition = 'lower'): TextPosition {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (POSITIONS.includes(v as TextPosition)) return v as TextPosition;
  if (/^(top|upper|above|head)/.test(v))            return 'top';
  if (/(middle|center|centre|mid)/.test(v))         return 'centre';
  if (/(b[ou]tt?[ou]m|lower|below|under|subtitle|beneath)/.test(v)) return 'lower';
  return fallback;
}

const COLOUR_NAMES: Record<string, string> = {
  white:'#ffffff', black:'#000000', yellow:'#ffd400', red:'#ff3b30', green:'#34c759',
  blue:'#0a84ff', orange:'#ff9f0a', pink:'#ff2d55', purple:'#bf5af2', grey:'#8e8e93',
  gray:'#8e8e93', cyan:'#32ade6',
};

function parseColour(raw: unknown): string | undefined {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v.slice(1).split('').map(c => c + c).join('');
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return COLOUR_NAMES[v];
}

/** Keep only style choices we can actually render; drop the rest silently. */
export function parseStyle(raw: unknown): TextStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: TextStyle = {};

  const font = String(o.font ?? '').trim().toLowerCase();
  if (font) {
    if (/(serif)$|^serif|georgia|times/.test(font) && !/sans/.test(font)) out.font = 'serif';
    else if (/mono|courier|code|typewriter/.test(font))                   out.font = 'mono';
    else if (/display|impact|bold ?title|headline|meme/.test(font))       out.font = 'display';
    else if (/hand|script|cursive|marker|brush/.test(font))               out.font = 'handwritten';
    else if (/sans|inter|helvetica|arial|default/.test(font))             out.font = 'sans';
  }

  const size = String(o.size ?? '').trim().toLowerCase();
  if (/small|tiny|little/.test(size))       out.size = 'small';
  else if (/large|big|huge|xl/.test(size))  out.size = 'large';
  else if (/medium|normal|regular/.test(size)) out.size = 'medium';

  const colour = parseColour(o.colour ?? o.color);
  if (colour) out.colour = colour;

  const bg = String(o.background ?? '').trim().toLowerCase();
  if (/box|band|block|plate/.test(bg))        out.background = 'box';
  else if (/shadow|outline|glow/.test(bg))    out.background = 'shadow';
  else if (/none|clear|transparent|off/.test(bg)) out.background = 'none';

  if (typeof o.bold === 'boolean')      out.bold = o.bold;
  if (typeof o.uppercase === 'boolean') out.uppercase = o.uppercase;

  return Object.keys(out).length ? out : undefined;
}

/**
 * Coerce whatever the model returned into operations we are willing to run.
 * Unknown ops, malformed ranges and out-of-range numbers are dropped, not
 * repaired by guesswork.
 */
/**
 * Fill in what the model left off from what the person actually typed.
 *
 * A model that answers "remove the one on the buttom" with a bare
 * {"op":"remove_text"} is asking to delete every overlay, which is not what
 * was said. The words are right there in the message, so read them.
 */
export function groundOperations(ops: Operation[], message: string): Operation[] {
  const said = message ?? '';
  const spot: TextPosition | undefined =
      /\b(b[ou]tt?[ou]m|lower|below|beneath)\b/i.test(said) ? 'lower'
    : /\b(top|upper|above)\b/i.test(said)                    ? 'top'
    : /\b(middle|centre|center)\b/i.test(said)               ? 'centre'
    : undefined;
  const everything = /\b(all|both|every|everything)\b/i.test(said);

  return ops.map(op => {
    if (op.op === 'remove_text' && !op.match && !op.position && !op.all)
      return everything ? { ...op, all: true } : { ...op, position: spot };
    if (op.op === 'move_text' && !op.match && !op.position)
      return { ...op, position: spot };
    return op;
  });
}

export function validateOperations(raw: unknown, ctx: OperationContext): Operation[] {
  if (!Array.isArray(raw)) return [];
  const out: Operation[] = [];

  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;

    switch (o.op) {
      case 'remove_ranges':
      case 'keep_ranges': {
        const ranges = normaliseRanges(o.ranges, ctx.durationS);
        if (ranges.length) out.push({ op: o.op, ranges } as Operation);
        break;
      }
      case 'trim_to': {
        const t = num(o.targetS, 0);
        if (t > 0.5 && t < ctx.durationS) out.push({ op: 'trim_to', targetS: t });
        break;
      }
      case 'add_captions':
        out.push({
          op: 'add_captions',
          position: parsePlacement(o.position, { position: 'lower', align: 'centre' }).position,
          align:    o.align ? parseAlign(o.align) : parsePlacement(o.position, { position:'lower', align:'centre' }).align,
          everyS:   clamp(num(o.everyS, 3), 1, 15),
          style:    parseStyle(o.style),
        });
        break;
      case 'move_text': {
        const match    = String(o.match ?? '').trim().slice(0, 120) || undefined;
        const place    = o.position ?? o.align ?? o.to ?? o.placement;
        const position = o.position === undefined && place === undefined
          ? undefined : parsePlacement(String(place ?? '')).position;
        const align    = o.align === undefined && place === undefined
          ? undefined : parsePlacement(String(o.align ?? place ?? '')).align;
        if (position === undefined && align === undefined) break;
        out.push({ op: 'move_text', match, position, align });
        break;
      }
      case 'remove_text': {
        out.push({
          op: 'remove_text',
          match: String(o.match ?? '').trim().slice(0, 120) || undefined,
          position: o.position === undefined ? undefined : parsePosition(o.position),
          all: o.all === true,
        });
        break;
      }
      case 'add_text': {
        // A text overlay is only as good as its words: no words, no operation.
        const text = String(o.text ?? '').trim().slice(0, 200);
        if (!text) break;
        const startS = clamp(num(o.startS, 0), 0, ctx.durationS);
        const endS   = clamp(num(o.endS, ctx.durationS), 0, ctx.durationS);
        if (endS - startS < 0.1) break;
        const placement = parsePlacement(o.position, { position: 'centre', align: 'centre' });
        out.push({
          op: 'add_text', text,
          position: placement.position,
          align:    o.align ? parseAlign(o.align) : placement.align,
          startS, endS,
          style: parseStyle(o.style),
        });
        break;
      }
      case 'style_text': {
        const style = parseStyle(o.style ?? o);
        if (!style) break;
        out.push({ op: 'style_text', target: o.target === 'all' ? 'all' : 'captions', style });
        break;
      }
      case 'punch_in':
        out.push({ op: 'punch_in', rate: clamp(num(o.rate, 0.3), 0, 1) });
        break;
      case 'grade':
        out.push({
          op:         'grade',
          brightness: clamp(num(o.brightness, 1), 0.6, 1.6),
          contrast:   clamp(num(o.contrast,   1), 0.6, 1.6),
          saturation: clamp(num(o.saturation, 1), 0,   2),
        });
        break;
      case 'none':
        out.push({ op: 'none' });
        break;
      default:
        break;    // unknown operation — ignore it
    }
  }
  return out;
}

function normaliseRanges(raw: unknown, durationS: number): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const ranges: [number, number][] = [];

  for (const r of raw.slice(0, 200)) {
    let s: number, e: number;
    if (Array.isArray(r) && r.length >= 2) {
      s = num(r[0], NaN); e = num(r[1], NaN);
    } else if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      s = num(o.startS ?? o.start ?? o.from, NaN);
      e = num(o.endS   ?? o.end   ?? o.to,   NaN);
    } else continue;

    if (!isFinite(s) || !isFinite(e)) continue;
    s = clamp(Math.min(s, e), 0, durationS);
    e = clamp(Math.max(s, e), 0, durationS);
    if (e - s >= 0.05) ranges.push([Number(s.toFixed(3)), Number(e.toFixed(3))]);
  }

  // merge overlaps so downstream maths stays simple
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 0.02) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  return merged;
}

/* ─────────────── execution ─────────────── */

/** Subtract spans from a clip, returning the surviving pieces. */
function subtract(clip: TimelineClip, cuts: [number, number][]): TimelineClip[] {
  let pieces: TimelineClip[] = [clip];

  for (const [cs, ce] of cuts) {
    const next: TimelineClip[] = [];
    for (const p of pieces) {
      if (ce <= p.startS || cs >= p.endS) { next.push(p); continue; }   // no overlap
      if (cs > p.startS) next.push({ ...p, id: `${p.id}`, endS: cs });
      if (ce < p.endS)   next.push({ ...p, id: `${p.id}-b`, startS: ce });
    }
    pieces = next;
  }
  // re-id split pieces so keys stay unique
  return pieces.map((p, i) => (i === 0 ? p : { ...p, id: `${clip.id}-${i}` }));
}

const invert = (keep: [number, number][], durationS: number): [number, number][] => {
  const cuts: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of keep) {
    if (s > cursor) cuts.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < durationS) cuts.push([cursor, durationS]);
  return cuts;
};

const span = (rs: [number, number][]) => rs.reduce((a, [s, e]) => a + (e - s), 0);

export function applyOperations(
  clips: TimelineClip[], ops: Operation[], ctx: OperationContext,
): EditOutcome {
  let working = clips.filter(c => c.endS > c.startS);
  const applied: Operation[] = [];
  const notes: string[] = [];
  let removedS = 0;
  const affected = new Set<string>();

  for (const op of ops) {
    switch (op.op) {
      case 'remove_ranges': {
        const before = totalLength(working);
        working = cutOut(working, op.ranges, affected);
        const delta = before - totalLength(working);
        removedS += delta;
        notes.push(`${op.ranges.length} section${op.ranges.length === 1 ? '' : 's'} removed · −${fmt(delta)}`);
        applied.push(op);
        break;
      }
      case 'keep_ranges': {
        const before = totalLength(working);
        working = cutOut(working, invert(op.ranges, ctx.durationS), affected);
        const delta = before - totalLength(working);
        removedS += delta;
        notes.push(`kept ${fmt(span(op.ranges))} · −${fmt(delta)}`);
        applied.push(op);
        break;
      }
      case 'trim_to': {
        const before = totalLength(working);
        if (before > op.targetS) {
          // Trim from the tail — the only defensible cut without content scoring
          working = cutOut(working, [[op.targetS, ctx.durationS]], affected);
          const delta = before - totalLength(working);
          removedS += delta;
          notes.push(`trimmed to ${fmt(op.targetS)} · −${fmt(delta)}`);
        }
        applied.push(op);
        break;
      }
      case 'add_captions': {
        /* The track is bookkeeping; the position is what you see. Captions
           live on the subs track wherever they sit in the frame, because
           that is where captions belong on a timeline. */
        const track = 'subs';
        const kind: TimelineClip['type'] = 'subtitle';
        const where = op.position;
        /* Clear the previous captions from BOTH caption tracks, not just the
           one being written. Asking for captions lower down used to leave the
           old middle-of-the-frame set behind, so the screen still showed
           captions in the middle however many times they were moved. */
        const isCaption = (c: TimelineClip) =>
          (c.type === 'text' || c.type === 'subtitle') &&
          (c.id.startsWith('cap-') || c.trackId === track);
        working = working.filter(c => !(isCaption(c) && (c.trackId === 'subs' || c.trackId === 'text')));
        const video = working.filter(c => c.type === 'video').sort((a, b) => a.startS - b.startS);
        const spoken = ctx.transcript?.segments ?? [];
        let n = 0;

        if (spoken.length > 0) {
          // Real words at the times they were said. Only caption spans that
          // survive on the timeline, so captions never appear over cut footage.
          for (const seg of spoken) {
            const host = video.find(v => seg.startS < v.endS && seg.endS > v.startS);
            if (!host) continue;
            const startS = Math.max(seg.startS, host.startS);
            const endS   = Math.min(seg.endS,   host.endS);
            if (endS - startS < 0.12) continue;
            working.push({
              id: `cap-${n}`, trackId: track, label: seg.text.slice(0, 120),
              startS: Number(startS.toFixed(3)),
              endS:   Number(endS.toFixed(3)),
              type:   kind,
              textPosition: where,
              ...(op.align ? { textAlign: op.align } : {}),
              ...(op.style ? { textStyle: op.style } : {}),
            });
            n++;
            if (n >= 800) break;
          }
          notes.push(n > 0
            ? `${n} captions written from the transcript, ${WHERE_SAID[where]}`
            : video.length === 0
              ? 'no clips on the timeline to caption yet'
              : 'the transcript does not overlap any clip left on the timeline');
        } else {
          for (const v of video) {
            for (let t = v.startS; t < v.endS - 0.4; t += op.everyS) {
              working.push({
                id: `cap-${n}`, trackId: track, label: 'Caption',
                startS: Number(t.toFixed(3)),
                endS:   Number(Math.min(v.endS, t + op.everyS * 0.9).toFixed(3)),
                type:   kind,
                textPosition: where,
                ...(op.style ? { textStyle: op.style } : {}),
              });
              n++;
              if (n > 400) break;
            }
            if (n > 400) break;
          }
          notes.push(`${n} caption slots added, ${WHERE_SAID[where]}`);
        }
        applied.push(op);
        break;
      }
      case 'add_text': {
        /* Words the person supplied, on screen for a span of their choosing.
           Separate from captions: captions come from the transcript and get
           rewritten every time they are regenerated, whereas a name or a
           title is yours and must survive that. */

        /* "Move it to the top corner" reaches here as another add_text with
           the same words. Adding a second copy is how you end up with two
           names on screen and no way to say which one to delete, so the same
           words over the same span are treated as a move. */
        const twin = working.find(c =>
          c.id.startsWith('txt-') &&
          c.label.trim().toLowerCase() === op.text.trim().toLowerCase() &&
          op.startS < c.endS && op.endS > c.startS);

        if (twin) {
          working = working.map(c => c.id === twin.id ? {
            ...c,
            textPosition: op.position,
            textAlign:    op.align ?? c.textAlign,
            ...(op.style ? { textStyle: { ...(c.textStyle ?? {}), ...op.style } } : {}),
          } : c);
          applied.push(op);
          affected.add(twin.id);
          notes.push(`moved "${op.text.slice(0, 40)}" ${placeSaid(op.position, op.align)}`);
          break;
        }

        const id = `txt-${working.filter(c => c.id.startsWith('txt-')).length}`;
        working.push({
          id, trackId: 'text', label: op.text,
          startS: Number(op.startS.toFixed(3)),
          endS:   Number(op.endS.toFixed(3)),
          type:   'text',
          textPosition: op.position,
          ...(op.align ? { textAlign: op.align } : {}),
          ...(op.style ? { textStyle: op.style } : {}),
        });
        applied.push(op);
        affected.add(id);
        notes.push(`"${op.text.slice(0, 40)}" ${placeSaid(op.position, op.align)} from ${fmt(op.startS)} to ${fmt(op.endS)}`);
        break;
      }

      case 'move_text': {
        const targets = textTargets(working, op.match, undefined);
        if (!targets.length) { notes.push('no text on screen to move'); break; }
        working = working.map(c => targets.includes(c.id) ? {
          ...c,
          textPosition: op.position ?? c.textPosition,
          textAlign:    op.align    ?? c.textAlign,
        } : c);
        targets.forEach(id => affected.add(id));
        applied.push(op);
        const moved = working.find(c => c.id === targets[0]);
        notes.push(`moved ${targets.length === 1 ? `"${moved?.label.slice(0, 40)}"` : `${targets.length} text clips`} ` +
                   placeSaid(moved?.textPosition ?? 'centre', moved?.textAlign));
        break;
      }

      case 'remove_text': {
        const targets = op.all
          ? working.filter(c => c.type === 'text' || c.type === 'subtitle').map(c => c.id)
          : textTargets(working, op.match, op.position);

        if (!targets.length) {
          notes.push(op.match || op.position
            ? 'no text matched that description'
            : 'there is no text on screen to remove');
          break;
        }

        /* "remove the text" with several on screen and nothing to tell them
           apart: ask instead of deleting the lot. Guessing wrong here costs
           the user work they can't get back. */
        if (!op.all && !op.match && !op.position && targets.length > 1) {
          const list = working
            .filter(c => targets.includes(c.id))
            .map(c => `"${c.label.slice(0, 30)}" (${placeSaid(c.textPosition ?? 'lower', c.textAlign ?? 'centre')})`)
            .join(' and ');
          notes.push(`there is more than one: ${list} — which should go?`);
          break;
        }

        const gone = working.filter(c => targets.includes(c.id));
        working = working.filter(c => !targets.includes(c.id));
        applied.push(op);
        targets.forEach(id => affected.add(id));
        notes.push(gone.length === 1
          ? `removed "${gone[0].label.slice(0, 40)}"`
          : `removed ${gone.length} text clips`);
        break;
      }
      case 'style_text': {
        /* Restyle what is already there, rather than rewriting the words —
           so "same captions, different font" does not re-run recognition. */
        let touched = 0;
        working = working.map(c => {
          const isText = c.type === 'text' || c.type === 'subtitle';
          if (!isText) return c;
          if (op.target === 'captions' && !c.id.startsWith('cap-')) return c;
          touched++;
          affected.add(c.id);
          return { ...c, textStyle: { ...(c.textStyle ?? {}), ...op.style } };
        });
        applied.push(op);
        notes.push(touched > 0
          ? `restyled ${touched} text ${touched === 1 ? 'clip' : 'clips'}`
          : 'no text on the timeline to restyle');
        break;
      }
      case 'punch_in':
      case 'grade':
        // Look-only operations: recorded for the render layer, no clip changes
        applied.push(op);
        notes.push(op.op === 'punch_in' ? 'push-ins applied' : 'colour graded');
        break;
      case 'none':
      default:
        break;
    }
  }

  working.sort((a, b) => a.startS - b.startS);

  return {
    clips:       working,
    removedS:    Number(removedS.toFixed(2)),
    affectedIds: [...affected].slice(0, 8),
    summary:     notes.join(' · ') || 'No change',
    applied,
  };
}

function cutOut(clips: TimelineClip[], cuts: [number, number][], affected: Set<string>): TimelineClip[] {
  if (!cuts.length) return clips;
  const out: TimelineClip[] = [];
  for (const c of clips) {
    const touched = cuts.some(([s, e]) => e > c.startS && s < c.endS);
    if (touched) affected.add(c.id);
    out.push(...subtract(c, cuts).filter(p => p.endS - p.startS > 0.08));
  }
  return out;
}

const totalLength = (clips: TimelineClip[]) =>
  clips.filter(c => c.type === 'video').reduce((a, c) => a + (c.endS - c.startS), 0);

function fmt(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/* ─────────────── silence detection (runs on the client's envelope) ─────────── */

/**
 * Silent spans from an RMS envelope. Real measurement, so "cut the pauses"
 * removes actual pauses rather than a percentage of the runtime.
 */
export function detectSilences(
  rms: number[], hopS: number,
  opts: { threshold?: number; minDurationS?: number; padS?: number } = {},
): [number, number][] {
  const threshold = opts.threshold ?? 0.06;
  const minDur    = opts.minDurationS ?? 0.45;
  const pad       = opts.padS ?? 0.08;

  const out: [number, number][] = [];
  let start: number | null = null;

  for (let i = 0; i < rms.length; i++) {
    const quiet = rms[i] < threshold;
    if (quiet && start === null) start = i;
    if (!quiet && start !== null) {
      pushSpan(out, start * hopS, i * hopS, minDur, pad);
      start = null;
    }
  }
  if (start !== null) pushSpan(out, start * hopS, rms.length * hopS, minDur, pad);
  return out;
}

function pushSpan(out: [number, number][], s: number, e: number, minDur: number, pad: number) {
  const a = s + pad, b = e - pad;
  if (b - a >= minDur) out.push([Number(a.toFixed(3)), Number(b.toFixed(3))]);
}
