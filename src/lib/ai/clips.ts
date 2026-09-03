/**
 * Clipping engine — turns one long video into several short, self-contained
 * clips in the OpusClip / Vizard style ("give me 5 clips for TikTok").
 *
 * It follows the same bargain as the rest of Modaya:
 *
 *   - With NO AI key it still works: clips are found from measurements taken
 *     in the browser — loudness (excitement), motion (visual energy) and the
 *     measured silences (natural cut points). Bounds snap to sentence gaps so
 *     a clip never starts or ends mid-word. Titles are honest placeholders.
 *     Deterministic: the same file always yields the same clips.
 *
 *   - With ANY free key (Groq, Google AI Studio, OpenRouter, Cloudflare or a
 *     local Ollama) the transcript is read for meaning: the model picks the
 *     genuinely interesting moments, writes a real hook title for each, and
 *     scores them for shareability. Every timestamp is still clamped and
 *     sanity-checked here — a hallucinated timecode can never escape.
 *
 * Nothing here throws on bad input; callers always get a usable list.
 */

import type { Transcript, TranscriptSegment } from './transcript';
import { meanOver, loudnessSparkline } from './highlights';
import type { VisualScan } from './visualScan';

/* ───────────────────────── types ───────────────────────── */

export type ClipSource = 'measurement' | 'ai' | 'hybrid';

export interface ClipSuggestion {
  /** Stable id within one run, clip-1 … clip-n, in time order. */
  id:      string;
  startS:  number;
  endS:    number;
  /** 0–100, shareability / excitement. */
  score:   number;
  /** Hook-style title the model wrote, or an honest measured placeholder. */
  title:   string;
  /** Why this span was chosen, in plain words — shown under the title. */
  reason:  string;
  /** Sentence that opens the clip, when a transcript exists. */
  hook?:   string;
  /** Topic tags the model attached, e.g. ["money","career"]. */
  tags:    string[];
  /** Where the answer came from, for honesty in the UI. */
  source:  ClipSource;
}

export interface ClipRequest {
  durationS:  number;
  /** How many clips to aim for. */
  count?:     number;
  /** Target clip length in seconds (defaults to the platform-friendly 45). */
  targetLenS?: number;
  /** Min/max clip length the caller will accept. */
  minLenS?:   number;
  maxLenS?:   number;
  /** RMS loudness curve measured in the browser; may be empty. */
  energy?:    number[];
  /** Silent spans [start,end], used as natural cut points. */
  silences?:  [number, number][];
  /** Shot changes / movement measured from the pixels; optional. */
  visual?:    VisualScan | null;
  /** Speech recognition output, when it has run. */
  transcript?: Transcript | null;
  /**
   * Where clips should come from. 'spread' (default) takes one strong clip from
   * each part of the video so the set covers the whole timeline. 'start' takes
   * the best clips from the beginning — for someone who wants the opening.
   */
  bias?:      'spread' | 'start';
}

/* ───────────────────────── request parsing ───────────────────────── */

/**
 * Read how many clips, how long, and from where, out of what a person typed.
 * Pure and forgiving: "give me 5 short clips", "30 seconds pls", "find 3",
 * "1 minute clips at the start" all resolve. Falls back to the caller's
 * defaults when a number isn't given.
 */
export function parseClipRequest(
  message: string,
  fallback: { count?: number; targetLenS?: number } = {},
): { count: number; targetLenS?: number; bias: 'spread' | 'start' } {
  const p = (message ?? '').toLowerCase();

  let count = fallback.count ?? 5;
  const countMatch =
    p.match(/(\d{1,2})\s*(?:short\s+)?(?:clips?|shorts?|videos?|posts?|reels?)\b/) ||
    p.match(/(?:give me|find(?: me)?|make(?: me)?|create|want|need|show(?: me)?)\s+(\d{1,2})\b/);
  if (countMatch) count = parseInt(countMatch[1], 10);

  let targetLenS = fallback.targetLenS;
  const secMatch = p.match(/(\d{1,3})\s*(?:sec(?:ond)?s?|s)\b/);
  const minMatch = p.match(/(\d{1,2})\s*min(?:ute)?s?\b/);
  if (secMatch)               targetLenS = parseInt(secMatch[1], 10);
  else if (minMatch)          targetLenS = parseInt(minMatch[1], 10) * 60;

  const atStart = /\b(?:at|from|near|in)\s+the\s+(?:start|beginning|front|top|opening)\b/
    .test(p) || /\b(beginning|opening|start of|front of)\b/.test(p) ||
    /at (the )?start|from (the )?top/.test(p);

  return {
    count:      clamp(Math.round(count) || 5, 1, 10),
    targetLenS: targetLenS ? clamp(Math.round(targetLenS), 10, 120) : undefined,
    bias:       atStart ? 'start' : 'spread',
  };
}

