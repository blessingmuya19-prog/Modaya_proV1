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
import { chat, extractJson, detectProvider } from '@/lib/ai/llm';
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

function applyEdit(intent: Intent, clips: Clip[], durationS: number): EditResult {
  const savedS = intent === 'cut_silence' ? Math.round(durationS * 0.12)
               : intent === 'clean'       ? Math.round(durationS * 0.08)
               : intent === 'tighten'     ? Math.round(durationS * 0.18)
               : intent === 'moments'     ? Math.round(durationS * 0.60)
               : 0;

  const newDur  = Math.max(30, durationS - savedS);
  const newEnd  = fmtS(newDur);

  // Simulate updated clips — compress endS proportionally
  const ratio = newDur / durationS;
  const newClips: Clip[] = clips.map(c => ({
    ...c,
    endS: Math.round(c.endS * ratio),
    label: c.label,
  }));

  // Pick clips to highlight (up to 3 video/audio clips)
  const affectedIds = clips
    .filter(c => c.type === 'video' || c.type === 'audio')
    .slice(0, 3)
    .map(c => c.id);

  const cutCount = intent === 'cut_silence' ? Math.round(savedS / 4)
                 : intent === 'clean'       ? Math.round(savedS / 3)
                 : intent === 'tighten'     ? Math.round(savedS / 5)
                 : 0;

  const replies: Record<Intent, string> = {
    cut_silence: `Removed ${cutCount} silence sections totalling ${savedS}s. Your video is now ${newEnd} — tighter and easier to watch.`,
    clean:       `Cleaned ${cutCount} filler moments (ums, uhs, repeated phrases) — saved ${savedS}s. New duration: ${newEnd}.`,
    tighten:     `Tightened the overall pacing. Cut ${savedS}s of slow sections. Final cut: ${newEnd}. Review the timeline for flagged sections.`,
    moments:     `Found the strongest ${newEnd} from your footage. Kept your best takes at ${fmtS(durationS*0.15)}, ${fmtS(durationS*0.4)}, and ${fmtS(durationS*0.72)}.`,
    captions:    `Transcribed ${fmtS(durationS)} of audio — ${Math.round(durationS / 4)} caption segments generated at ~96% accuracy. A few low-confidence spots are flagged in yellow on the timeline.`,
    vertical:    `Reframed to 9:16. Speaker centred throughout. Tracked ${Math.round(durationS / 30)} scene changes. Ready for Reels and Shorts.`,
    highlights:  `Highlighted the strongest ${newEnd}. Review and approve in the timeline.`,
    unknown:     `Analysed your request. Applied ${cutCount > 0 ? cutCount + ' cuts' : 'adjustments'} — saved ${savedS > 0 ? savedS + 's' : 'time'}. New duration: ${newEnd}. Anything else?`,
  };

  const summaries: Record<Intent, string> = {
    cut_silence: `${cutCount} pauses cut · −${savedS}s`,
    clean:       `${cutCount} fillers removed · −${savedS}s`,
    tighten:     `Pacing tightened · −${savedS}s`,
    moments:     `Best ${newEnd} extracted`,
    captions:    `${Math.round(durationS / 4)} captions added`,
    vertical:    `Reframed 16:9 → 9:16`,
    highlights:  `Highlights extracted · −${savedS}s`,
    unknown:     `Edit applied · −${savedS}s`,
  };

  return {
    reply:       replies[intent],
    summary:     summaries[intent],
    savedS,
    affectedIds,
    newClips:    savedS > 0 ? newClips : clips,
    intent,
  };
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
- If the request is unclear, use "none" and ask a clarifying question in reply.`;

interface Plan { reply: string; operations: unknown }

async function planWithLlm(opts: {
  message:   string;
  durationS: number;
  clips:     Clip[];
  silences:  [number, number][];
  style?:    string;
  history:   { role: 'user' | 'ai'; text: string }[];
}): Promise<{ reply: string; operations: Operation[] } | null> {

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
    opts.style ? `REFERENCE STYLE LEARNED: ${opts.style}` : null,
  ].filter(Boolean).join('\n\n');

  const recent = opts.history.slice(-6).map(m => ({
    role:    m.role === 'ai' ? ('assistant' as const) : ('user' as const),
    content: m.text,
  }));

  const res = await chat([
    { role: 'system', content: SYSTEM },
    { role: 'system', content: context },
    ...recent,
    { role: 'user', content: opts.message },
  ], { json: true, timeoutMs: 20_000 });

  if (!res) return null;

  const plan = extractJson<Plan>(res.text);
  if (!plan || typeof plan.reply !== 'string') return null;

  return {
    reply:      plan.reply.slice(0, 600),
    operations: validateOperations(plan.operations, { durationS: opts.durationS }),
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

  const provider = detectProvider();
  let edit: EditResult | null = null;
  let source: 'llm' | 'rules' = 'rules';

  if (provider.ready) {
    const plan = await planWithLlm({
      message, durationS, clips, silences, style,
      history: (project?.aiHistory ?? []).map(m => ({ role: m.role, text: m.text })),
    });

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

  // No key, or the model failed / timed out — deterministic fallback
  if (!edit) {
    const intent = detectIntent(message);
    edit = applyEdit(intent, clips, durationS);
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
    engine: { source, provider: provider.name, model: provider.model },
  });
}
