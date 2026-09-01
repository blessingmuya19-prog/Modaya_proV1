/**
 * POST /api/projects/:id/ai
 * Accepts a user message, runs intent detection, returns a structured
 * AI response with: reply text, edit summary, affected clip ids, and
 * a simulated new timeline (clips with cuts applied).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db, Clip } from '@/lib/db';
import { v4 as uuid } from 'uuid';
import { describeLoudness } from '@/lib/ai/highlights';
import { transcriptForPrompt, fillerRanges, sanitiseSegments, Transcript } from '@/lib/ai/transcript';
import { chatDetailed, explainFailure, extractJson, detectProvider, FailureReason } from '@/lib/ai/llm';
import { groundOperations, validateOperations, applyOperations, parseStyle, parsePlacement, Operation, TimelineClip } from '@/lib/ai/operations';

// ── Intent detection ──────────────────────────────────────────────────────────

type Intent =
  | 'tighten' | 'clean' | 'moments' | 'captions' | 'text_overlay' | 'restyle'
  | 'move_text' | 'remove_text'
  | 'vertical' | 'highlights' | 'cut_silence' | 'unknown';

function detectIntent(text: string): Intent {
  const p = text.toLowerCase();
  if (p.match(/pause|dead.?air|silence|gap|tighten|pace/))         return 'cut_silence';
  if (p.match(/filler|um+|uh+|stutter|repeat|clean/))              return 'clean';
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
  if (p.match(/\b(move|put|place|shift|reposition|drag)\b|corner/) &&
      p.match(/\b(top|bottom|lower|upper|corner|left|right|middle|centre|center|up|down)\b/) &&
      !p.match(/\bcaptions?\b|\bsubtitles?\b/))                   return 'move_text';
  if (p.match(/\btext\b|\btitle\b|\bname\b|overlay|watermark|lower.?third/))
                                                                   return 'text_overlay';
  if (p.match(/highlight|best moment|standout|top (?:moment|part|bit|clip|section)|\bmoments?\b/))
                                                                   return 'moments';
  if (p.match(/vertical|9.?:?.?16|portrait|tiktok|reels|shorts/)) return 'vertical';
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

// ── Reply & edit generation ───────────────────────────────────────────────────

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
  newClips:     Clip[];           // updated clips after edit (simulated)
  intent:       Intent;
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
  },
): EditResult {

  const run = (ops: Operation[]) =>
    applyOperations(clips as TimelineClip[], ops,
      { durationS, silences: ctx.silences, transcript: ctx.transcript ?? null });

  const nothing = (reply: string): EditResult => ({
    reply, summary: 'No change', savedS: 0, affectedIds: [], newClips: clips, intent,
  });

  switch (intent) {
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
      if (!ctx.energy.length) {
        return nothing(
          'I need to analyse your audio before I can pick highlights. Reopen the project ' +
          'so the media loads, then ask again.');
      }
      // Keep the loudest ~35% of the runtime, merged into contiguous windows
      const ranked  = ctx.energy.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
      const keepSec = Math.max(1, Math.round(ctx.energy.length * 0.35));
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
               `by audio energy — ${fmtS(durationS - out.removedS)} of the original ${fmtS(durationS)}. ` +
               'That ranking is loudness, not meaning; with an AI key I can choose on content instead.',
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
          ? `${out.summary.charAt(0).toUpperCase()}${out.summary.slice(1)}${asking ? '' : '.'}`
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
  "operations": [ ... ]
}

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
- remove_text takes text off: match on its words, or position:"lower" for
  "remove the one at the bottom", or all:true for every overlay. You CAN
  remove one and keep another — never claim you can only remove all text.
  When they single one out — "the one on the bottom", "the top one" — you
  MUST set match or position. A bare remove_text means every overlay.
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

interface Plan { reply: string; operations: unknown }

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
}): Promise<{
  plan:    { reply: string; operations: Operation[] } | null;
  failure: { reason: FailureReason; detail: string } | null;
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
    opts.style ? `REFERENCE STYLE LEARNED: ${opts.style}` : null,
  ].filter(Boolean).join('\n\n');

  const recent = opts.history.slice(-6).map(m => ({
    role:    m.role === 'ai' ? ('assistant' as const) : ('user' as const),
    content: m.text,
  }));

  const res = await chatDetailed([
    { role: 'system', content: SYSTEM },
    { role: 'system', content: context },
    ...recent,
    { role: 'user', content: opts.message },
  ], { json: true, timeoutMs: 20_000 });

  if (!res.ok) return { plan: null, failure: { reason: res.reason, detail: res.detail } };

  const plan = extractJson<Plan>(res.result.text);
  if (!plan || typeof plan.reply !== 'string') {
    return { plan: null, failure: { reason: 'empty_response', detail: 'the model did not return usable JSON' } };
  }

  return {
    plan: {
      reply:      plan.reply.slice(0, 600),
      operations: validateOperations(plan.operations, { durationS: opts.durationS }),
    },
    failure: null,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const project = db.projects.findById(id);

  // Graceful fallback: project may not exist in serverless memory
  const durationS = project?.durationS ?? 1578;
  const clips     = project?.clips     ?? [];

  if (project && project.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const message: string = body.message?.trim() ?? '';
  if (!message) return NextResponse.json({ error: 'Message required' }, { status: 400 });

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
  const provider = detectProvider();
  let edit: EditResult | null = null;
  let source: 'llm' | 'rules' = 'rules';

  let failure: { reason: FailureReason; detail: string } | null = null;

  if (provider.ready) {
    const attempt = await planWithLlm({
      message, durationS, clips, silences, energy, audio, transcript, style,
      history: (project?.aiHistory ?? []).map(m => ({ role: m.role, text: m.text })),
    });
    const plan = attempt.plan;
    failure = attempt.failure;

    if (plan) {
      const outcome = applyOperations(clips as TimelineClip[],
                                      groundOperations(plan.operations, message),
                                      { durationS, silences, transcript });
      source = 'llm';

      /* The model writes its reply before knowing whether the edit was
         possible. When nothing was applied, "Taken that one off." is simply
         untrue — say what actually happened instead. */
      const didNothing = outcome.applied.length === 0 && outcome.summary !== 'No change';

      edit = {
        reply:       didNothing
                       ? `${outcome.summary.charAt(0).toUpperCase()}${outcome.summary.slice(1)}`
                       : plan.reply,
        summary:     outcome.summary,
        savedS:      Math.round(outcome.removedS),
        affectedIds: outcome.affectedIds,
        newClips:    outcome.clips as Clip[],
        intent:      'unknown',
      };
    }
  }

  // No key, or the model failed / timed out — deterministic fallback.
  // Say which of those it was: "I have no AI model" and "I could not reach the
  // AI model" call for completely different actions from the user.
  if (!edit) {
    const intent = detectIntent(message);
    const modelNote = failure
      ? `${explainFailure(failure.reason, provider.name, failure.detail)} ` +
        'In the meantime I can still cut the dead air, pick the highlights, or add captions ' +
        'from the measurements taken in your browser.'
      : "I'm running without an AI model, so I only understand a few set phrases: cut the dead air, " +
        'pick the highlights, or add captions. No provider key reached this deployment ' +
        `(${buildTag()}) — if you have just added one, it only takes effect on a build made afterwards.`;
    edit = applyEdit(intent, clips, durationS, { silences, energy, modelNote, transcript, message });
  }

  const now    = new Date().toISOString();
  const userMsg = { role: 'user' as const, text: message, ts: now };
  const aiMsg   = { role: 'ai'   as const, text: edit.reply, ts: new Date(Date.now() + 100).toISOString() };

  // Persist to project if it exists
  if (project) {
    db.projects.update(id, {
      aiHistory: [...(project.aiHistory ?? []), userMsg, aiMsg],
      /* Every branch of applyEdit returns the whole timeline, including the
         no-change one, so this can be written straight through. Treating an
         empty list as "nothing happened" meant taking the last clip off
         never stuck. */
      clips: edit.newClips,
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
    },
    engine: {
      source, provider: provider.name, model: provider.model,
      ...(failure ? { failure: failure.reason } : {}),
      build: buildTag(),
    },
  });
}