/* ───────────────────────── small helpers ───────────────────────── */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Mean visual motion over a span, 0..~1, from the measured scan samples. */
function motionOver(visual: VisualScan | null | undefined, fromS: number, toS: number): number {
  if (!visual?.samples?.length) return 0;
  const inSpan = visual.samples.filter(s => s.tS >= fromS && s.tS < toS);
  if (!inSpan.length) return 0;
  return inSpan.reduce((a, s) => a + (s.motion ?? 0), 0) / inSpan.length;
}

/** Mean loudness over a span (0..~1). */
function energyOver(energy: number[] | undefined, durationS: number, fromS: number, toS: number): number {
  if (!energy?.length) return 0;
  return meanOver(energy, durationS, fromS, toS);
}

/* ───────────────────────── bounds ───────────────────────── */

/**
 * Snap a raw boundary to a natural break so a clip starts and ends on a
 * sentence gap rather than mid-word.
 *
 * For a START: begin at the start of whatever sentence is already playing
 * when the window opens (that sentence is the clip's hook), or right after a
 * measured pause. For an END: finish at the end of the sentence the window is
 * inside, or just before a pause. Falls back to the nearest edge within a few
 * seconds, and otherwise leaves the time where it was. Every move is capped
 * so snapping can never stretch a clip out of shape.
 */
function snapBound(
  t: number, durationS: number,
  silences: [number, number][], segments: TranscriptSegment[],
  toward: 'start' | 'end',
): number {
  const NEAR    = 3;    // a gap/pause has to sit within this many seconds to count
  const MAXMOVE = 12;   // never shift a boundary by more than this

  // 1) A measured pause right beside the boundary is the cleanest cut there is.
  for (const [s, e] of silences) {
    if (toward === 'start' && e <= t && t - e <= NEAR) return clamp(e, 0, durationS);
    if (toward === 'end'   && s >= t && s - t <= NEAR) return clamp(s, 0, durationS);
  }

  // 2) The sentence playing when the boundary falls: join at its edge so the
  //    clip opens on a sentence start and closes on a sentence end.
  const containing = segments.find(seg => t >= seg.startS && t <= seg.endS);
  if (containing) {
    const edge = toward === 'start' ? containing.startS : containing.endS;
    if (Math.abs(edge - t) <= MAXMOVE) return clamp(edge, 0, durationS);
  }

  // 3) Otherwise the nearest segment edge within a few seconds.
  let best = t;
  let bestDist = NEAR;
  for (const seg of segments) {
    const cand = toward === 'start' ? seg.startS : seg.endS;
    if (cand < 0 || cand > durationS) continue;
    const d = Math.abs(cand - t);
    if (d < bestDist) { bestDist = d; best = cand; }
  }

  return clamp(Number(best.toFixed(2)), 0, durationS);
}

/* ───────────────────────── scoring ───────────────────────── */

/**
 * Score a candidate window 0–100 from real measurements. Loudness and motion
 * are normalised against the loudest/moving-est second of THIS video, so a
 * quiet podcast and a loud highlights reel both spread across the range.
 */
function scoreWindow(
  fromS: number, toS: number,
  energy: number[] | undefined, durationS: number,
  visual: VisualScan | null | undefined,
): number {
  const len = toS - fromS;
  const e = energyOver(energy, durationS, fromS, toS);
  const m = motionOver(visual, fromS, toS);

  const peakE = energy?.length ? Math.max(...energy, 1e-4) : 1;
  const loud = clamp(e / peakE, 0, 1);

  // Motion samples are already 0..~1-ish; compress so a talking-head video
  // (near-zero motion) still scores on what it has rather than collapsing to 0.
  const move = clamp(m * 6, 0, 1);

  // Blend: audio carries excitement, picture carries visual change. When one
  // of the two was never measured it simply drops out of the average.
  const haveE = energy && energy.length > 0;
  const haveM = !!visual?.samples?.length;
  let v: number;
  if (haveE && haveM)      v = 0.55 * loud + 0.45 * move;
  else if (haveE)          v = loud;
  else if (haveM)          v = move;
  else                     v = 0.5;   // nothing measured: neutral, not zero

  // A tiny length nudge: clips in the sweet spot (20–60s) slightly outrank
  // awkwardly short or long windows of the same energy.
  const sweet = len >= 20 && len <= 60 ? 1 : len >= 12 && len <= 90 ? 0.9 : 0.75;

  return Math.round(clamp(v * sweet, 0, 1) * 100);
}

