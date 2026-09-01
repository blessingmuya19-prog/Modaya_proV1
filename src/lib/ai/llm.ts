/**
 * LLM access — provider-agnostic, free-tier friendly, optional.
 *
 * The app must work with no key at all (it falls back to the deterministic
 * rules engine), get better the moment any free key is present, and never
 * hard-depend on one vendor. Providers are auto-detected from the environment
 * in preference order; set LLM_PROVIDER to force one.
 *
 *   GROQ_API_KEY        Groq — OpenAI-compatible, free tier, no card
 *   GEMINI_API_KEY      Google AI Studio — free Flash models
 *   OPENROUTER_API_KEY  OpenRouter — several :free models
 *   CLOUDFLARE_*        Workers AI — free daily neuron allowance
 *   OLLAMA_BASE_URL     A local model, entirely offline
 *
 * Nothing here throws: every failure degrades to `null` so the caller can use
 * its fallback path.
 */

export type ProviderName = 'groq' | 'gemini' | 'openrouter' | 'cloudflare' | 'ollama' | 'none';

export interface ChatMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  text:     string;
  provider: ProviderName;
  model:    string;
}

/**
 * Why a call failed. The distinction matters: telling someone their key was
 * rejected when the machine simply has no route to the provider sends them
 * off to regenerate a perfectly good key.
 */
export type FailureReason =
  | 'not_configured'
  | 'unreachable'
  | 'unauthorized'
  | 'rate_limited'
  | 'model_unavailable'
  | 'json_mode_unsupported'
  | 'timeout'
  | 'empty_response'
  | 'no_vision'
  | 'provider_error';

export class ProviderError extends Error {
  constructor(
    readonly reason: FailureReason,
    readonly status = 0,
    readonly detail = '',
  ) { super(`${reason}${status ? ` (HTTP ${status})` : ''}`); this.name = 'ProviderError'; }
}

/** Map an HTTP status (and body) from any provider onto a reason. */
function reasonFor(status: number, body: string): FailureReason {
  // Groq's strict JSON validator rejects an empty completion, which is exactly
  // what a reasoning model returns when chain-of-thought exhausts the token
  // budget. Retryable without the strict flag, so it gets its own reason.
  if (/json_validate_failed|failed to validate json|response_format/i.test(body)) {
    return 'json_mode_unsupported';
  }
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'model_unavailable';
  if (status === 400 && /model/i.test(body)) return 'model_unavailable';
  if (status >= 500) return 'provider_error';
  return 'provider_error';
}

/** fetch that turns a transport failure into a typed 'unreachable'. */
async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error
      ? (err.cause instanceof Error ? err.cause.message : err.message)
      : String(err);
    throw new ProviderError('unreachable', 0, detail);
  }
}

/** Throw with the real reason unless the response is OK. */
async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new ProviderError(reasonFor(res.status, body), res.status, body.slice(0, 300));
}

interface ProviderConfig {
  name:    ProviderName;
  model:   string;
  /** Free-tier default model, overridable with LLM_MODEL. */
  ready:   boolean;
}

const env = (k: string): string => (process.env[k] ?? '').trim();

/**
 * Free-tier defaults, in preference order. Providers retire models on a few
 * weeks' notice — Groq shut down llama-3.3-70b-versatile on 2026-08-16 — so
 * each provider carries a chain rather than a single id. If the first is gone,
 * the next is tried automatically and the user never has to know.
 */
const MODEL_CHAIN: Record<Exclude<ProviderName, 'none'>, string[]> = {
  groq: [
    'openai/gpt-oss-120b',        // replaces llama-3.3-70b-versatile
    'qwen/qwen3.6-27b',
    'openai/gpt-oss-20b',
    'moonshotai/kimi-k2-instruct',
  ],
  gemini: [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ],
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen3-32b:free',
  ],
  cloudflare: ['@cf/meta/llama-3.1-8b-instruct'],
  ollama:     ['llama3.1'],
};

