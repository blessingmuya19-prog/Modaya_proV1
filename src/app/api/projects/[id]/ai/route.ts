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
import { chatDetailed, explainFailure, extractJson, detectProvider, FailureReason } from '@/lib/ai/llm';
import { validateOperations, applyOperations, Operation, TimelineClip } from '@/lib/ai/operations';

// ── Intent detection ──────────────────────────────────────────────────────────

type Intent =
  | 'tighten' | 'clean' | 'moments' | 'captions'
  | 'vertical' | 'highlights' | 'cut_silence' | 'unknown';

function detectIntent(text: string): Intent {
  const p = text.toLowerCase();
  if (p.match(/pause|dead.?air|silence|gap|tighten|pace/))         return 'cut_silence';
  if (p.match(/filler|um+|uh+|stutter|repeat|clean/))              return 'clean';
  if (p.match(/highlight|best|moment|standout|top|clip/))          return 'moments';
  if (p.match(/caption|subtitle|transcri/))                        return 'captions';
  if (p.match(/vertical|9.?:?.?16|portrait|tiktok|reels|shorts/)) return 'vertical';
  if (p.match(/tighten|shorter|concise|trim|cut/))                 return 'tighten';
  return 'unknown';
}

// ── Reply & edit generation ───────────────────────────────────────────────────

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
  ctx: { silences: [number, number][]; energy: number[]; modelNote?: string },
): EditResult {

  const run = (ops: Operation[]) =>
    applyOperations(clips as TimelineClip[], ops, { durationS, silences: ctx.silences });

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
      const out = run([{ op: 'add_captions', position: 'lower', everyS: 3 }]);
      const count = out.clips.filter(c => c.type === 'text').length;
      return {
        reply: `Added ${count} empty caption slots across the timeline, spaced every 3 seconds. ` +
               "I can't transcribe the words yet — speech recognition isn't wired up — so the text " +
               'is blank and ready for you to fill in.',
        summary:     `${count} caption slots added`,
        savedS:      0,
        affectedIds: out.affectedIds,
        newClips:    out.clips as Clip[],
        intent,
      };
    }

    case 'clean':
      return nothing(
        "Removing filler words needs a transcript, and speech recognition isn't available yet. " +
        'What I can do now is cut the measured pauses — ask me to cut the dead air.');

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
  {"op":"add_captions","position":"lower"|"centre","everyS":number}
  {"op":"punch_in","rate":0..1}                          push in on some shots
  {"op":"grade","brightness":n,"contrast":n,"saturation":n}   around 1.0
  {"op":"none"}                                          nothing to change

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

What you cannot do — say so plainly instead of pretending:
- You cannot see the picture. You do not know who is on screen or what happens.
- You cannot hear speech. There is no transcript, so you cannot quote anyone,
  write real captions, or remove filler words.
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

  const provider = detectProvider();
  let edit: EditResult | null = null;
  let source: 'llm' | 'rules' = 'rules';

  let failure: { reason: FailureReason; detail: string } | null = null;

  if (provider.ready) {
    const attempt = await planWithLlm({
      message, durationS, clips, silences, energy, audio, style,
      history: (project?.aiHistory ?? []).map(m => ({ role: m.role, text: m.text })),
    });
    const plan = attempt.plan;
    failure = attempt.failure;

    if (plan) {
      const outcome = applyOperations(clips as TimelineClip[], plan.operations,
                                      { durationS, silences });
      source = 'llm';
      edit = {
        reply:       plan.reply,
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
    edit = applyEdit(intent, clips, durationS, { silences, energy, modelNote });
  }

  const now    = new Date().toISOString();
  const userMsg = { role: 'user' as const, text: message, ts: now };
  const aiMsg   = { role: 'ai'   as const, text: edit.reply, ts: new Date(Date.now() + 100).toISOString() };

  // Persist to project if it exists
  if (project) {
    db.projects.update(id, {
      aiHistory: [...(project.aiHistory ?? []), userMsg, aiMsg],
      clips: edit.newClips.length > 0 ? edit.newClips : clips,
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
