/**
 * POST /api/projects/:id/ai
 * Accepts a user message, runs intent detection, returns a structured
 * AI response with: reply text, edit summary, affected clip ids, and the
 * resulting timeline. Edits are computed from the REAL transcript and
 * audio/visual measurements — every operation is grounded in transcript
 * brackets, validated, clamped to the media duration and snapped to silence
 * boundaries, so no timestamp is ever invented (clips.ts / operations.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db, Clip } from '@/lib/db';
import { v4 as uuid } from 'uuid';
import { describeLoudness } from '@/lib/ai/highlights';
import { transcriptForPrompt, fillerRanges, sanitiseSegments, Transcript } from '@/lib/ai/transcript';
import { chatDetailed, explainFailure, extractJson, detectProvider, FailureReason } from '@/lib/ai/llm';
import { summariseVisual, keyframeTimes, motionBetween, type VisualScan } from '@/lib/ai/visualScan';
import { groundOperations, validateOperations, applyOperations, parseStyle, parsePlacement, Operation, TimelineClip } from '@/lib/ai/operations';
import { findClipsByMeasurement, sanitiseClips, mergeClips, parseClipRequest, ClipSuggestion } from '@/lib/ai/clips';

// ── Intent detection ──────────────────────────────────────────────────────────

type Intent =
  | 'describe'
  | 'tighten' | 'clean' | 'moments' | 'captions' | 'text_overlay' | 'restyle'
  | 'move_text' | 'remove_text'
  | 'vertical' | 'highlights' | 'cut_silence' | 'clips' | 'uncut' | 'unknown';

/** Capitalise a summary and end it properly, leaving a question mark be. */
function sentence(s: string): string {
  const capped = `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function detectIntent(text: string): Intent {
  const p = text.toLowerCase();
  if (p.match(/pause|dead.?air|silence|gap|tighten|pace/))         return 'cut_silence';
  if (p.match(/filler|um+|uh+|stutter|repeat|clean/))              return 'clean';
  /* "Don't cut anything" is a real instruction, not a refusal — Studio's
     drop-screen presets reach the one AI too. */
  if (p.match(/uncut|full (?:length|video|footage)|no ?cuts?|keep (?:all|the whole|everything|100)|don.?t cut|dont cut|raw (?:footage|video|file)/))
                                                                   return 'uncut';
  /* Captions before highlights: "captions at the top" is about captions, and
     a bare "top" used to be read as "top moment" and pick highlights. */
  if (p.match(/caption|subtitle|transcri/))                        return 'captions';
  if (p.match(/\bfont\b|typeface|\bstyle\b|colour|color|bigger|smaller|bold|uppercase/))
                                                                   return 'restyle';
  if (p.match(/\b(remove|delete|get rid of|take off|erase)\b/) &&
      p.match(/\btext\b|\btitle\b|\bname\b|overlay|watermark|caption|\bone\b/))
                                                                   return 'remove_text';
  /* "move it to the top corner" is about text already on screen. Adding it
     again is what left two names on the video with no way to say which. */
  const placeWord =
    /\b(top|b[ou]tt?[ou]m|lower|upper|corner|left|lft|right|write|wright|rite|ryt|middle|centre|center|up|down)\b/;
  if (p.match(/\b(move|put|place|shift|reposition|drag)\b|corner/) && placeWord.test(p) &&
      !p.match(/\bcaptions?\b|\bsubtitles?\b/))                   return 'move_text';
  /* "at top write", "no top right", "bottom left" — nothing but a placement
     and filler is someone correcting where the text they can see is sitting.
     If they name anything else ("write subscribe at top") it is new text. */
  const FILLER = /^(at|the|on|in|to|of|no|not|nope|its|it|that|this|text|title|please|now|make|ok|okay|go|be|sit|put|move|place|shift|and|a|i|want|need|there)$/;
  const tokens = p.replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.length <= 6 && placeWord.test(p) &&
      tokens.every(w => placeWord.test(w) || FILLER.test(w)))       return 'move_text';
  if (p.match(/\btext\b|\btitle\b|\bname\b|overlay|watermark|lower.?third/))
                                                                   return 'text_overlay';
  if (p.match(/what (?:can you |do you )?see|what.?s (?:in|happening|going on)|describe|look at|analyse the (?:video|picture|footage)|how many (?:cuts|shots)|what happens/))
                                                                   return 'describe';
  /* Reframing to a vertical canvas is about the frame, not about finding
     clips — "make it vertical for tiktok" must reach the 9:16 handler even
     though it names a platform. Clipping (below) is about carving several
     standalone posts out of the long video. */
  if (p.match(/vertical|reframe|9.?:?.?16|portrait/))              return 'vertical';
  /* Clipping = carve several short standalone clips out of the long video,
     a la OpusClip. Distinct from a single "highlight reel": this keeps each
     moment as its own post, so it matches on the plural/social vocabulary
     before the singular "best moment" rule below. A bare length with no
     other verb ("30 seconds pls", "1 minute clips") is a clipping request —
     it is following one up — unless the words say trim/shorten instead. */
  const saysLength = /\b(\d{1,3})\s*(sec(?:ond)?s?|s|min(?:ute)?s?|m)\b/.test(p);
  const trimsVideo = /\b(trim|shorter|shorten|tighten|cut (?:it|this|the video|down)|make it \d)/.test(p);
  if (p.match(/\bclips?\b|\bshorts?\b|tiktok|reels?|viral|carve|long.?form|podcast clips|give me \d+|find \d+|\d+ best|30 ?sec|60 ?sec/) ||
      (saysLength && !trimsVideo))
                                                                   return 'clips';
  if (p.match(/highlight|best moment|standout|top (?:moment|part|bit|clip|section)|\bmoments?\b/))
                                                                   return 'moments';
  if (p.match(/tighten|shorter|concise|trim|cut/))                 return 'tighten';
  return 'unknown';
}

/** The words someone wants on screen, taken from what they actually wrote —
 *  never invented. Returns null when the request does not contain them. */
export function wordsForOverlay(message: string): string | null {
  const quoted = message.match(/["“'']([^"”'']{2,120})["”'']/);
  if (quoted) return quoted[1].trim();

  const patterns = [
    /\bmy name is\s+(.{2,80})$/i,
    /\bname[:\s]+(?:is\s+)?(.{2,80})$/i,
    /\bthat says\s+(.{2,80})$/i,
    /\bsaying\s+(.{2,80})$/i,
    /\btext (?:on (?:the )?screen|overlay)[,:]?\s+(.{2,80})$/i,
    /\b(?:title|caption|text)[:]\s*(.{2,80})$/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m) {
      const words = m[1].trim().replace(/[.]+$/, '');
      if (words.length >= 2) return words;
    }
  }
  return null;
}

/* ── Reply & edit generation ─────────────────────────────────────────────────── */

/** One full-length source clip — the seed the AI edits on a first pass. */
function seedClips(durationS: number): Clip[] {
  return [{
    id: 'src-v', trackId: 'video', label: 'Footage',
    startS: 0, endS: Math.max(0.1, durationS), type: 'video',
  }] as unknown as Clip[];
}

/** Validate a timeline sent from the browser. Studio owns its clips locally,
 *  so a missing/invalid body falls back to the server copy. */
function parseClientClips(raw: unknown): Clip[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TimelineClip[] = [];
  for (const c of raw.slice(0, 800)) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const trackId = typeof o.trackId === 'string' ? o.trackId : '';
    const label = typeof o.label === 'string' ? o.label : '';
    const startS = Number(o.startS);
    const endS = Number(o.endS);
    const type = o.type;
    if (!id || !trackId || !(type === 'video' || type === 'audio' || type === 'text' || type === 'subtitle')) continue;
    if (!Number.isFinite(startS) || !Number.isFinite(endS) || endS <= startS) continue;
    out.push({
      id, trackId, label: label || type,
      startS: Math.max(0, startS), endS,
      type,
      ...(typeof o.textPosition === 'string' ? { textPosition: o.textPosition as TimelineClip['textPosition'] } : {}),
      ...(typeof o.textAlign === 'string' ? { textAlign: o.textAlign as TimelineClip['textAlign'] } : {}),
      ...(o.textStyle && typeof o.textStyle === 'object' ? { textStyle: o.textStyle as TimelineClip['textStyle'] } : {}),
    });
  }
  return out.length ? out as unknown as Clip[] : null;
}

const WHERE_WORDS: Record<'top'|'centre'|'lower', string> = {
  top: 'across the top', centre: 'in the middle', lower: 'along the bottom',
};

function fmtS(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface EditResult {
  reply:        string;           // conversational reply shown in chat
  summary:      string;           // one-line edit summary shown as chip
  savedS:       number;           // seconds removed
  affectedIds:  string[];         // clip ids visually highlighted
  newClips:     Clip[];           // clips after the grounded edit is applied
  intent:       Intent;
  /** Clipping result: standalone short clips the user can cut to, without
      touching the timeline until one is chosen. */
  clipSuggestions?: ClipSuggestion[];
  /** The executed operations — lets a client apply look-only decisions
      (grade, punch-in) that leave the clip list unchanged while still being
      part of the same single AI answer. */
  applied?:     Operation[];
}

/**
 * Deterministic fallback, used when no LLM key is configured or the model
 * fails. It performs only edits it can justify from measurements the browser
 * sent, and says plainly when it cannot do something. It never claims work it
 * did not do.
 */
function applyEdit(
  intent: Intent, clips: Clip[], durationS: number,
  ctx: {
    silences: [number, number][]; energy: number[]; modelNote?: string;
    transcript?: Transcript | null;
    /** What the person actually typed — needed to read a position, a font or
     *  the words they want on screen without an AI model to interpret them. */
    message?: string;
    /** The timeline before the last edit, so a move can put back something
     *  that was taken off by mistake. */
    previousClips?: Clip[];
    /** What the browser measured from the pixels. */
    visual?: VisualScan | null;
  },
): EditResult {

  const run = (ops: Operation[]) =>
    applyOperations(clips as TimelineClip[], groundOperations(ops, ctx.message ?? ''),
      { durationS, silences: ctx.silences, transcript: ctx.transcript ?? null,
        previousClips: (ctx.previousClips ?? []) as TimelineClip[] });

  const nothing = (reply: string): EditResult => ({
    reply, summary: 'No change', savedS: 0, affectedIds: [], newClips: clips, intent,
  });

  switch (intent) {
    /* Someone asking what is in the video, with no model to look for them.
       Answer with what was actually measured and be honest about the rest —
       an editor that invents a description is worse than one that admits it
       cannot see. */
    case 'describe': {
      const parts: string[] = [];
      if (ctx.visual) parts.push(summariseVisual(ctx.visual));
      if (ctx.transcript?.segments?.length) {
        const words = ctx.transcript.segments.map(s => s.text).join(' ').trim();
        parts.push(`What is said: "${words.slice(0, 400)}${words.length > 400 ? '…' : ''}"`);
      }
      if (!parts.length) {
        return nothing('I have not measured this video yet — give it a moment after it loads, ' +
                       'and I can tell you where the cuts and the movement are.');
      }
      return {
        reply: `I cannot see the picture — ${ctx.modelNote ? 'no AI model is answering right now' :
                 'no model is configured to look at frames'} — but here is what was measured ` +
               `from the pixels and the audio:\n\n${parts.join('\n')}`,
        summary: 'described what was measured', savedS: 0, affectedIds: [],
        newClips: clips, intent,
      };
    }

    case 'cut_silence':
    case 'tighten': {
      if (!ctx.silences.length) {
        return nothing(
          "I couldn't find any measurable silence in this project — either the audio is " +
          'continuous, or the media is still loading. Reopen the project so I can analyse ' +
          'the audio, then ask again.');
      }
      const out = run([{ op: 'remove_ranges', ranges: ctx.silences }]);
      return {
        reply: `Removed ${ctx.silences.length} silent ${ctx.silences.length === 1 ? 'gap' : 'gaps'} ` +
               `I measured in your audio — ${Math.round(out.removedS)}s in total. ` +
               `The programme is now ${fmtS(durationS - out.removedS)}.`,
        summary:     out.summary,
        savedS:      Math.round(out.removedS),
        affectedIds: out.affectedIds,
        newClips:    out.clips as Clip[],
        intent,
      };
    }

    case 'moments':
    case 'highlights': {
      /* Loudness alone picks the crowd noise over the play that caused it.
         When the picture has been measured too, a second of footage has to be
         both loud AND moving to count as a highlight. */
      const motionScore = ctx.visual && ctx.visual.samples.length
        ? (sec: number) => motionBetween(ctx.visual as VisualScan, sec, sec + 1)
        : null;

      if (!ctx.energy.length && !motionScore) {
        return nothing(
          'I need to analyse your audio before I can pick highlights. Reopen the project ' +
          'so the media loads, then ask again.');
      }

      const seconds = ctx.energy.length || Math.floor(durationS);
      const loudest = Math.max(...ctx.energy, 0.0001);
      const scored  = Array.from({ length: seconds }, (_, i) => {
        const loud = (ctx.energy[i] ?? 0) / loudest;
        const move = motionScore ? motionScore(i) : 0;
        return { i, v: motionScore && ctx.energy.length ? 0.55 * loud + 0.45 * Math.min(1, move * 6)
                    : motionScore ? Math.min(1, move * 6) : loud };
      });

      const ranked  = scored.sort((a, b) => b.v - a.v);
      const keepSec = Math.max(1, Math.round(seconds * 0.35));
      const chosen  = ranked.slice(0, keepSec).map(r => r.i).sort((a, b) => a - b);

      const ranges: [number, number][] = [];
      for (const sec of chosen) {
        const last = ranges[ranges.length - 1];
        if (last && sec <= last[1] + 1) last[1] = sec + 1;
        else ranges.push([sec, sec + 1]);
      }

      const out = run([{ op: 'keep_ranges', ranges }]);
      return {
        reply: `Kept the ${ranges.length} most active ${ranges.length === 1 ? 'section' : 'sections'} ` +
               (motionScore
                 ? `by loudness and movement together — ${fmtS(durationS - out.removedS)} of the original ${fmtS(durationS)}. ` +
                   'Both are measurements of the file rather than judgements about what matters in it.'
                 : `by audio energy — ${fmtS(durationS - out.removedS)} of the original ${fmtS(durationS)}. ` +
                   'That ranking is loudness, not meaning; with an AI key I can choose on content instead.'),
        summary:     out.summary,
        savedS:      Math.round(out.removedS),
        affectedIds: out.affectedIds,
        newClips:    out.clips as Clip[],
        intent,
      };
    }

    case 'captions': {
      const msg   = ctx.message ?? '';
      const where: 'top'|'centre'|'lower' =
          /\b(top|upper|above)\b/i.test(msg)      ? 'top'
        : /\b(middle|centre|center)\b/i.test(msg) ? 'centre'
        : 'lower';
      const out = run([{ op: 'add_captions', position: where, everyS: 3 }]);
      const count = out.clips.filter(c => c.id.startsWith('cap-')).length;
      const spoken = ctx.transcript?.segments?.length ?? 0;

      return {
        reply: spoken > 0
          ? `Added ${count} captions with the words from the transcript, ${WHERE_WORDS[where]}, ` +
            'timed to when they were said.'
          : `Added ${count} empty caption slots across the timeline, spaced every 3 seconds. ` +
            "This project hasn't been transcribed yet, so the text is blank and ready for you to fill in.",
        summary:     spoken > 0 ? `${count} captions written` : `${count} caption slots added`,
        savedS:      0,
        affectedIds: out.affectedIds,
        newClips:    out.clips as Clip[],
        intent,
      };
    }

    case 'clean': {
      const fillers = fillerRanges(ctx.transcript ?? null);
      if (fillers.length === 0) {
        return nothing(ctx.transcript
          ? "I read the transcript and couldn't find any segments that are pure filler, so there's nothing safe to cut."
          : "Removing filler words needs a transcript, and this project hasn't been transcribed yet. " +
            'What I can do now is cut the measured pauses — ask me to cut the dead air.');
      }
      const out = run([{ op: 'remove_ranges', ranges: fillers }]);
      return {
        reply: `Cut ${fillers.length} filler ${fillers.length === 1 ? 'moment' : 'moments'} ` +
               `from the transcript — ${Math.round(out.removedS)}s of "um", "uh" and the like.`,
        summary:     out.summary,
        savedS:      Math.round(out.removedS),
        affectedIds: out.affectedIds,
        newClips:    out.clips as Clip[],
        intent,
      };
    }

    case 'text_overlay': {
      const words = wordsForOverlay(ctx.message ?? '');
      if (!words) {
        return nothing(
          'I can put text on screen — tell me the exact words and I\'ll place them. ' +
          'For example: put text on screen "Blessing Muya".');
      }
      const place = parsePlacement(ctx.message ?? '', { position: 'lower', align: 'centre' });
      const out = run([{ op: 'add_text', text: words, position: place.position,
                         align: place.align, startS: 0, endS: durationS }]);
      return {
        reply: `${out.summary.charAt(0).toUpperCase()}${out.summary.slice(1)}. ` +
               'Say when it should appear, or ask for a different font, size or colour.',
        summary: out.summary, savedS: 0, affectedIds: out.affectedIds,
        newClips: out.clips as Clip[], intent,
      };
    }

    case 'move_text': {
      const msg   = ctx.message ?? '';
      const place = parsePlacement(msg, { position: 'top', align: 'centre' });
      const out   = run([{ op: 'move_text', position: place.position, align: place.align }]);
      const moved = out.summary.startsWith('moved');
      return {
        reply: moved
          ? `${out.summary.charAt(0).toUpperCase()}${out.summary.slice(1)}.`
          : "There's no text on screen to move yet — tell me the words and I'll put them up first.",
        summary: out.summary, savedS: 0, affectedIds: out.affectedIds,
        newClips: out.clips as Clip[], intent,
      };
    }

    case 'remove_text': {
      const msg = ctx.message ?? '';
      const position = /\b(b[ou]tt?[ou]m|lower|below)\b/i.test(msg) ? 'lower' as const
                     : /\b(top|upper|above)\b/i.test(msg)    ? 'top'   as const
                     : /\b(middle|centre|center)\b/i.test(msg) ? 'centre' as const
                     : undefined;
      const all   = /\b(all|both|every|everything)\b/i.test(msg);
      const words = wordsForOverlay(msg) ?? undefined;
      const out   = run([{ op: 'remove_text', match: words, position, all }]);
      const removed = out.summary.startsWith('removed');
      const asking  = out.summary.startsWith('there is more than one');
      return {
        reply: removed || asking
          ? sentence(out.summary)
          : `${out.summary.charAt(0).toUpperCase()}${out.summary.slice(1)} — ` +
            'tell me the words or whereabouts it sits and I\'ll take that one off.',
        summary: out.summary, savedS: 0, affectedIds: out.affectedIds,
        newClips: out.clips as Clip[], intent,
      };
    }

    case 'restyle': {
      const msg   = ctx.message ?? '';
      const style = parseStyle({
        font:       msg.match(/\b(serif|mono|monospace|typewriter|display|impact|handwritten|script|cursive|sans)\b/i)?.[1],
        size:       msg.match(/\b(small|smaller|tiny|large|larger|big|bigger|huge|medium)\b/i)?.[1]
                      ?.replace(/er$/, '').replace(/tiny/, 'small').replace(/huge/, 'large'),
        colour:     msg.match(/\b(white|black|yellow|red|green|blue|orange|pink|purple|grey|gray|cyan|#[0-9a-f]{3,6})\b/i)?.[1],
        background: msg.match(/\b(box|band|shadow|outline|no background|none)\b/i)?.[1],
        ...(/\bbold\b/i.test(msg)      ? { bold: true }      : {}),
        ...(/\buppercase|caps\b/i.test(msg) ? { uppercase: true } : {}),
      });

      if (!style) {
        return nothing(
          'I can change the font, size, colour and background of the text. ' +
          'Fonts are sans, serif, mono, display or handwritten — which would you like?');
      }
      const out = run([{ op: 'style_text', target: 'captions', style }]);
      const bits = [
        style.font   && `${style.font} font`,
        style.size   && `${style.size} size`,
        style.colour && `in ${style.colour}`,
        style.background && `${style.background} background`,
        style.bold && 'bold', style.uppercase && 'uppercase',
      ].filter(Boolean).join(', ');
      return {
        reply: out.summary.includes('no text')
          ? "There's no text on the timeline yet to restyle — add captions or a title first."
          : `Restyled the captions: ${bits}.`,
        summary: out.summary, savedS: 0, affectedIds: out.affectedIds,
        newClips: out.clips as Clip[], intent,
      };
    }

    case 'clips': {
      /* The clipping engine never edits the timeline itself — it surfaces
         standalone clips the person can cut to in one tap. With no key it
         finds them from loudness, movement and the measured pauses, spread
         across the whole video (or from the start if asked); the reply says
         plainly that this ranks excitement rather than meaning. It never
         needs a transcript — that only upgrades the titles and picks. */
      const want = parseClipRequest(ctx.message ?? '', { count: 5 });
      const targetLenS = want.targetLenS ?? 45;
      const suggestions = findClipsByMeasurement({
        durationS,
        count:    want.count,
        targetLenS,
        energy:   ctx.energy,
        silences: ctx.silences,
        visual:   ctx.visual ?? null,
        transcript: ctx.transcript ?? null,
        bias:     want.bias,
      });

      if (!suggestions.length || durationS <= 0) {
        return nothing(
          'I need to analyse the video before I can find clips. Reopen the project so the media ' +
          'loads, then ask again.');
      }

      const list = suggestions
        .map((c, i) => `${i + 1}. ${fmtS(c.startS)}–${fmtS(c.endS)} — ${c.title}`)
        .join('\n');
      const lengthNote = want.targetLenS ? `about ${want.targetLenS}s each` : 'short';
      const whereNote  = want.bias === 'start' ? ' from the beginning of the video' : '';
      const aiNote =
        ` I picked these${whereNote} from the loudness and movement I measured — that tracks energy, not meaning. ` +
        (ctx.modelNote
          ? ctx.modelNote
          : 'Add a free AI key (and transcribe) and I will choose the best moments by what is actually said.');

      return {
        reply:
          `I found ${suggestions.length} ${lengthNote} ${suggestions.length === 1 ? 'clip' : 'clips'}${whereNote} ready for TikTok, Reels or Shorts:\n\n` +
          `${list}\n\n` +
          'Tap "Cut to this clip" under any of them and I will isolate it on the timeline.' + aiNote,
        summary: `found ${suggestions.length} clips`,
        savedS: 0,
        affectedIds: [],
        newClips: clips,
        clipSuggestions: suggestions,
        intent,
      };
    }

    case 'uncut':
      return {
        reply: 'Kept every second of your footage untouched.',
        summary: 'kept all footage uncut', savedS: 0, affectedIds: [],
        newClips: clips, intent,
      };

    case 'vertical':
      return nothing(
        "I can't reframe to 9:16 yet — that needs subject tracking so the speaker stays in shot. " +
        'The preview already renders your footage at its true aspect ratio without cropping.');

    default:
      return nothing(
        ctx.modelNote ??
        ("I'm running without an AI model, so I only understand a few set phrases: cut the dead air, " +
         'pick the highlights, or add captions. Add a free API key (see the README) and I can follow ' +
         'instructions in your own words.'));
  }
}

/* ── LLM planning ──────────────────────────────────────────────────────────────
   The model reads the timeline and the user's request and replies with a plan.
   It never edits directly: it picks operations, we execute them. */

const SYSTEM = `You are the editing brain of Modaya, an AI video editor.
You receive the state of a timeline and a request from the user, and you reply
with a short spoken response plus the operations needed to carry it out.

Reply with JSON only, in exactly this shape:
{
  "reply": "one or two sentences, conversational, first person, no markdown",
  "operations": [ ... ],
  "clips": [ ... ]
}

"clips" is used ONLY when the user asks to find/create multiple short clips
for TikTok, Reels, Shorts or social (e.g. "give me 5 clips", "find viral
shorts"). For that request leave "operations" empty and return clips:
  {"startS":number, "endS":number, "title":"punchy hook title under 60 chars",
   "hook":"the first sentence spoken", "reason":"why it is worth clipping",
   "tags":["topic"], "score":0-100}
Rules for clips:
- Timestamps MUST come from the TRANSCRIPT brackets; never invent times.
- Each clip is 20-90s, starts at a sentence start, ends at a sentence end, and
  stands alone with no reference to the surrounding video. Pick clips from
  DIFFERENT parts of the video, best first. The title must be based on what is
  actually said. When there is no transcript, do not return clips — say the
  video needs transcribing first.
For every OTHER kind of request, leave "clips" out and use operations:

Available operations:
  {"op":"remove_ranges","ranges":[[startS,endS], ...]}   remove these spans
  {"op":"keep_ranges","ranges":[[startS,endS], ...]}     keep only these spans
  {"op":"trim_to","targetS":number}                      shorten to a length
  {"op":"add_captions","position":"top"|"centre"|"lower","everyS":number,"style":{...}}
  {"op":"add_text","text":"the words","position":"top"|"centre"|"lower",
   "align":"left"|"centre"|"right","startS":number,"endS":number,"style":{...}}
  {"op":"move_text","match":"words to find","position":...,"align":...}  move text already on screen
  {"op":"remove_text","match":"words to find","position":...,"all":true} take text off screen
  {"op":"style_text","target":"captions"|"all","style":{...}}   restyle existing text
  {"op":"punch_in","rate":0..1}                          push in on some shots
  {"op":"grade","brightness":n,"contrast":n,"saturation":n}   around 1.0
  {"op":"none"}                                          nothing to change

Text style — the "style" object, every field optional:
  font: sans | serif | mono | display | handwritten
  size: small | medium | large
  colour: a hex value or a plain colour name
  background: box | shadow | none
  bold: true|false, uppercase: true|false
- position is where the words sit in the FRAME. It has nothing to do with
  which track holds them, so "captions at the top" is position:"top" — never
  a different track and never a refusal.
- add_text is for words the user gives you: a name, a title, a label. Use
  their exact wording. Default to the whole clip unless they say when.
- "Corner" means position plus align: top corner is position:"top" with
  align:"right" unless they name a side. Say which corner you chose.
- Moving something already on screen is move_text, NEVER a second add_text.
  "Put it top left", "move it up", "no, the other corner" are all move_text
  with a match on the words that are already there. Adding again leaves two
  copies on screen and the user then has to ask you to delete one.
- A message beginning "no" is almost always a correction of what you just
  did, not a request to delete. "no top right", "no not there", "no bigger"
  are move_text or style_text. Only remove when the words say remove, delete,
  take it off, get rid of it.
- People type fast: "write"/"rite"/"ryt" mean right, "buttom" means bottom.
  Read what they meant.
- remove_text takes text off: match on its words, or position:"lower" for
  "remove the one at the bottom", or all:true for every overlay. You CAN
  remove one and keep another — never claim you can only remove all text.
  When they single one out — "the one on the bottom", "the top one" — you
  MUST set match or position. A bare remove_text means every overlay.
- The PICTURE section is measured from the pixels: shot changes, movement,
  brightness. It is fact — use it for "where is the action", "how many cuts",
  "cut the black at the start".
- If frames are attached you can see them; describe only what is actually in
  them. If none are attached you have NOT seen the video: say so plainly and
  answer from the measurements and the transcript. Never describe people,
  places or actions you have not been shown — the file name is not evidence.
- style_text changes how existing text looks without rewriting it, so
  "same captions, different font" does not need recognition to run again.
- If someone asks for a font you cannot name above, pick the closest of the
  five and say which one you chose.

Rules:
- Use the SILENT SPANS provided when the user asks to cut pauses or dead air.
- Never invent timestamps beyond the video duration.
- Prefer few, large operations over many small ones.
- If the request is unclear, use "none" and ask a clarifying question in reply.

Choosing the "best", "strongest" or "highlight" part:
- Use the LOUDNESS block. It is measured from the real audio of this file.
- Never default to the opening of the video. The start is not the highlight
  unless the loudness says it is.
- Emit keep_ranges for the window you chose, not trim_to, so the kept section
  is the interesting one rather than the first N seconds.
- Say in your reply roughly where it falls ("around 0:38") and that you picked
  it by loudness, which tracks crowd noise and impact but not meaning.

Using the TRANSCRIPT, when one is present:
- It is the real speech, with timestamps. Quote it, search it, cut from it.
- "What is this about?" is answered from the transcript, never from the title.
- add_captions writes the actual words automatically — you do not supply text.
- To remove filler words or a rambling passage, emit remove_ranges over the
  exact timestamps of those segments.
- For "find where they talk about X", use keep_ranges over matching segments.

What you cannot do — say so plainly instead of pretending:
- You cannot see the picture. You do not know who is on screen or what happens
  visually, only what was said.
- Without a TRANSCRIPT you cannot quote anyone, write real captions, or remove
  filler words. Say the video has not been transcribed yet.
- You CAN put text on screen anywhere in the frame, in five fonts, any colour,
  three sizes. Never say you cannot add text or cannot change the font.
- Do not infer content from the file name. A title is not evidence.`;

interface Plan { reply: string; operations: unknown; clips?: unknown }

/**
 * Which build is answering. When someone is looking at a stale deployment,
 * every other explanation is a red herring, so the fallback says so out loud.
 */
function buildTag(): string {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7);
  const env = process.env.VERCEL_ENV ?? '';
  if (!sha && !env) return 'local dev server';
  return [sha && `build ${sha}`, env].filter(Boolean).join(', ');
}

async function planWithLlm(opts: {
  message:   string;
  durationS: number;
  clips:     Clip[];
  silences:  [number, number][];
  energy:    number[];
  audio:     'pending' | 'ready' | 'failed';
  transcript: Transcript | null;
  style?:    string;
  history:   { role: 'user' | 'ai'; text: string }[];
  /** Shot changes, movement and brightness measured in the browser. */
  visual?:   VisualScan | null;
  /** A few frames, as data URLs, for a model that can actually see. */
  frames?:   string[];
}): Promise<{
  plan:    { reply: string; operations: Operation[]; clips?: ClipSuggestion[] } | null;
  failure: { reason: FailureReason; detail: string } | null;
  /** True when frames were sent but no model available could look at them. */
  blind?:  boolean;
  /** The model that actually answered — the vision one differs from the text one. */
  model?:  string;
}> {

  const clipSummary = opts.clips.slice(0, 40)
    .map(c => `${c.trackId} "${c.label}" ${c.startS.toFixed(1)}–${c.endS.toFixed(1)}s`)
    .join('\n') || '(no clips analysed yet — the whole file is one shot)';

  const silenceSummary = opts.silences.length
    ? opts.silences.slice(0, 60).map(([s, e]) => `[${s.toFixed(2)},${e.toFixed(2)}]`).join(' ')
    : '(none measured)';

  const context = [
    `VIDEO DURATION: ${opts.durationS.toFixed(1)}s`,
    `TIMELINE:\n${clipSummary}`,
    `SILENT SPANS: ${silenceSummary}`,
    `LOUDNESS:\n${describeLoudness(opts.energy, opts.durationS, opts.audio)}`,
    `TRANSCRIPT:\n${transcriptForPrompt(opts.transcript)}`,
    opts.visual ? `PICTURE (measured from the pixels, not guessed):\n${summariseVisual(opts.visual)}` : null,
    opts.frames?.length
      ? `FRAMES ATTACHED: ${opts.frames.length}, taken at ` +
        `${(opts.visual ? keyframeTimes(opts.visual, opts.frames.length) : [])
            .map(t => `${t.toFixed(1)}s`).join(', ')}. ` +
        'Describe only what is in them. If you are unsure, say so.'
      : null,
    opts.style ? `REFERENCE STYLE LEARNED: ${opts.style}` : null,
  ].filter(Boolean).join('\n\n');

  const recent = opts.history.slice(-6).map(m => ({
    role:    m.role === 'ai' ? ('assistant' as const) : ('user' as const),
    content: m.text,
  }));

  const ask = (images: string[]) => chatDetailed([
    { role: 'system', content: SYSTEM },
    { role: 'system', content: context },
    ...recent,
    { role: 'user', content: opts.message },
  ], { json: true, images, timeoutMs: images.length ? 45_000 : 20_000 });

  let res   = await ask(opts.frames ?? []);
  let blind = false;

  /* No model here can see. The question still deserves an answer from the
     measurements, so ask again without the pictures and be plain about it
     rather than dropping all the way back to the rules engine. */
  if (!res.ok && res.reason === 'no_vision') {
    blind = true;
    res = await ask([]);
  }

  if (!res.ok) return { plan: null, failure: { reason: res.reason, detail: res.detail }, blind };

  const plan = extractJson<Plan>(res.result.text);
  if (!plan || typeof plan.reply !== 'string') {
    return { plan: null, failure: { reason: 'empty_response', detail: 'the model did not return usable JSON' } };
  }

  /* Clips are suggestions, not edits: every timestamp the model returns is
     clamped, snapped to sentence edges and topped up from the measurement
     engine before it can reach the UI. Count, length and start-bias are read
     from what the person asked ("give me 5", "30 seconds", "at the start"). */
  const clipWant = parseClipRequest(opts.message, { count: 5 });
  const clipReq = {
    durationS: opts.durationS,
    count:    clipWant.count,
    targetLenS: clipWant.targetLenS ?? 45,
    energy:   opts.energy,
    silences: opts.silences,
    visual:   opts.visual ?? null,
    transcript: opts.transcript,
    bias:     clipWant.bias,
  };
  const aiClips = Array.isArray(plan.clips) ? sanitiseClips({ clips: plan.clips }, clipReq) : [];
  const clipsOut = aiClips.length ? mergeClips(aiClips, clipReq) : undefined;

  return {
    plan: {
      reply:      plan.reply.slice(0, 600),
      operations: validateOperations(plan.operations, { durationS: opts.durationS }),
      ...(clipsOut?.length ? { clips: clipsOut } : {}),
    },
    failure: null,
    blind,
    model: res.result.model,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const project = db.projects.findById(id);

  const body = await req.json().catch(() => ({}));
  const message: string = body.message?.trim() ?? '';
  if (!message) return NextResponse.json({ error: 'Message required' }, { status: 400 });

  /* The Studio keeps its timeline in the browser (IndexedDB + local state)
     rather than on the server, so the route must be able to operate on the
     clips it is sent — otherwise the same AI that edits Studio would
     run against an empty timeline. The server copy is only a fallback for
     projects whose timeline lives there. */
  const clientClips = parseClientClips(body.clips);
  const durationS = Number(body.durationS) > 0
    ? Number(body.durationS)
    : project?.durationS ?? 1578;
  /* First pass: the drop-screen brief is a user instruction, so it goes
     through this SAME AI — on an empty timeline the route operates on a
     single full-length seed clip instead of the server copy. */
  const generating = body.mode === 'generate';
  const clips: Clip[] = clientClips ?? (generating ? seedClips(durationS) : project?.clips ?? []);

  if (project && project.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const silences: [number, number][] = Array.isArray(body.silences)
    ? body.silences.filter((r: unknown) => Array.isArray(r) && r.length === 2).slice(0, 200)
    : [];
  const style: string | undefined = typeof body.style === 'string' ? body.style : undefined;
  const audio: 'pending' | 'ready' | 'failed' =
    body.audio === 'pending' || body.audio === 'failed' ? body.audio : 'ready';
  const energy: number[] = Array.isArray(body.energy)
    ? body.energy.filter((n: unknown) => typeof n === 'number').slice(0, 7200)
    : [];

  /**
   * What the browser saw. Measurements are cheap and always trustworthy, so
   * they travel with every message; frames are heavy and only come along when
   * the question needs eyes.
   */
  const visual: VisualScan | null = (() => {
    const v = body.visual;
    if (!v || typeof v !== 'object' || !Array.isArray(v.samples)) return null;
    const samples = v.samples
      .filter((x: unknown) => x && typeof (x as { tS?: unknown }).tS === 'number')
      .slice(0, 400)
      .map((x: { tS: number; brightness?: number; motion?: number }) => ({
        tS: x.tS, brightness: Number(x.brightness ?? 0), motion: Number(x.motion ?? 0),
      }));
    if (!samples.length) return null;
    return {
      durationS: Number(v.durationS) || durationS,
      samples,
      cuts: Array.isArray(v.cuts) ? v.cuts.filter((n: unknown) => typeof n === 'number').slice(0, 400) : [],
    };
  })();

  const frames: string[] = Array.isArray(body.frames)
    ? body.frames
        .filter((f: unknown) => typeof f === 'string' && f.startsWith('data:image/'))
        .slice(0, 6)
    : [];

  /**
   * Prefer the transcript the browser sent. The server's copy lives in memory,
   * and on a serverless host a later request routinely lands on an instance
   * that never saw it — which made a freshly transcribed project look
   * untranscribed. The browser always has the newest copy.
   */
  const clientTranscript = (() => {
    const raw = body.transcript;
    if (!raw || typeof raw !== 'object') return null;
    const segments = sanitiseSegments(
      (raw as { segments?: unknown }).segments &&
      Array.isArray((raw as { segments: unknown[] }).segments)
        ? (raw as { segments: Record<string, unknown>[] }).segments
            .map(sg => ({ start: sg.startS, end: sg.endS, text: sg.text }))
        : null,
      durationS || Number.MAX_SAFE_INTEGER);
    if (!segments.length) return null;
    return {
      segments,
      language: String((raw as { language?: unknown }).language ?? ''),
      model:    String((raw as { model?: unknown }).model ?? ''),
      madeAt:   String((raw as { madeAt?: unknown }).madeAt ?? new Date().toISOString()),
    } as Transcript;
  })();

  const transcript: Transcript | null = clientTranscript ?? project?.transcript ?? null;

  // Keep the server copy fresh when the browser knows more than it does.
  if (project && clientTranscript &&
      clientTranscript.segments.length > (project.transcript?.segments.length ?? 0)) {
    db.projects.update(id, { transcript: clientTranscript });
  }
  /* Undo is not a thing to ask a model about. One step back, always
     available, because this editor has already deleted someone's title on a
     misread and "oh my god" is not a repair tool. */
  if (/^\s*(undo|revert|put (it|that) back|ctrl\s*\+?\s*z)\b/i.test(message)) {
    const back = project?.previousClips;
    const now  = new Date().toISOString();
    const userMsg = { role: 'user' as const, text: message, ts: now };
    const reply = back
      ? 'Put it back the way it was.'
      : 'There is nothing to undo yet — this is as far back as I go.';
    const aiMsg = { role: 'ai' as const, text: reply, ts: new Date(Date.now() + 100).toISOString() };

    /* Studio owns its timeline in the browser — never write its view over a
       server project. */
    if (project && !clientClips) {
      db.projects.update(id, {
        aiHistory: [...(project.aiHistory ?? []), userMsg, aiMsg],
        ...(back ? { clips: back, previousClips: project.clips } : {}),
      });
    }
    return NextResponse.json({
      userMessage: userMsg,
      aiMessage:   aiMsg,
      edit: {
        summary: back ? 'undone' : 'nothing to undo', savedS: 0, affectedIds: [],
        intent: 'undo', newClips: back ?? clips,
      },
      engine: { source: 'rules', provider: 'none', model: 'undo', build: buildTag() },
    });
  }

  const provider = detectProvider();
  let edit: EditResult | null = null;
  let source: 'llm' | 'rules' = 'rules';

  let failure: { reason: FailureReason; detail: string } | null = null;
  /** The model that actually answered. Differs from the provider default when
   *  the question needed eyes and went to the multimodal model instead. */
  let modelUsed: string | null = null;

  if (provider.ready) {
    const attempt = await planWithLlm({
      message, durationS, clips, silences, energy, audio, transcript, style, visual, frames,
      history: (Array.isArray(body.history) && body.history.length
        ? body.history.slice(-8)
        : (project?.aiHistory ?? []))
        .map((m: { role?: unknown; text?: unknown }) => ({
          role: String(m?.role) === 'ai' ? 'ai' as const : 'user' as const,
          text: String(m?.text ?? ''),
        })),
    });
    const plan = attempt.plan;
    failure = attempt.failure;
    modelUsed = attempt.model ?? null;

    /* Frames were offered and nothing could look at them. Never let an answer
       stand as if it had seen the video. */
    const blindNote = attempt.blind && frames.length
      ? ' (I answered from the measurements — no model available to this app can look at the frames. ' +
        'A Google AI Studio key, or a Groq account with qwen/qwen3.6-27b, and I can.)'
      : '';

    if (plan) {
      const grounded = groundOperations(plan.operations, message);
      const rewritten = grounded.some((g, i) => g.op !== plan.operations[i]?.op);

      const outcome = applyOperations(clips as TimelineClip[], grounded,
                                      { durationS, silences, transcript,
                                        previousClips: (project?.previousClips ?? []) as TimelineClip[] });
      source = 'llm';

      /* The model writes its reply before knowing whether the edit was
         possible. When nothing was applied, "Taken that one off." is simply
         untrue — say what actually happened instead. */
      const didNothing = outcome.applied.length === 0 && outcome.summary !== 'No change';

      /* If the plan had to be corrected — a deletion read back as the move it
         actually was — the model's sentence describes something that never
         happened. Report the edit, not the intention. */
      const misdescribed = rewritten && outcome.summary !== 'No change';

      /* Restoring something that had been deleted, or adding words that were
         never there, is not what "I moved it" says. Tell them what happened. */
      const surprising = /^(put "|there was no )/.test(outcome.summary);

      edit = {
        reply:       (didNothing || misdescribed || surprising
                        ? sentence(outcome.summary)
                        : plan.reply) + blindNote,
        summary:     outcome.summary,
        savedS:      Math.round(outcome.removedS),
        affectedIds: outcome.affectedIds,
        newClips:    outcome.clips as Clip[],
        intent:      'unknown',
        applied:     outcome.applied,
        ...(plan.clips?.length ? { clipSuggestions: plan.clips } : {}),
      };
    }
  }

  // No key, or the model failed / timed out — deterministic fallback.
  // Say which of those it was: "I have no AI model" and "I could not reach the
  // AI model" call for completely different actions from the user.
  // A clipping request always deserves the measurement engine when the model
  // produced no clips — and when clips were asked for "at the start", the
  // measurement engine with start-bias is the correct answer regardless, since
  // the model is told to spread its picks across the video.
  const clipWant = detectIntent(message) === 'clips'
    ? parseClipRequest(message, { count: 5 }) : null;
  const wantsClips = detectIntent(message) === 'clips' &&
    (!edit?.clipSuggestions?.length || clipWant?.bias === 'start');
  if (!edit || wantsClips) {
    const intent = detectIntent(message);
    const modelNote = failure
      ? `${explainFailure(failure.reason, provider.name, failure.detail)} ` +
        'In the meantime I can still cut the dead air, pick the highlights, or add captions ' +
        'from the measurements taken in your browser.'
      : "I'm running without an AI model, so I only understand a few set phrases: cut the dead air, " +
        'pick the highlights, or add captions. No provider key reached this deployment ' +
        `(${buildTag()}) — if you have just added one, it only takes effect on a build made afterwards.`;
    edit = applyEdit(intent, clips, durationS, {
      silences, energy, modelNote, transcript, message, visual,
      previousClips: project?.previousClips ?? [],
    });
  }

  const now    = new Date().toISOString();
  const userMsg = { role: 'user' as const, text: message, ts: now };
  const aiMsg   = { role: 'ai'   as const, text: edit.reply, ts: new Date(Date.now() + 100).toISOString() };

  // Persist to project if it exists (not for browser-owned Studio timelines)
  if (project && !clientClips) {
    db.projects.update(id, {
      aiHistory: [...(project.aiHistory ?? []), userMsg, aiMsg],
      /* Every branch of applyEdit returns the whole timeline, including the
         no-change one, so this can be written straight through. Treating an
         empty list as "nothing happened" meant taking the last clip off
         never stuck. */
      clips: edit.newClips,
      /* Keep one step of history so "undo" and "put it back" mean something. */
      ...(JSON.stringify(edit.newClips) !== JSON.stringify(clips)
            ? { previousClips: clips }
            : {}),
    });
  }

  return NextResponse.json({
    userMessage:  userMsg,
    aiMessage:    aiMsg,
    edit: {
      summary:     edit.summary,
      savedS:      edit.savedS,
      affectedIds: edit.affectedIds,
      intent:      edit.intent,
      newClips:    edit.newClips,
      ...(edit.applied?.length ? { applied: edit.applied } : {}),
      ...(edit.clipSuggestions?.length ? { clips: edit.clipSuggestions } : {}),
    },
    engine: {
      source, provider: provider.name, model: modelUsed ?? provider.model,
      ...(failure ? { failure: failure.reason } : {}),
      build: buildTag(),
    },
  });
}