/**
 * Models that can actually look at a picture. Kept apart from MODEL_CHAIN
 * because most of the good text models are blind, and a blind model handed an
 * image either errors or — far worse — cheerfully describes what it imagines.
 *
 * Groq serves qwen3.6-27b as its multimodal model; Gemini Flash takes images
 * on the free tier; OpenRouter's free Gemma reads them too. Anything not
 * listed is treated as unable to see, and the app says so.
 */
const VISION_MODELS: Record<Exclude<ProviderName, 'none'>, string[]> = {
  groq:       ['qwen/qwen3.6-27b'],
  gemini:     ['gemini-2.5-flash', 'gemini-2.0-flash'],
  openrouter: ['google/gemma-4-31b-it:free'],
  cloudflare: [],
  ollama:     [env('OLLAMA_VISION_MODEL') || 'llava'],
};

/** Can this provider see, and with which model? */
export function visionModelFor(name: ProviderName): string | null {
  if (name === 'none') return null;
  const forced = env('LLM_VISION_MODEL');
  if (forced) return forced;
  return VISION_MODELS[name]?.[0] ?? null;
}

const DEFAULT_MODELS: Record<Exclude<ProviderName, 'none'>, string> =
  Object.fromEntries(
    Object.entries(MODEL_CHAIN).map(([k, v]) => [k, v[0]]),
  ) as Record<Exclude<ProviderName, 'none'>, string>;