/* ───────────────────────── measurement engine (no key) ───────────────────────── */

/** True when two spans overlap at all (a touch at a boundary is fine). */
function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end - 0.05 && a.end > b.start + 0.05;
}

/**
 * Choose the best non-overlapping windows.
 *
 * 'spread' divides the timeline into `count` equal zones and takes the
 * strongest window from each zone first, so the five results come from five
 * different parts of the video even when the loudness is flat — the old
 * greedy, sort-by-score approach otherwise stacked them all at the opening.
 * Remaining slots (a zone can be too short to host a full window near the end)
 * are filled with the next-best windows anywhere. 'start' simply takes the
 * earliest non-overlapping windows, for someone who wants the opening clips.
 */
function pickWindows(
  windows: { start: number; end: number; score: number }[],
  count: number, durationS: number, target: number,
  bias: 'spread' | 'start',
): { start: number; end: number; score: number }[] {
  const chosen: { start: number; end: number; score: number }[] = [];

  if (bias === 'start') {
    // Windows were generated in ascending start order; walk in that order.
    for (const w of windows) {
      if (chosen.length >= count) break;
      if (!chosen.some(c => overlaps(w, c))) chosen.push(w);
    }
    return chosen;
  }

  const zoneLen = durationS / count;
  // One best window per zone first — this guarantees spread.
  for (let z = 0; z < count; z++) {
    const zStart = z * zoneLen;
    const inZone = windows
      .filter(w => w.start >= zStart - 0.5 && w.start < zStart + zoneLen)
      .sort((a, b) => b.score - a.score || a.start - b.start);
    const pick = inZone.find(w => !chosen.some(c => overlaps(w, c)));
    if (pick) chosen.push(pick);
  }
  // Then the strongest remaining windows anywhere, still non-overlapping.
  const byScore = [...windows].sort((a, b) => b.score - a.score || a.start - b.start);
  for (const w of byScore) {
    if (chosen.length >= count) break;
    if (!chosen.some(c => overlaps(w, c))) chosen.push(w);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/**
 * Sliding-window search over the measured timeline. Scores every window, then
 * picks non-overlapping ones spread across the whole video (or from the start
 * when asked). Bounds snap to natural sentence/pause gaps.
 */
export function findClipsByMeasurement(req: ClipRequest): ClipSuggestion[] {
  const durationS = Math.max(0, req.durationS || 0);
  const count     = clamp(Math.round(req.count ?? 5), 1, 10);
  const target    = clamp(Math.round(req.targetLenS ?? 45), 10, 120);
  const minLen    = clamp(Math.round(req.minLenS ?? Math.max(15, target * 0.5)), 10, target);
  const maxLen    = clamp(Math.round(req.maxLenS ?? Math.min(120, target * 1.8)), target, 600);
  const energy    = req.energy ?? [];
  const silences  = req.silences ?? [];
  const segments  = req.transcript?.segments ?? [];
  const bias      = req.bias ?? 'spread';

  // A video shorter than one clip: the whole thing is the only honest answer.
  if (durationS <= maxLen) {
    const score = scoreWindow(0, durationS, energy, durationS, req.visual);
    return [{
      id: 'clip-1', startS: 0, endS: Number(durationS.toFixed(2)),
      score, title: measuredTitle(0, durationS, segments),
      reason: 'The whole video is already short enough to post as one clip.',
      hook: hookFor(0, durationS, segments), tags: [], source: 'measurement',
    }];
  }

  // Score candidate windows. Step at a tenth of the target length — precise
  // enough to matter, cheap enough to run on a long video in milliseconds.
  const step = Math.max(1, target / 10);
  const windows: { start: number; end: number; score: number }[] = [];
  for (let start = 0; start + target <= durationS + 1e-6; start += step) {
    windows.push({ start, end: start + target, score: scoreWindow(start, start + target, energy, durationS, req.visual) });
  }

  let chosen = pickWindows(windows, count, durationS, target, bias);

  // Fallback: nothing measured to go on (no audio, no visual). Spread clips
  // evenly across the video so the user still gets something to work with,
  // rather than an empty list.
  if (!chosen.length) {
    chosen = [];
    const zoneLen = durationS / count;
    for (let i = 0; i < count; i++) {
      chosen.push({ start: bias === 'start' ? i * target : i * zoneLen, end: 0, score: 50 });
    }
    chosen.forEach((w, i) => { w.end = Math.min(durationS, w.start + target); });
    chosen = chosen.filter(w => w.end - w.start >= minLen);
  }

  // Snap bounds to natural breaks and enforce min/max length. The snap can
  // shift an edge slightly, so overlaps introduced here are repaired after.
  const clips = chosen.map((w) => {
    let startS = snapBound(w.start, durationS, silences, segments, 'start');
    let endS   = snapBound(w.end,   durationS, silences, segments, 'end');
    if (endS - startS < minLen) endS = Math.min(durationS, startS + minLen);
    if (endS - startS > maxLen) endS = startS + maxLen;
    if (endS > durationS) { endS = durationS; startS = Math.max(0, endS - Math.min(maxLen, durationS)); }
    return { startS, endS, score: w.score };
  }).sort((a, b) => a.startS - b.startS);

  // Guarantee the snapped clips never overlap: clamp each clip's start up to
  // the previous clip's end (keep length where there's room).
  for (let i = 1; i < clips.length; i++) {
    if (clips[i].startS < clips[i - 1].endS) {
      const len = clips[i].endS - clips[i].startS;
      clips[i].startS = clips[i - 1].endS;
      clips[i].endS   = Math.min(durationS, clips[i].startS + len);
    }
  }

  return clips
    .filter(c => c.endS - c.startS >= minLen * 0.6)
    .map((c, i) => ({
      id:      `clip-${i + 1}`,
      startS:  Number(c.startS.toFixed(2)),
      endS:    Number(c.endS.toFixed(2)),
      score:   c.score,
      title:   measuredTitle(c.startS, c.endS, segments),
      reason:  measurementReason(c.startS, c.endS, energy, durationS, req.visual),
      hook:    hookFor(c.startS, c.endS, segments),
      tags:    [],
      source:  'measurement' as const,
    }));
}

/** The first full sentence inside a span — the line the clip opens on. */
function hookFor(startS: number, endS: number, segments: TranscriptSegment[]): string | undefined {
  const first = segments.find(s => s.endS > startS && s.startS < endS);
  const text = first?.text.trim();
  return text ? text.slice(0, 140) : undefined;
}

/** Honest, content-free placeholder title from where the clip sits. */
function measuredTitle(startS: number, endS: number, segments: TranscriptSegment[]): string {
  const hook = hookFor(startS, endS, segments);
  if (hook) {
    const words = hook.split(/\s+/).slice(0, 9).join(' ');
    return words.length < hook.length ? `${words}…` : words;
  }
  const m = Math.floor(startS / 60);
  const s = Math.floor(startS % 60);
  return `Clip from ${m}:${String(s).padStart(2, '0')}`;
}

function measurementReason(
  startS: number, endS: number,
  energy: number[] | undefined, durationS: number, visual: VisualScan | null | undefined,
): string {
  const bits: string[] = [];
  if (energy?.length) {
    const e = energyOver(energy, durationS, startS, endS);
    const peak = Math.max(...energy, 1e-4);
    if (e / peak > 0.7) bits.push('one of the loudest, most energetic stretches');
    else bits.push('a sustained high-energy stretch');
  }
  if (visual?.samples?.length) {
    const m = motionOver(visual, startS, endS);
    if (m > 0.08) bits.push('lots of visual movement');
  }
  bits.push('cut at natural pauses');
  return `Picked by measurement: ${bits.join(', ')}. No AI key is set, so this ranks excitement, not meaning.`;
}

/* ───────────────────────── LLM layer ───────────────────────── */

export interface ClipPromptInput {
  durationS:  number;
  count:      number;
  targetLenS: number;
  minLenS:    number;
  maxLenS:    number;
  energy?:    number[];
  transcript?: Transcript | null;
}

/** The compact, token-cheap brief handed to the model. */
export function clipBriefForPrompt(input: ClipPromptInput): string {
  const lines: string[] = [
    `VIDEO DURATION: ${input.durationS.toFixed(1)}s`,
    `Find ${input.count} short clips, each ${input.minLenS}–${input.maxLenS}s (aim ~${input.targetLenS}s).`,
  ];

  if (input.energy?.length) {
    lines.push(`LOUDNESS (0-9 across the video, left to right; higher = more energetic):\n${loudnessSparkline(input.energy, input.durationS)}`);
  }

  const t = input.transcript;
  if (t?.segments?.length) {
    lines.push(
      'TRANSCRIPT with timestamps in seconds. Pick moments that are self-contained, ' +
      'have a strong hook in the first sentence, make sense without the surrounding video, ' +
      'and would make someone stop scrolling. Prefer a surprising claim, a story, a punchline ' +
      'or a useful tip over small talk:\n' +
      transcriptLines(t, 9000),
    );
  } else {
    lines.push('(no transcript — choose from the loudness curve only, and say so)');
  }
  return lines.join('\n\n');
}

function transcriptLines(t: Transcript, maxChars: number): string {
  const all = t.segments.map(s => `[${s.startS.toFixed(1)}-${s.endS.toFixed(1)}] ${s.text.trim()}`);
  const joined = all.join('\n');
  if (joined.length <= maxChars) return joined;
  // Keep the head; clip finding rarely needs the tail of a very long file.
  return joined.slice(0, maxChars) + '\n… (transcript truncated)';
}

/** System prompt for the clipping model, with the length bounds baked in. */
export function clipSystemPrompt(opts: { minLenS: number; maxLenS: number; targetLenS: number }): string {
  const { minLenS, maxLenS, targetLenS } = opts;
  return `You are the clipping engine of Modaya, an AI video editor.
You watch a long video (a podcast, talk, stream or vlog) and pick the short,
vertical-ready clips a creator would post to TikTok, Reels, Shorts or as a
story. You are given the transcript with timestamps and a loudness curve.

Reply with JSON ONLY in exactly this shape:
{
  "clips": [
    {
      "startS": number,
      "endS": number,
      "title": "a punchy hook-style title, under 60 characters, no clickbait lies",
      "hook": "the exact first sentence spoken in the clip",
      "reason": "one short sentence: why this moment is worth clipping",
      "tags": ["topic", "topic"],
      "score": 0-100
    }
  ]
}

Rules:
- Every timestamp MUST come from the transcript brackets. Never invent times.
- Clips are ${minLenS}-${maxLenS} seconds long, aim ~${targetLenS}.
- Start a clip at the beginning of a sentence and end it at the end of one.
  Never cut mid-sentence. Include the setup, not just the punchline.
- Each clip must stand alone: a stranger who never saw the full video must
  understand it. Do not start with "so", "anyway", "as I was saying".
- Pick clips from DIFFERENT parts of the video — do not cluster them all in
  one minute. Rank them best first in the array.
- The title is the on-screen hook: short, specific, curiosity-driven. Base it
  on what is actually said. Never use the video title or file name.
- score is your judgement of shareability: a surprising claim, strong emotion,
  a story or a genuinely useful tip scores high; filler and small talk scores low.
- Use the loudness curve as a tie-breaker between equally good moments.
- Return exactly the number of clips asked for, or as many as genuinely qualify.
- No prose, no markdown, no comments — JSON only.`;
}

/** One raw clip object as the model returns it, before validation. */
interface RawClip {
  startS?: unknown; endS?: unknown;
  title?: unknown; hook?: unknown; reason?: unknown;
  tags?: unknown; score?: unknown;
}

/**
 * Coerce model output into safe, in-range clips. Unknown fields dropped,
 * timestamps clamped to the video, bounds snapped to transcript edges, and
 * anything too short, too long or backwards is discarded rather than repaired
 * by guesswork.
 */
export function sanitiseClips(
  raw: unknown, req: ClipRequest,
): ClipSuggestion[] {
  const durationS = Math.max(0, req.durationS || 0);
  const target    = clamp(Math.round(req.targetLenS ?? 45), 10, 120);
  const minLen    = clamp(Math.round(req.minLenS ?? Math.max(15, target * 0.5)), 10, target);
  const maxLen    = clamp(Math.round(req.maxLenS ?? Math.min(120, target * 1.8)), target, 600);
  const segments  = req.transcript?.segments ?? [];
  const silences  = req.silences ?? [];

  const arr = (raw as { clips?: unknown })?.clips;
  if (!Array.isArray(arr)) return [];

  const out: ClipSuggestion[] = [];
  for (const item of arr.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as RawClip;

    let startS = Number(o.startS);
    let endS   = Number(o.endS);
    if (!Number.isFinite(startS) || !Number.isFinite(endS)) continue;
    if (endS <= startS) continue;

    // Clamp into the video, then snap to the nearest sentence gap.
    startS = clamp(startS, 0, durationS);
    endS   = clamp(endS,   0, durationS);
    startS = snapBound(startS, durationS, silences, segments, 'start');
    endS   = snapBound(endS,   durationS, silences, segments, 'end');

    if (endS - startS < minLen) continue;
    if (endS - startS > maxLen) endS = startS + maxLen;
    if (endS > durationS) { endS = durationS; startS = Math.max(0, endS - maxLen); }

    const title  = String(o.title ?? '').trim().slice(0, 80) || measuredTitle(startS, endS, segments);
    const reason = String(o.reason ?? '').trim().slice(0, 200) || 'Chosen by the AI from what is said.';
    const hook   = String(o.hook ?? '').trim().slice(0, 140) || hookFor(startS, endS, segments);
    const tags   = Array.isArray(o.tags)
      ? o.tags.map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, '')).filter(Boolean).slice(0, 4)
      : [];
    let score    = Number(o.score);
    if (!Number.isFinite(score)) score = scoreWindow(startS, endS, req.energy, durationS, req.visual);
    score = clamp(Math.round(score), 0, 100);

    out.push({
      id: '',  // assigned after sorting
      startS: Number(startS.toFixed(2)),
      endS:   Number(endS.toFixed(2)),
      score, title, reason, hook, tags,
      source: 'ai',
    });
  }

  // De-duplicate overlapping clips, keep the higher scored, then order by time.
  const deduped = dedupe(out);
  deduped.sort((a, b) => b.score - a.score);
  const count = clamp(Math.round(req.count ?? 5), 1, 10);
  const kept  = deduped.slice(0, count).sort((a, b) => a.startS - b.startS);
  kept.forEach((c, i) => { c.id = `clip-${i + 1}`; });
  return kept;
}

