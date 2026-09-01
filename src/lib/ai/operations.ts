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
  textStyle?:    TextStyle;
}

export type Operation =
  | { op: 'remove_ranges'; ranges: [number, number][] }
  | { op: 'keep_ranges';   ranges: [number, number][] }
  | { op: 'trim_to';       targetS: number }
  | { op: 'add_captions';  position: TextPosition; everyS: number; style?: TextStyle }
  | { op: 'add_text';      text: string; position: TextPosition; startS: number; endS: number; style?: TextStyle }
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

const WHERE_SAID: Record<TextPosition, string> = {
  top: 'across the top', centre: 'in the middle', lower: 'along the bottom',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && isFinite(v) ? v : fallback;

/* ─────────────── validation ─────────────── */

const POSITIONS: TextPosition[] = ['top', 'centre', 'lower'];

/** Words people actually use for a position, mapped to the three we render. */
export function parsePosition(raw: unknown, fallback: TextPosition = 'lower'): TextPosition {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (POSITIONS.includes(v as TextPosition)) return v as TextPosition;
  if (/^(top|upper|above|head)/.test(v))            return 'top';
  if (/(middle|center|centre|mid)/.test(v))         return 'centre';
  if (/(bottom|lower|below|under|subtitle)/.test(v))return 'lower';
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
          position: parsePosition(o.position, 'lower'),
          everyS:   clamp(num(o.everyS, 3), 1, 15),
          style:    parseStyle(o.style),
        });
        break;
      case 'add_text': {
        // A text overlay is only as good as its words: no words, no operation.
        const text = String(o.text ?? '').trim().slice(0, 200);
        if (!text) break;
        const startS = clamp(num(o.startS, 0), 0, ctx.durationS);
        const endS   = clamp(num(o.endS, ctx.durationS), 0, ctx.durationS);
        if (endS - startS < 0.1) break;
        out.push({
          op: 'add_text', text,
          position: parsePosition(o.position, 'centre'),
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
        const id = `txt-${working.filter(c => c.id.startsWith('txt-')).length}`;
        working.push({
          id, trackId: 'text', label: op.text,
          startS: Number(op.startS.toFixed(3)),
          endS:   Number(op.endS.toFixed(3)),
          type:   'text',
          textPosition: op.position,
          ...(op.style ? { textStyle: op.style } : {}),
        });
        applied.push(op);
        affected.add(id);
        notes.push(`"${op.text.slice(0, 40)}" ${WHERE_SAID[op.position]} from ${fmt(op.startS)} to ${fmt(op.endS)}`);
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