export function detectProvider(): ProviderConfig {
  const forced = env('LLM_PROVIDER').toLowerCase() as ProviderName;
  const model  = env('LLM_MODEL');

  const has = (name: Exclude<ProviderName, 'none'>): boolean => {
    switch (name) {
      case 'groq':       return !!env('GROQ_API_KEY');
      case 'gemini':     return !!(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'));
      case 'openrouter': return !!env('OPENROUTER_API_KEY');
      case 'cloudflare': return !!(env('CLOUDFLARE_API_TOKEN') && env('CLOUDFLARE_ACCOUNT_ID'));
      case 'ollama':     return !!env('OLLAMA_BASE_URL');
    }
  };

  const order: Exclude<ProviderName, 'none'>[] =
    forced && forced !== 'none' && forced in DEFAULT_MODELS
      ? [forced as Exclude<ProviderName, 'none'>]
      : ['groq', 'gemini', 'openrouter', 'cloudflare', 'ollama'];

  for (const name of order) {
    if (has(name)) return { name, model: model || DEFAULT_MODELS[name], ready: true };
  }
  return { name: 'none', model: '', ready: false };
}

export function llmAvailable(): boolean {
  return detectProvider().ready;
}

/** Reject with a typed timeout; propagate every other error unchanged. */
async function withTimeoutStrict<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new ProviderError('timeout', 0, `no response in ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>(res => { timer = setTimeout(() => res(null), ms); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ─────────────── providers ─────────────── */

/**
 * OpenAI's content-parts shape: attach the pictures to the last thing the
 * user said, so the model reads the question and the frames together.
 */
function withImages(messages: ChatMessage[], images: string[]) {
  if (!images.length) return messages;
  const out: unknown[] = messages.map(m => ({ role: m.role, content: m.content }));
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i] as { role: string; content: string };
    if (m.role !== 'user') continue;
    out[i] = {
      role: 'user',
      content: [
        { type: 'text', text: m.content },
        ...images.map(url => ({ type: 'image_url', image_url: { url } })),
      ],
    };
    break;
  }
  return out;
}

async function openAiCompatible(
  baseUrl: string, apiKey: string, model: string, messages: ChatMessage[],
  json: boolean, extraHeaders: Record<string, string> = {}, images: string[] = [],
): Promise<string | null> {
  const res = await httpFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: withImages(messages, images),
      temperature: 0.3,
      // Reasoning models need room for chain-of-thought before the answer;
      // too small a budget returns an empty completion.
      max_tokens:  2048,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  await ensureOk(res);
  const data = await res.json().catch(() => null);
  return data?.choices?.[0]?.message?.content ?? null;
}

async function gemini(
  apiKey: string, model: string, messages: ChatMessage[], json: boolean,
  images: string[] = [],
): Promise<string | null> {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const turns  = messages.filter(m => m.role !== 'system').map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }] as Record<string, unknown>[],
  }));

  // Gemini wants raw base64 with the mime type beside it, not a data URL.
  if (images.length) {
    const lastUser = [...turns].reverse().find(t => t.role === 'user');
    if (lastUser) {
      for (const url of images) {
        const m = /^data:([^;]+);base64,(.+)$/.exec(url);
        if (m) lastUser.parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      }
    }
  }

  const res = await httpFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: turns,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 900,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
  );
  await ensureOk(res);
  const data = await res.json().catch(() => null);
  return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? null;
}

async function cloudflare(
  token: string, account: string, model: string, messages: ChatMessage[],
): Promise<string | null> {
  const res = await httpFetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ messages, max_tokens: 900 }),
    },
  );
  await ensureOk(res);
  const data = await res.json().catch(() => null);
  return data?.result?.response ?? null;
}

async function ollama(
  baseUrl: string, model: string, messages: ChatMessage[], json: boolean,
): Promise<string | null> {
  const res = await httpFetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, messages, stream: false, ...(json ? { format: 'json' } : {}) }),
  });
  await ensureOk(res);
  const data = await res.json().catch(() => null);
  return data?.message?.content ?? null;
}

/* ─────────────── public API ─────────────── */

export async function chat(
  messages: ChatMessage[],
  opts: { json?: boolean; timeoutMs?: number; images?: string[] } = {},
): Promise<LlmResult | null> {
  const cfg = detectProvider();
  if (!cfg.ready) return null;

  const out = await chatDetailed(messages, opts);
  return out.ok ? out.result : null;
}

function callProvider(
  cfg: ProviderConfig, messages: ChatMessage[], json: boolean, images: string[] = [],
): Promise<string | null> {
  switch (cfg.name) {
    case 'groq':
      return openAiCompatible(env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1',
        env('GROQ_API_KEY'), cfg.model, messages, json, {}, images);
    case 'gemini':
      return gemini(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'), cfg.model, messages, json, images);
    case 'openrouter':
      return openAiCompatible(env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1',
        env('OPENROUTER_API_KEY'), cfg.model, messages, json, {
          'HTTP-Referer': env('APP_URL') || 'https://modaya.app',
          'X-Title':      'Modaya',
        }, images);
    case 'cloudflare':
      return cloudflare(env('CLOUDFLARE_API_TOKEN'), env('CLOUDFLARE_ACCOUNT_ID'), cfg.model, messages);
    case 'ollama':
      return ollama(env('OLLAMA_BASE_URL'), cfg.model, messages, json);
    default:
      return Promise.resolve(null);
  }
}

export type ChatOutcome =
  | { ok: true;  result: LlmResult }
  | { ok: false; reason: FailureReason; status: number; detail: string };

/**
 * Same call as `chat`, but surfaces why it failed. Use this where a human is
 * waiting on the answer (key setup, diagnostics); use `chat` on hot paths that
 * just want to fall back silently.
 */
export async function chatDetailed(
  messages: ChatMessage[],
  opts: { json?: boolean; timeoutMs?: number; images?: string[] } = {},
): Promise<ChatOutcome> {
  const cfg = detectProvider();
  if (!cfg.ready) {
    return { ok: false, reason: 'not_configured', status: 0, detail: 'no provider key in the environment' };
  }

  /* Pictures go to a model that can see, or nowhere at all. Sending them to a
     text model wastes the call; worse, some answer anyway from the words
     alone and the person is told what is "in" a frame nothing ever looked
     at. */
  const images = opts.images ?? [];
  const seer   = images.length ? visionModelFor(cfg.name) : null;
  if (images.length && !seer) {
    return {
      ok: false, reason: 'no_vision', status: 0,
      detail: `${cfg.name} has no model here that accepts images`,
    };
  }
  // Try the configured model, then the rest of the chain — but only when the
  // model was chosen by us. An explicit LLM_MODEL is the user's decision and is
  // never silently overridden.
  const forcedModel = env('LLM_MODEL');
  const candidates  = seer
    ? [seer]
    : forcedModel
      ? [forcedModel]
      : [cfg.model, ...(MODEL_CHAIN[cfg.name as Exclude<ProviderName, 'none'>] ?? [])
          .filter(m => m !== cfg.model)];

  let last: ChatOutcome = {
    ok: false, reason: 'provider_error', status: 0, detail: 'no model attempted',
  };

  const wantJson = opts.json ?? false;

  const attempt = (model: string, json: boolean) => withTimeoutStrict(
    callProvider({ ...cfg, model }, messages, json, images),
    // Looking at half a dozen frames takes longer than reading a sentence.
    opts.timeoutMs ?? (images.length ? 45_000 : 20_000));

  for (const model of candidates) {
    try {
      let text: string | null;
      try {
        text = await attempt(model, wantJson);
      } catch (err) {
        // Strict JSON mode failed on the provider's side. The prompt already
        // demands JSON and extractJson is forgiving, so ask again without the
        // flag rather than losing the request entirely.
        if (wantJson && err instanceof ProviderError && err.reason === 'json_mode_unsupported') {
          text = await attempt(model, false);
        } else {
          throw err;
        }
      }

      if (!text || !text.trim()) {
        last = { ok: false, reason: 'empty_response', status: 0, detail: 'the provider returned no text' };
        continue;
      }
      return { ok: true, result: { text, provider: cfg.name, model } };
    } catch (err) {
      last = err instanceof ProviderError
        ? { ok: false, reason: err.reason, status: err.status, detail: err.detail }
        : { ok: false, reason: 'provider_error', status: 0,
            detail: err instanceof Error ? err.message : String(err) };

      // Only a retired or unavailable model is worth another attempt; a bad key
      // or a dead network will fail identically for every model in the chain.
      // A retired model is worth another attempt, and so is one whose JSON mode
      // is broken. A bad key or a dead network fails identically every time.
      if (last.reason !== 'model_unavailable' && last.reason !== 'json_mode_unsupported') return last;
    }
  }

  return last;
}

/** Human-readable, provider-aware explanation of a failure. */
export function explainFailure(reason: FailureReason, provider: string, detail = ''): string {
  switch (reason) {
    case 'not_configured':
      return 'No AI provider is configured, so the rules engine is doing the work.';
    case 'unreachable':
      return `This machine could not reach ${provider}. That is a network problem, not a problem with your key — check the connection, a firewall, or an outbound proxy.${detail ? ` (${detail})` : ''}`;
    case 'unauthorized':
      return `${provider} rejected that key. Copy it again from the provider's dashboard — keys are sometimes revoked, or truncated on paste.`;
    case 'rate_limited':
      return `${provider} says you are over its free-tier rate limit. The key is valid; wait a minute and try again.`;
    case 'model_unavailable':
      return `Your ${provider} key works, but none of the models this app knows about are available to your account. ` +
             'Providers retire models regularly — set LLM_MODEL to one your account can access.';
    case 'timeout':
      return `${provider} did not answer in time. The key may well be fine — try once more.`;
    case 'json_mode_unsupported':
      return `${provider} could not return valid JSON for this request, even after retrying without strict mode. ` +
             'Asking again usually works; if it keeps happening, set LLM_MODEL to a different model.';
    case 'empty_response':
      return `${provider} accepted the request but returned nothing.`;
    case 'no_vision':
      return `I can measure the picture — shot changes, movement, brightness — but I cannot look at it: ` +
             `no model available through ${provider} accepts images. ` +
             'Groq serves qwen/qwen3.6-27b, Google AI Studio serves Gemini Flash and OpenRouter ' +
             'serves google/gemma-4-31b-it:free, all on free tiers. A key for any of them, or ' +
             'LLM_VISION_MODEL set to a model your account can use, and I can see the frames.';
    default:
      return `${provider} returned an error.${detail ? ` (${detail})` : ''}`;
  }
}

/**
 * Pull a JSON object out of a model response.
 * Models wrap JSON in prose or code fences even when told not to, so this is
 * deliberately forgiving — but it never evals, and it never guesses.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const direct = tryParse<T>(cleaned);
  if (direct) return direct;

  // Fall back to the outermost {...} in the text
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return tryParse<T>(cleaned.slice(start, end + 1));
  return null;
}

function tryParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}
