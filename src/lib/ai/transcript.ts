/**
 * Transcript handling, shared by the server route and the editing brain.
 *
 * A transcript is the difference between "18 empty caption slots" and captions
 * with the actual words in them, and between refusing to remove filler words
 * and being able to cut them precisely. Everything here is plain data with
 * timestamps on the project timeline.
 */

export interface TranscriptSegment {
  startS: number;
  endS:   number;
  text:   string;
}

export interface Transcript {
  segments: TranscriptSegment[];
  /** BCP-47 code the provider detected, when it reports one. */
  language: string;
  /** Model that produced it, for honesty in the UI. */
  model:    string;
  /** ISO timestamp. */
  madeAt:   string;
}

/** Words that add nothing and are safe to cut, given exact timings. */
const FILLERS = [
  'um', 'uh', 'erm', 'ah', 'eh', 'hmm', 'mmm',
  'like', 'basically', 'literally', 'actually',
  'you know', 'i mean', 'sort of', 'kind of',
];

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Segments whose entire content is filler — the only ones safe to remove wholesale. */
export function fillerRanges(t: Transcript | null): [number, number][] {
  if (!t) return [];
  const out: [number, number][] = [];
  for (const seg of t.segments) {
    const text = normalise(seg.text);
    if (!text) continue;
    const stripped = FILLERS.reduce((acc, f) => acc.replaceAll(f, ' '), ` ${text} `)
      .replace(/\s+/g, ' ').trim();
    if (stripped === '' && seg.endS > seg.startS) {
      out.push([seg.startS, seg.endS]);
    }
  }
  return out;
}

/** Words too common to be worth searching for. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'that', 'this', 'with', 'from', 'they',
  'was', 'are', 'not', 'but', 'his', 'her', 'she', 'him', 'has', 'had', 'have',
  'about', 'into', 'over', 'out', 'get', 'got', 'can', 'will', 'what', 'when',
  'where', 'who', 'why', 'how', 'find', 'show', 'part', 'bit', 'talk', 'talks',
  'talking', 'says', 'said', 'say', 'video', 'clip',
]);

/** Segments that mention any of the given words, for "find where they talk about X". */
export function segmentsMatching(t: Transcript | null, query: string): TranscriptSegment[] {
  if (!t || !query.trim()) return [];
  const terms = normalise(query).split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  if (!terms.length) return [];
  return t.segments.filter(seg => {
    const text = normalise(seg.text);
    return terms.some(term => text.includes(term));
  });
}

/**
 * A compact rendering for the model's prompt. Long transcripts are trimmed
 * from the middle, keeping the start and end, so the shape of the piece
 * survives without blowing the context window.
 */
export function transcriptForPrompt(t: Transcript | null, maxChars = 6000): string {
  if (!t || t.segments.length === 0) {
    return '(no transcript — speech recognition has not run for this project)';
  }
  const line = (s: TranscriptSegment) =>
    `[${s.startS.toFixed(1)}-${s.endS.toFixed(1)}] ${s.text.trim()}`;

  const all = t.segments.map(line);
  const joined = all.join('\n');
  if (joined.length <= maxChars) return joined;

  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  for (const l of all) {
    if (used + l.length > maxChars * 0.6) break;
    head.push(l); used += l.length + 1;
  }
  used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (used + all[i].length > maxChars * 0.4) break;
    tail.unshift(all[i]); used += all[i].length + 1;
  }
  const skipped = all.length - head.length - tail.length;
  return [...head, `… ${skipped} segments omitted …`, ...tail].join('\n');
}

/** Guard against a provider returning something unexpected. */
export function sanitiseSegments(raw: unknown, durationS: number): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: TranscriptSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as Record<string, unknown>;
    const startS = Number(seg.start);
    const endS   = Number(seg.end);
    const text   = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (!Number.isFinite(startS) || !Number.isFinite(endS) || !text) continue;
    const a = Math.max(0, Math.min(startS, durationS));
    const b = Math.max(a, Math.min(endS, durationS));
    if (b - a < 0.01) continue;
    out.push({ startS: Number(a.toFixed(3)), endS: Number(b.toFixed(3)), text });
    if (out.length >= 5000) break;
  }
  return out.sort((x, y) => x.startS - y.startS);
}