/** Remove clips that overlap a better-scored one at all (a touch is allowed). */
function dedupe(clips: ClipSuggestion[]): ClipSuggestion[] {
  const sorted = [...clips].sort((a, b) => b.score - a.score || a.startS - b.startS);
  const kept: ClipSuggestion[] = [];
  for (const c of sorted) {
    const clash = kept.some(k => Math.min(c.endS, k.endS) - Math.max(c.startS, k.startS) > 0.5);
    if (!clash) kept.push(c);
  }
  return kept;
}

/* ───────────────────────── viral detection (LLM, OpenShorts-style) ─────────────────────────
   With a key and a transcript, clip finding stops being "loudest window" and
   becomes viral-moment detection: we build grounded candidate windows from the
   real sentences, the model scores each for shareability against an explicit
   rubric, and we blend that judgement with the measured energy. The model only
   scores and titles windows we give it — it never invents a timestamp. */

export interface ViralCandidate {
  id:      string;
  startS:  number;
  endS:    number;
  /** Measured energy/motion score 0–100, before the model weighs in. */
  measured: number;
  /** The words spoken in this window, for the model to judge. */
  text:    string;
}

/** Text of the transcript segments that fall inside a window. */
function textIn(segments: TranscriptSegment[], fromS: number, toS: number): string {
  return segments
    .filter(s => s.endS > fromS && s.startS < toS)
    .map(s => s.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grounded candidate windows. With a transcript these follow the sentences —
 * accumulated to roughly the target length and started at a sentence that
 * follows a gap, so windows are self-contained and never overlap. Without one
 * they fall back to the measured grid.
 */
export function buildViralCandidates(req: ClipRequest): ViralCandidate[] {
  const durationS = Math.max(0, req.durationS || 0);
  const target    = clamp(Math.round(req.targetLenS ?? 45), 10, 120);
  const segments  = req.transcript?.segments ?? [];
  const out: ViralCandidate[] = [];

  if (segments.length) {
    let winStart: number | null = null;
    let winEnd = 0;
    let n = 0;
    const push = (s: number, e: number) => {
      if (e - s < 8) return;
      out.push({
        id: `c${n++}`,
        startS: Number(s.toFixed(2)),
        endS:   Number(Math.min(e, durationS).toFixed(2)),
        measured: scoreWindow(s, e, req.energy, durationS, req.visual),
        text:    textIn(segments, s, e),
      });
    };

    for (const seg of segments) {
      if (winStart === null) { winStart = seg.startS; winEnd = seg.endS; continue; }
      const gap = seg.startS - winEnd;
      const len = seg.endS - winStart;
      // Close the window when it is long enough AND this sentence starts after
      // a pause (a natural boundary), or it has reached the max length.
      if ((len >= target && gap > 0.6) || len >= target * 1.6) {
        push(winStart, winEnd);
        winStart = seg.startS;
      }
      winEnd = seg.endS;
    }
    if (winStart !== null) push(winStart, winEnd);
  } else {
    const step = Math.max(1, target);
    for (let s = 0; s + target <= durationS + 1e-6; s += step) {
      out.push({
        id: `c${out.length}`,
        startS: Number(s.toFixed(2)),
        endS:   Number((s + target).toFixed(2)),
        measured: scoreWindow(s, s + target, req.energy, durationS, req.visual),
        text: '',
      });
    }
  }

  return out.filter(c => c.endS - c.startS >= 8);
}

/** System prompt with the virality rubric — the "viral moment detection". */
export function viralSystemPrompt(opts: { minLenS: number; maxLenS: number; targetLenS: number }): string {
  return `You are a viral-clip editor (like OpusClip / OpenShorts). You are given
candidate moments from a long video, each with an id, its time range, the words
spoken in it, and a measured energy score. Judge each moment for how well it
would perform as a short vertical clip on TikTok, Reels or Shorts.

Score virality 0-100 against this rubric:
- Hook: the first line must grab attention in under 3 seconds (a bold claim, a
  question, a surprising fact, conflict or a promise).
- Self-contained: a stranger who never saw the full video understands it. No
  "as I was saying", no references to earlier context.
- Payoff: a story, punchline, strong emotion, useful tip or surprising result.
- No filler: small talk, intros and rambling score low.
- Give complete, well-paced moments ${opts.minLenS}-${opts.maxLenS}s (aim ~${opts.targetLenS}s).

Reply with JSON ONLY:
{
  "scores": [
    { "id": "c0", "virality": 0-100, "title": "punchy hook title under 60 chars",
      "hook": "the first spoken line", "reason": "one short sentence why it spreads",
      "tags": ["topic"] }
  ]
}

Score EVERY candidate you are given. Use its exact id. Judge the words, not the
file name. JSON only — no prose.`;
}

/** The user message listing each candidate for the model to score. */
export function viralPrompt(cands: ViralCandidate[]): string {
  const lines = cands.map(c =>
    `${c.id} [${c.startS.toFixed(0)}-${c.endS.toFixed(0)}s] energy ${c.measured}${c.text ? ` — "${c.text.slice(0, 600)}"` : ' (no transcript)'}`,
  );
  return `Here are ${cands.length} candidate moments. Score every one for virality:\n\n${lines.join('\n')}`;
}

/**
 * Turn the model's per-candidate scores into final clips. Our timestamps are
 * kept (the model only judged content); the LLM virality score is blended with
 * the measured energy, then the best non-overlapping moments are taken, spread
 * across the video.
 */
export function clipsFromVirality(
  raw: unknown, cands: ViralCandidate[], req: ClipRequest,
): ClipSuggestion[] {
  const count = clamp(Math.round(req.count ?? 5), 1, 10);
  const segments = req.transcript?.segments ?? [];
  const silences = req.silences ?? [];
  const durationS = Math.max(0, req.durationS || 0);

  const byId = new Map(cands.map(c => [c.id, c]));
  const rows = (raw as { scores?: unknown })?.scores;
  type Scored = ViralCandidate & { virality: number; title: string; reason: string; hook?: string; tags: string[]; modelScored: boolean };
  const scored: Scored[] = [];

  const list = Array.isArray(rows) ? rows : [];
  for (const r of list.slice(0, 200)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const cand = byId.get(String(o.id ?? ''));
    if (!cand) continue;
    const virality = clamp(Math.round(Number(o.virality)), 0, 100);
    if (!Number.isFinite(virality)) continue;
    scored.push({
      ...cand,
      virality,
      modelScored: true,
      title: String(o.title ?? '').trim().slice(0, 80) || measuredTitle(cand.startS, cand.endS, segments),
      reason: String(o.reason ?? '').trim().slice(0, 200) || 'Chosen for its viral potential.',
      hook: String(o.hook ?? '').trim().slice(0, 140) || hookFor(cand.startS, cand.endS, segments),
      tags: Array.isArray(o.tags)
        ? o.tags.map(t => String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim()).filter(Boolean).slice(0, 4)
        : [],
    });
  }
  // Any candidate the model did not score keeps its measured energy only.
  for (const c of cands) {
    if (!scored.some(s => s.id === c.id)) {
      scored.push({ ...c, virality: c.measured, modelScored: false,
        title: measuredTitle(c.startS, c.endS, segments),
        reason: 'Picked from measured energy.', tags: [],
        hook: hookFor(c.startS, c.endS, segments) });
    }
  }

  // Blend: meaning dominates when the model judged, but measured energy still
  // breaks ties and lifts genuinely loud, exciting moments.
  const blended = scored.map(s => ({
    ...s,
    final: Math.round(0.72 * s.virality + 0.28 * s.measured),
  })).sort((a, b) => b.final - a.final);

  // Take the best non-overlapping. Spread (the default) takes one per zone
  // first so the clips cover the whole video; "at the start" instead picks the
  // strongest non-overlapping moments from the opening of the video.
  const target = clamp(Math.round(req.targetLenS ?? 45), 10, 120);
  const picked: (typeof blended[number])[] = [];
  const clash = (s: number, e: number) =>
    picked.some(p => Math.min(e, p.endS) - Math.max(s, p.startS) > 0.5);

  if (req.bias === 'start') {
    // Only moments that can fit inside the opening region are eligible; within
    // it, highest shareability first, earliest wins a tie.
    const region = Math.min(durationS, count * target * 1.6 + target);
    const early = blended
      .filter(s => s.startS < region)
      .sort((a, b) => (b.final - a.final) || (a.startS - b.startS));
    for (const s of early) {
      if (picked.length >= count) break;
      if (!clash(s.startS, s.endS)) picked.push(s);
    }
  } else {
    const zoneLen = durationS / count;
    for (let z = 0; z < count; z++) {
      const inZone = blended.filter(s => s.startS >= z * zoneLen - 1 && s.startS < (z + 1) * zoneLen);
      const pick = inZone.find(s => !clash(s.startS, s.endS));
      if (pick) picked.push(pick);
    }
  }
  for (const s of blended) {
    if (picked.length >= count) break;
    if (!clash(s.startS, s.endS)) picked.push(s);
  }

  const viralClips: ClipSuggestion[] = picked
    .slice(0, count)
    .sort((a, b) => a.startS - b.startS)
    .map((s) => ({
      id:      '',
      startS:  snapBound(s.startS, durationS, silences, segments, 'start'),
      endS:    snapBound(s.endS,   durationS, silences, segments, 'end'),
      score:   s.final,
      title:   s.title,
      reason:  s.modelScored
        ? `${s.reason} Scored for shareability (${s.virality}/100) and measured energy.`
        : s.reason,
      hook:    s.hook,
      tags:    s.tags,
      // Honest provenance: a window the model actually judged is 'ai'; one it
      // never scored is still a measurement clip, even though it rode the viral
      // pipeline.
      source:  (s.modelScored ? 'ai' : 'measurement') as ClipSource,
    }));

  // The sentence-based windows can be fewer than the count asked (a short
  // video, or windows that merged). Top up from the free measurement engine
  // so the user always gets the number of clips they requested.
  const finalClips = [...viralClips];
  if (finalClips.length < count) {
    const measured = findClipsByMeasurement({ ...req, count: count + 4 });
    for (const m of measured) {
      if (finalClips.length >= count) break;
      const clash = finalClips.some(k =>
        Math.min(m.endS, k.endS) - Math.max(m.startS, k.startS) > 0.5);
      if (!clash) finalClips.push({ ...m, source: 'hybrid' as const });
    }
  }

  finalClips
    .sort((a, b) => a.startS - b.startS)
    .forEach((c, i) => { c.id = `clip-${i + 1}`; });
  return finalClips;
}

/* ───────────────────────── merge ───────────────────────── */

/**
 * Build the final list. When AI clips are available they are used; anything
 * the model could not cover (or a missing/failed call) is topped up from the
 * measurement engine so the user always gets the number of clips they asked
 * for. AI clips keep their titles; top-ups are clearly marked as measured.
 */
export function mergeClips(
  aiClips: ClipSuggestion[] | null,
  req: ClipRequest,
): ClipSuggestion[] {
  const count = clamp(Math.round(req.count ?? 5), 1, 10);

  if (!aiClips || aiClips.length === 0) {
    return findClipsByMeasurement(req).slice(0, count);
  }

  // Fill any shortfall with measurement clips that don't overlap AI choices.
  if (aiClips.length < count) {
    const measured = findClipsByMeasurement({ ...req, count: count + 4 });
    for (const m of measured) {
      if (aiClips.length >= count) break;
      const clash = aiClips.some(k =>
        Math.min(m.endS, k.endS) - Math.max(m.startS, k.startS) > 0.5);
      if (!clash) aiClips.push({ ...m, source: 'hybrid' });
    }
  }

  aiClips.sort((a, b) => a.startS - b.startS);
  aiClips.forEach((c, i) => { c.id = `clip-${i + 1}`; });
  return aiClips.slice(0, count);
}
