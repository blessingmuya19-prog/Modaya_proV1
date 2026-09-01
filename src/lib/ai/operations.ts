/**
 * Edit operations — the contract between the model and the timeline.
 *
 * The LLM is good at understanding "tighten the intro and drop the bit where I
 * ramble" and bad at arithmetic on timecodes. So it only ever chooses
 * *operations with parameters*; the actual edit is executed here, in code that
 * is deterministic, bounded and tested. A hallucinated timestamp gets clamped
 * or dropped rather than corrupting the timeline.
 */

export interface TimelineClip {
  id:      string;
  trackId: string;
  label:   string;
  startS:  number;
  endS:    number;
  type:    'video' | 'audio' | 'text' | 'subtitle';
}

export type Operation =
  | { op: 'remove_ranges'; ranges: [number, number][] }
  | { op: 'keep_ranges';   ranges: [number, number][] }
  | { op: 'trim_to';       targetS: number }
  | { op: 'add_captions';  position: 'lower' | 'centre'; everyS: number }
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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && isFinite(v) ? v : fallback;

/* ─────────────── validation ─────────────── */

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
          position: o.position === 'centre' ? 'centre' : 'lower',
          everyS:   clamp(num(o.everyS, 3), 1, 15),
        });
        break;
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
        const track = op.position === 'lower' ? 'subs' : 'text';
        working = working.filter(c => c.trackId !== track || c.type !== 'text');
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
              type:   'text',
            });
            n++;
            if (n >= 800) break;
          }
          notes.push(`${n} captions written from the transcript`);
        } else {
          for (const v of video) {
            for (let t = v.startS; t < v.endS - 0.4; t += op.everyS) {
              working.push({
                id: `cap-${n}`, trackId: track, label: 'Caption',
                startS: Number(t.toFixed(3)),
                endS:   Number(Math.min(v.endS, t + op.everyS * 0.9).toFixed(3)),
                type:   'text',
              });
              n++;
              if (n > 400) break;
            }
            if (n > 400) break;
          }
          notes.push(`${n} caption slots added`);
        }
        applied.push(op);
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
