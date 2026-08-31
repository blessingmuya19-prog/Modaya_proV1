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

interface ProviderConfig {
  name:    ProviderName;
  model:   string;
  /** Free-tier default model, overridable with LLM_MODEL. */
  ready:   boolean;
}

const DEFAULT_MODELS: Record<Exclude<ProviderName, 'none'>, string> = {
  groq:       'llama-3.3-70b-versatile',
  gemini:     'gemini-2.5-flash',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  cloudflare: '@cf/meta/llama-3.1-8b-instruct',
  ollama:     'llama3.1',
};

const env = (k: string): string => (process.env[k] ?? '').trim();

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

async function openAiCompatible(
  baseUrl: string, apiKey: string, model: string, messages: ChatMessage[],
  json: boolean, extraHeaders: Record<string, string> = {},
): Promise<string | null> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens:  900,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.choices?.[0]?.message?.content ?? null;
}

async function gemini(
  apiKey: string, model: string, messages: ChatMessage[], json: boolean,
): Promise<string | null> {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const turns  = messages.filter(m => m.role !== 'system').map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
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
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? null;
}

async function cloudflare(
  token: string, account: string, model: string, messages: ChatMessage[],
): Promise<string | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ messages, max_tokens: 900 }),
    },
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.result?.response ?? null;
}

async function ollama(
  baseUrl: string, model: string, messages: ChatMessage[], json: boolean,
): Promise<string | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, messages, stream: false, ...(json ? { format: 'json' } : {}) }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.message?.content ?? null;
}

/* ─────────────── public API ─────────────── */

export async function chat(
  messages: ChatMessage[],
  opts: { json?: boolean; timeoutMs?: number } = {},
): Promise<LlmResult | null> {
  const cfg = detectProvider();
  if (!cfg.ready) return null;

  const json      = opts.json ?? false;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const call = (): Promise<string | null> => {
    switch (cfg.name) {
      case 'groq':
        return openAiCompatible('https://api.groq.com/openai/v1', env('GROQ_API_KEY'), cfg.model, messages, json);
      case 'gemini':
        return gemini(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'), cfg.model, messages, json);
      case 'openrouter':
        return openAiCompatible('https://openrouter.ai/api/v1', env('OPENROUTER_API_KEY'), cfg.model, messages, json, {
          'HTTP-Referer': env('APP_URL') || 'https://modaya.app',
          'X-Title':      'Modaya',
        });
      case 'cloudflare':
        return cloudflare(env('CLOUDFLARE_API_TOKEN'), env('CLOUDFLARE_ACCOUNT_ID'), cfg.model, messages);
      case 'ollama':
        return ollama(env('OLLAMA_BASE_URL'), cfg.model, messages, json);
      default:
        return Promise.resolve(null);
    }
  };

  const text = await withTimeout(call().catch(() => null), timeoutMs);
  if (!text) return null;
  return { text, provider: cfg.name, model: cfg.model };
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
