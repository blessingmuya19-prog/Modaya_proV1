/**
 * TwelveLabs Pegasus — optional visual ranker for the clipping engine.
 *
 * TwelveLabs' Pegasus model understands a video's frames and audio together
 * (not just the transcript), so it can rank action-heavy moments the text LLM
 * cannot. It is an *optional* booster: nothing here is required, and when no
 * `TWELVELABS_API_KEY` is set — or the call fails — the engine simply ranks on
 * the transcript LLM and the browser measurements instead.
 *
 * Input is a publicly reachable video URL (`TWELVELABS_URL` override or a URL
 * passed with the request). TwelveLabs does not accept browser IndexedDB blobs
 * directly; a future upload route can stage the file and set that URL.
 *
 *  Free tier / keys: https://platform.twelvelabs.io
 *  Env:  TWELVELABS_API_KEY   the API key (x-api-key)
 *        TWELVELABS_MODEL     default pegasus1.5
 *        TWELVELABS_URL       a public URL for the source video, if any
 */

export interface RankedSegment {
  startS: number;
  endS:   number;
  /** Why Pegasus thinks this matters, in one short sentence. */
  reason: string;
  /** 0–100 confidence / score Pegasus assigns. */
  score:  number;
}

const env = (k: string): string => (process.env[k] ?? '').trim();

export function twelveLabsReady(): boolean {
  return env('TWELVELABS_API_KEY') !== '';
}

const API   = env('TWELVELABS_BASE_URL') || 'https://api.twelvelabs.io/v1.3';
const MODEL = env('TWELVELABS_MODEL')    || 'pegasus1.5';

/** Map any HTTP failure to a typed reason the caller can log, never throw. */
type FailReason = 'not_configured' | 'no_video' | 'unreachable' | 'rejected'
  | 'rate_limited' | 'empty' | 'provider_error';

export interface RankResult {
  ok: boolean;
  segments?: RankedSegment[];
  reason?:  FailReason;
  detail?:  string;
}

/**
 * Ask Pegasus for the most clip-worthy moments, as time-based segments.
 * Returns { ok:false } for every failure mode so the caller falls back
 * silently; it never throws.
 */
export async function rankHighlights(videoUrl: string | null, durationS: number): Promise<RankResult> {
  if (!twelveLabsReady()) return { ok: false, reason: 'not_configured' };
  const url = (videoUrl ?? env('TWELVELABS_URL')).trim();
  if (!url) return { ok: false, reason: 'no_video' };

  /* Pegasus time-based metadata: define the one segment type we care about —
     a viral, self-contained moment — and let the model return its spans. */
  const body = {
    model_name: MODEL,
    analysis_mode: 'time_based_metadata',
    video: { type: 'url', url },
    temperature: 0.2,
    min_segment_duration: 15,
    response_format: {
      type: 'segment_definitions',
      segment_definitions: [
        {
          id: 'viral_moment',
          description:
            'A self-contained moment ideal for a short vertical clip (TikTok/Reels/Shorts): ' +
            'a strong hook in the first seconds, a clear payoff, surprise, emotion, a useful tip ' +
            'or a highlight of the action. Segment the whole moment, not just the peak.',
          fields: [
            { name: 'reason',     type: 'string', description: 'Why this moment is worth clipping, one short sentence.' },
            { name: 'virality',   type: 'string', enum: ['high', 'medium', 'low'],
              description: 'How strongly this moment would perform as a standalone short.' },
          ],
        },
      ],
    },
  };

  let res: Response;
  try {
    res = await fetch(`${API}/analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env('TWELVELABS_API_KEY') },
      body:    JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, reason: 'unreachable', detail: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected', detail: text.slice(0, 200) };
    if (res.status === 429) return { ok: false, reason: 'rate_limited', detail: text.slice(0, 200) };
    return { ok: false, reason: 'provider_error', detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  const data = await res.json().catch(() => null) as
    | { segments?: Array<{ start?: number; end?: number; start_time?: number; end_time?: number;
        fields?: { reason?: string; virality?: string } }> }
    | { data?: unknown } | null;

  const rawSegs = extractSegments(data);
  const segments: RankedSegment[] = rawSegs
    .map(s => {
      const startS = Number(s.start ?? s.start_time);
      const endS   = Number(s.end   ?? s.end_time);
      if (!Number.isFinite(startS) || !Number.isFinite(endS) || endS <= startS) return null;
      const fields = (s.fields ?? {}) as Record<string, unknown>;
      const virality = String(fields.virality ?? '').toLowerCase();
      const score = virality === 'high' ? 92 : virality === 'medium' ? 72 : virality === 'low' ? 48 : 70;
      return {
        startS: Math.max(0, Math.min(startS, durationS || startS)),
        endS:   Math.max(0, Math.min(endS,   durationS || endS)),
        reason: String(fields.reason ?? 'Ranked by TwelveLabs Pegasus from the visuals and audio.').slice(0, 200),
        score,
      } satisfies RankedSegment;
    })
    .filter((x): x is RankedSegment => x !== null && x.endS - x.startS > 5);

  if (!segments.length) return { ok: false, reason: 'empty' };
  segments.sort((a, b) => b.score - a.score);
  return { ok: true, segments };
}

/** TwelveLabs wraps segments in slightly different shapes across versions. */
function extractSegments(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  const direct = root.segments;
  if (Array.isArray(direct)) return direct as Array<Record<string, unknown>>;
  // Some responses nest under data/results.
  for (const k of ['data', 'results']) {
    const v = root[k];
    if (v && typeof v === 'object') {
      const inner = (v as Record<string, unknown>).segments;
      if (Array.isArray(inner)) return inner as Array<Record<string, unknown>>;
    }
  }
  return [];
}

/**
 * Merge Pegasus-ranked segments into a clip list: a Pegasus moment that lines
 * up with a clip boosts that clip's score; a Pegasus moment with no nearby
 * clip is added as an AI-ranked suggestion. Pure so it is easy to test.
 */
export function applyRanking(
  clips: import('./clips').ClipSuggestion[],
  segments: RankedSegment[],
  durationS: number,
): import('./clips').ClipSuggestion[] {
  const out = clips.map(c => ({ ...c }));
  for (const seg of segments) {
    const mid = (seg.startS + seg.endS) / 2;
    const host = out.find(c => mid >= c.startS && mid < c.endS);
    if (host) {
      // Blend Pegasus in as a strong visual signal.
      host.score = Math.round(Math.min(100, Math.max(host.score, 0.6 * seg.score + 0.4 * host.score)));
      if (!host.reason.includes('TwelveLabs') && !host.reason.includes('Pegasus')) {
        host.reason = `${host.reason} Visual ranking (Pegasus ${seg.score}/100): ${seg.reason}`;
      }
      continue;
    }
    // No overlapping clip — add Pegasus' moment itself.
    out.push({
      id: '',
      startS: Number(seg.startS.toFixed(2)),
      endS:   Number(Math.min(seg.endS, durationS || seg.endS).toFixed(2)),
      score:  seg.score,
      title:  `Highlight at ${Math.floor(seg.startS / 60)}:${String(Math.floor(seg.startS % 60)).padStart(2, '0')}`,
      reason: `Picked by TwelveLabs Pegasus from the visuals and audio: ${seg.reason}`,
      tags:   [],
      source: 'ai',
    });
  }
  out.sort((a, b) => b.score - a.score).forEach((c, i) => { c.id = `clip-${i + 1}`; });
  return out;
}
