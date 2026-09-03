/**
 * POST /api/projects/:id/clips
 *
 * The clipping engine. Given the measurements the browser took (loudness,
 * silences, visual scan) and the transcript if speech recognition has run,
 * it returns several short, self-contained clips a creator can post to
 * TikTok / Reels / Shorts.
 *
 * It costs nothing and works with no key: clips are found from the real
 * audio and picture measurements. With any free key configured (Groq, Google
 * AI Studio, OpenRouter, Cloudflare, Ollama) and a transcript present, the
 * model reads for meaning — real hook titles, topic tags, shareability scores
 * — and every timestamp it returns is clamped and snapped here before it can
 * reach the timeline.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sanitiseSegments, Transcript } from '@/lib/ai/transcript';
import { chatDetailed, extractJson, detectProvider, explainFailure, type FailureReason } from '@/lib/ai/llm';
import type { VisualScan } from '@/lib/ai/visualScan';
import {
  ClipSuggestion,
  buildViralCandidates, viralPrompt, viralSystemPrompt, clipsFromVirality,
  findClipsByMeasurement, parseClipRequest,
} from '@/lib/ai/clips';
import { twelveLabsReady, rankHighlights, applyRanking } from '@/lib/ai/twelvelabs';

export const maxDuration = 60;

/** Which build answered, so a stale deployment is easy to spot. */
function buildTag(): string {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7);
  const env = process.env.VERCEL_ENV ?? '';
  if (!sha && !env) return 'local dev server';
  return [sha && `build ${sha}`, env].filter(Boolean).join(', ');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await ctx.params;
  const project = db.projects.findById(id);
  if (project && project.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const durationS = project?.durationS ?? 0;
  const body = await req.json().catch(() => ({}));

  // ── inputs, all optional and all validated ──────────────────────────────
  // Count / length / placement can come from explicit fields or, when the
  // request is driven from chat, from the words used ("give me 5", "30 sec",
  // "at the start"). Explicit fields win.
  const parsed = parseClipRequest(typeof body.message === 'string' ? body.message : '', {});
  const count = Math.max(1, Math.min(10, Math.round(Number(body.count) || parsed.count || 5)));
  const targetLenS = Math.max(10, Math.min(120, Math.round(
    Number(body.targetLenS) || parsed.targetLenS || 45)));
  const bias: 'spread' | 'start' =
    body.bias === 'start' || body.bias === 'spread' ? body.bias : parsed.bias;
  const minLenS = Math.round(targetLenS * 0.5);
  const maxLenS = Math.min(120, Math.round(targetLenS * 1.8));

  const energy: number[] = Array.isArray(body.energy)
    ? body.energy.filter((n: unknown) => typeof n === 'number').slice(0, 7200) : [];
  const silences: [number, number][] = Array.isArray(body.silences)
    ? body.silences.filter((r: unknown) => Array.isArray(r) && r.length === 2).slice(0, 200)
    : [];

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

  // The browser's transcript is the source of truth (serverless instances
  // don't share memory); fall back to the project's stored copy.
  const transcript: Transcript | null = (() => {
    const raw = body.transcript;
    if (raw && typeof raw === 'object' && Array.isArray((raw as { segments?: unknown }).segments)) {
      const segs = sanitiseSegments(
        ((raw as { segments: Record<string, unknown>[] }).segments)
          .map(sg => ({ start: sg.startS, end: sg.endS, text: sg.text })),
        durationS || Number.MAX_SAFE_INTEGER);
      if (segs.length) {
        return {
          segments: segs,
          language: String((raw as { language?: unknown }).language ?? ''),
          model:    String((raw as { model?: unknown }).model ?? ''),
          madeAt:   String((raw as { madeAt?: unknown }).madeAt ?? new Date().toISOString()),
        };
      }
    }
    return project?.transcript ?? null;
  })();

  const clipReq = { durationS, count, targetLenS, minLenS, maxLenS, energy, silences, visual, transcript, bias };

  // ── measurement clips are always produced and always free ───────────────
  let clips: ClipSuggestion[] = findClipsByMeasurement(clipReq);
  let source: 'ai' | 'measurement' = 'measurement';
  let failure: { reason: FailureReason; detail: string } | null = null;
  let modelUsed: string | null = null;
  let rankedBy: string | null = null;

  const provider = detectProvider();

  // ── Viral detection (OpenShorts-style): grounded candidates scored for
  //    shareability by the free text LLM. The windows come from us (built
  //    from the real sentences), the model only judges and titles them. ─────
  const canUseAi = provider.ready && !!transcript?.segments?.length;
  if (canUseAi) {
    const cands = buildViralCandidates(clipReq);
    if (cands.length) {
      const res = await chatDetailed([
        { role: 'system', content: viralSystemPrompt({ minLenS, maxLenS, targetLenS }) },
        { role: 'user',   content: viralPrompt(cands) },
      ], { json: true, timeoutMs: 45_000 });

      if (res.ok) {
        const parsed = extractJson<{ scores?: unknown }>(res.result.text);
        const viral = clipsFromVirality(parsed, cands, clipReq);
        // Only claim the AI engine if the model actually judged at least one
        // moment; an unparseable/empty score sheet falls through to measurement
        // (which clipsFromVirality already topped the list up with).
        const judged = viral.filter(c => c.source === 'ai' || c.source === 'hybrid').length;
        if (viral.length && judged > 0) {
          clips = viral;
          source = 'ai';
          modelUsed = res.result.model;
        } else if (viral.length) {
          clips = viral;
          failure = { reason: 'empty_response', detail: 'the model returned no usable scores' };
        } else {
          failure = { reason: 'empty_response', detail: 'the model returned no usable scores' };
        }
      } else {
        failure = { reason: res.reason, detail: res.detail };
      }
    }
  } else if (provider.ready && !transcript?.segments?.length) {
    // Key present but nothing transcribed — without words the text model would
    // be guessing, which this app never does. Measurement clips stand.
    failure = {
      reason: 'not_configured',
      detail: 'transcribe first: viral scoring judges what is said, and no transcript has run yet',
    };
  }

  // ── TwelveLabs Pegasus visual ranker (optional). Understands the frames
  //    and audio together, so it can lift action-heavy moments the text model
  //    misses. Needs TWELVELABS_API_KEY and a reachable video URL; degrades to
  //    nothing when absent. ──────────────────────────────────────────────────
  let videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl : null;
  // No explicit URL? If the footage is durably stored and this deployment has
  // a public origin, mint a short-lived signed URL Pegasus can fetch — this is
  // the hosted-video staging the visual ranker always needed.
  if (!videoUrl) {
    const ext = project?.media?.main?.ext;
    const origin = (process.env.PUBLIC_BASE_URL ?? '').trim();
    if (ext && origin && project) {
      const { mediaStore, signMediaUrl } = await import('@/lib/server/mediaStore');
      if (mediaStore().durable) {
        try {
          const signed = signMediaUrl(project.id, 'main', ext);
          if (/^https?:\/\//.test(signed)) videoUrl = signed;
        } catch { /* signing is best-effort; ranker degrades */ }
      }
    }
  }
  if (twelveLabsReady()) {
    const r = await rankHighlights(videoUrl, durationS);
    if (r.ok && r.segments?.length) {
      clips = applyRanking(clips, r.segments, durationS || clips[clips.length - 1]?.endS || 0);
      rankedBy = 'twelvelabs-pegasus';
    }
  }

  // Best first for display; ids are reassigned in score order by the ranker or
  // kept in time order by the engines.
  const ranked = [...clips].sort((a, b) => b.score - a.score);

  const eachS = targetLenS ? `about ${targetLenS}s each` : 'short';
  const where  = bias === 'start' ? ' from the beginning' : '';
  const reply = source === 'ai'
    ? `I found ${ranked.length} viral-ready ${eachS} clips${where} by reading what is said and scoring each moment for shareability${rankedBy ? ', then ranking the visuals with TwelveLabs Pegasus' : ''}. Tap "Cut to this clip" to isolate any of them.`
    : `I found ${ranked.length} ${eachS} clips${where} from the audio energy I measured. Tap "Cut to this clip" to isolate one${provider.ready ? '' : ' — add a free AI key to rank moments by what is actually said'}.`;

  return NextResponse.json({
    clips: ranked,
    reply,
    engine: {
      source,
      provider: provider.name,
      model: modelUsed ?? provider.model,
      ranker: rankedBy,
      twelvelabs: twelveLabsReady(),
      ...(failure ? { failure: failure.reason, failureDetail: failure.detail,
        note: source === 'measurement' && provider.ready
          ? `${explainFailure(failure.reason, provider.name, failure.detail)} Showing clips found from the audio measurements instead.`
          : undefined } : {}),
      transcribed: !!transcript?.segments?.length,
      build: buildTag(),
    },
  });
}
