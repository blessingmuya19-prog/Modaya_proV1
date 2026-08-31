/**
 * A failing AI call must say *why* it failed.
 *
 * The bug these lock down: a machine with no route to the provider was told
 * "the provider rejected that key", sending people off to regenerate a key
 * that was never the problem.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chat, chatDetailed, explainFailure } from '@/lib/ai/llm';

const PROVIDER_VARS = [
  'GROQ_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL',
  'LLM_PROVIDER', 'LLM_MODEL', 'GROQ_BASE_URL', 'OPENROUTER_BASE_URL',
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const v of PROVIDER_VARS) { saved[v] = process.env[v]; delete process.env[v]; }
});

afterEach(() => {
  for (const v of PROVIDER_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  vi.restoreAllMocks();
});

const withGroq = () => { process.env.GROQ_API_KEY = 'gsk_test_key_1234'; };

const respond = (status: number, body: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));

const ask = () => chatDetailed([{ role: 'user', content: 'hi' }], { timeoutMs: 500 });

describe('chatDetailed — failure reasons', () => {
  it('reports no provider rather than inventing a rejection', async () => {
    const out = await ask();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_configured');
  });

  it('a transport failure is "unreachable", never a key problem', async () => {
    withGroq();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('ENOTFOUND api.groq.com') });
    }));
    const out = await ask();
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('unreachable');
      expect(out.detail).toContain('ENOTFOUND');
    }
  });

  it('401 is the only thing that blames the key', async () => {
    withGroq();
    respond(401, '{"error":{"message":"Invalid API Key"}}');
    const out = await ask();
    if (!out.ok) { expect(out.reason).toBe('unauthorized'); expect(out.status).toBe(401); }
  });

  it('403 also counts as a rejected key', async () => {
    withGroq();
    respond(403, 'forbidden');
    const out = await ask();
    if (!out.ok) expect(out.reason).toBe('unauthorized');
  });

  it('429 is a rate limit, and says the key is valid', async () => {
    withGroq();
    respond(429, 'rate limit reached');
    const out = await ask();
    if (!out.ok) {
      expect(out.reason).toBe('rate_limited');
      expect(explainFailure(out.reason, 'groq')).toMatch(/key is valid/i);
    }
  });

  it('404, and a 400 naming the model, mean the model is not the key', async () => {
    withGroq();
    respond(404, 'model not found');
    const a = await ask();
    if (!a.ok) expect(a.reason).toBe('model_unavailable');

    respond(400, '{"error":{"message":"model `x` does not exist"}}');
    const b = await ask();
    if (!b.ok) expect(b.reason).toBe('model_unavailable');
  });

  it('a hang becomes a timeout, not a rejection', async () => {
    withGroq();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const out = await ask();
    if (!out.ok) expect(out.reason).toBe('timeout');
  });

  it('a 200 with no text is "empty_response"', async () => {
    withGroq();
    respond(200, JSON.stringify({ choices: [{ message: { content: '' } }] }));
    const out = await ask();
    if (!out.ok) expect(out.reason).toBe('empty_response');
  });

  it('succeeds and reports the provider it used', async () => {
    withGroq();
    respond(200, JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    const out = await ask();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.text).toBe('OK');
      expect(out.result.provider).toBe('groq');
    }
  });
});

describe('chat() keeps its never-throws contract', () => {
  it('returns null instead of propagating a transport error', async () => {
    withGroq();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(chat([{ role: 'user', content: 'hi' }], { timeoutMs: 500 })).resolves.toBeNull();
  });

  it('returns null on a 401 rather than throwing', async () => {
    withGroq();
    respond(401, 'nope');
    await expect(chat([{ role: 'user', content: 'hi' }], { timeoutMs: 500 })).resolves.toBeNull();
  });
});

describe('explainFailure wording', () => {
  it('an unreachable host is explicitly not the key', () => {
    const m = explainFailure('unreachable', 'groq', 'ENOTFOUND');
    expect(m).toMatch(/network problem/i);
    expect(m).toMatch(/not a problem with your key/i);
  });

  it('only "unauthorized" tells the user to replace the key', () => {
    expect(explainFailure('unauthorized', 'groq')).toMatch(/rejected that key/i);
    for (const r of ['unreachable', 'rate_limited', 'timeout', 'model_unavailable'] as const) {
      expect(explainFailure(r, 'groq')).not.toMatch(/rejected that key/i);
    }
  });

  it('never leaks a key into the message', () => {
    const m = explainFailure('unauthorized', 'groq', 'gsk_secret_value_here');
    expect(m).not.toContain('gsk_secret_value_here');
  });
});
