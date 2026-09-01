/**
 * POST /api/projects/[id]/transcribe
 *
 * Takes one chunk of WAV audio and returns timed segments. Speech recognition
 * runs on the provider (Groq's Whisper is free with the same key that powers
 * the editing brain), because no browser-side model comes close on accuracy for
 * this size of file.
 *
 * The client sends chunks with an offset; this route shifts the returned
 * timestamps back onto the project timeline and merges them into the project.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { detectProvider } from '@/lib/ai/llm';
import { sanitiseSegments, TranscriptSegment } from '@/lib/ai/transcript';

export const maxDuration = 60;

/** Free on Groq's tier and several times faster than the full model. */
const ASR_MODEL = process.env.ASR_MODEL || 'whisper-large-v3-turbo';

const env = (k: string) => (process.env[k] ?? '').trim();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await ctx.params;
  const project = db.projects.findById(id);
  if (project && project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const key = env('GROQ_API_KEY');
  if (!key) {
    return NextResponse.json({
      error: 'Speech recognition needs a Groq key — the same one the AI editor uses. ' +
             'Add GROQ_API_KEY and redeploy.',
      reason: 'not_configured',
    }, { status: 400 });
  }

  const form    = await req.formData().catch(() => null);
  const audio   = form?.get('audio');
  const offsetS = Number(form?.get('offsetS') ?? 0) || 0;
  const durationS = Number(form?.get('durationS') ?? 0) || project?.durationS || 0;

  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: 'No audio received.' }, { status: 400 });
  }
  if (audio.size > 4 * 1024 * 1024) {
    return NextResponse.json({
      error: 'That audio chunk is too large for the server to accept. ' +
             'This is a bug in how the file was split — please report it.',
      reason: 'chunk_too_large',
    }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append('file', audio, 'audio.wav');
  upstream.append('model', ASR_MODEL);
  upstream.append('response_format', 'verbose_json');
  upstream.append('temperature', '0');

  const base = env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1';

  let res: Response;
  try {
    res = await fetch(`${base}/audio/transcriptions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}` },
      body:    upstream,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      error: `Could not reach the speech recognition service. That is a network problem, not a problem with your key. (${detail})`,
      reason: 'unreachable',
    }, { status: 503 });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const reason =
      res.status === 401 || res.status === 403 ? 'unauthorized' :
      res.status === 429 ? 'rate_limited' :
      res.status === 404 ? 'model_unavailable' : 'provider_error';
    const message =
      reason === 'unauthorized'      ? 'Groq rejected the key for speech recognition.' :
      reason === 'rate_limited'      ? 'Over the Whisper free-tier limit — the key is fine, try again shortly.' :
      reason === 'model_unavailable' ? `Groq will not serve "${ASR_MODEL}" to this account.` :
                                       `Speech recognition failed (HTTP ${res.status}).`;
    return NextResponse.json({ error: message, reason, detail: body.slice(0, 300) }, { status: 502 });
  }

  const data = await res.json().catch(() => null) as
    { segments?: unknown; language?: string; text?: string } | null;

  const local = sanitiseSegments(data?.segments, Number.MAX_SAFE_INTEGER);
  const shifted: TranscriptSegment[] = local.map(s => ({
    startS: Number((s.startS + offsetS).toFixed(3)),
    endS:   Number((s.endS   + offsetS).toFixed(3)),
    text:   s.text,
  }));

  // Merge into whatever earlier chunks produced, keeping the timeline ordered.
  if (project) {
    const existing = project.transcript?.segments ?? [];
    const kept = existing.filter(s => s.endS <= offsetS + 0.001);
    const merged = [...kept, ...shifted].sort((a, b) => a.startS - b.startS).slice(0, 5000);

    db.projects.update(id, {
      transcript: {
        segments: merged,
        language: data?.language || project.transcript?.language || '',
        model:    ASR_MODEL,
        madeAt:   new Date().toISOString(),
      },
    });
  }

  return NextResponse.json({
    segments: shifted,
    language: data?.language ?? '',
    model:    ASR_MODEL,
    durationS,
  });
}
