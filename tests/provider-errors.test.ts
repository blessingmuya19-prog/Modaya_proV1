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

/**
 * Diagnostics must name variables, never expose their values — the whole point
 * is to debug a hosted deploy without anyone pasting a secret anywhere.
 */
/**
 * Providers retire models on short notice — Groq shut down
 * llama-3.3-70b-versatile on 2026-08-16, which broke this app in production.
 * A dead default must not become a dead feature.
 */
describe('model chain', () => {
  it('moves to the next model when the first is retired', async () => {
    withGroq();
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      seen.push(model);
      if (seen.length === 1) return new Response('model has been decommissioned', { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
    }));

    const out = await ask();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.model).toBe(seen[1]);
    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('does not retry when the key is the problem', async () => {
    withGroq();
    const fetchMock = vi.fn(async () => new Response('invalid api key', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await ask();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('unauthorized');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects an explicit LLM_MODEL instead of substituting one', async () => {
    withGroq();
    process.env.LLM_MODEL = 'my-own-model';
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)).model);
      return new Response('no such model', { status: 404 });
    }));

    const out = await ask();
    expect(out.ok).toBe(false);
    expect(seen).toEqual(['my-own-model']);
  });

  it('gives up with a clear reason when the whole chain is unavailable', async () => {
    withGroq();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('decommissioned', { status: 404 })));
    const out = await ask();
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('model_unavailable');
      expect(explainFailure(out.reason, 'groq')).toMatch(/set LLM_MODEL/i);
    }
  });

  it('no longer defaults to the model Groq retired', async () => {
    withGroq();
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)).model);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
    }));
    await ask();
    expect(seen[0]).toBe('openai/gpt-oss-120b');
  });
});

describe('settings diagnostics', () => {
  const load = async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));
    const mod = await import('@/app/api/settings/ai/route');
    const res = await mod.GET();
    return res.json();
  };

  afterEach(() => { vi.doUnmock('@/lib/auth'); vi.resetModules(); });

  it('lists a recognised variable by name and never its value', async () => {
    process.env.GROQ_API_KEY = 'gsk_super_secret_value';
    const d = await load();
    expect(d.diagnostics.present).toContain('GROQ_API_KEY');
    expect(JSON.stringify(d)).not.toContain('gsk_super_secret_value');
  });

  it('flags a misspelled variable so the typo is obvious', async () => {
    process.env.GROK_API_KEY = 'gsk_typo';
    const d = await load();
    expect(d.diagnostics.present).not.toContain('GROK_API_KEY');
    expect(d.diagnostics.lookalike).toContain('GROK_API_KEY');
    expect(JSON.stringify(d)).not.toContain('gsk_typo');
    delete process.env.GROK_API_KEY;
  });

  it('treats an empty variable as absent', async () => {
    process.env.GROQ_API_KEY = '   ';
    const d = await load();
    expect(d.diagnostics.present).not.toContain('GROQ_API_KEY');
    expect(d.configured).toBe(false);
  });

  it('spots an API key typed into the variable NAME, without printing it', async () => {
    process.env['gsk_TTNRD4SGrElnpvphYv08WGdyb3FY'] = '';
    const d = await load();
    expect(d.diagnostics.keyShapedName.join(' ')).toMatch(/^gsk_… \(\d+ chars\)$/);
    expect(JSON.stringify(d)).not.toContain('TTNRD4SGrElnpvphYv08WGdyb3FY');
    delete process.env['gsk_TTNRD4SGrElnpvphYv08WGdyb3FY'];
  });

  it('flags whitespace in a variable name', async () => {
    process.env['GROQ_API_KEY '] = 'x';
    const d = await load();
    expect(d.diagnostics.lookalike.join(' ')).toMatch(/whitespace in the name/);
    delete process.env['GROQ_API_KEY '];
  });

  it('reports which Vercel environment the build is', async () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    const d = await load();
    expect(d.diagnostics).toMatchObject({ onVercel: true, vercelEnv: 'preview' });
    delete process.env.VERCEL; delete process.env.VERCEL_ENV;
  });
});

/**
 * Groq's strict JSON validator rejects an empty completion, which is what
 * gpt-oss returns when chain-of-thought eats the token budget. A provider-side
 * quirk must not surface as a dead end to the user.
 */
describe('strict JSON mode failure', () => {
  const jsonFail = () =>
    new Response(JSON.stringify({
      error: {
        message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
        type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: '',
      },
    }), { status: 400 });

  it('retries the same model without the strict flag and succeeds', async () => {
    withGroq();
    const calls: { model: string; strict: boolean }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ model: body.model, strict: !!body.response_format });
      if (calls.length === 1) return jsonFail();
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"here you go","operations":[]}' } }],
      }), { status: 200 });
    }));

    const out = await chatDetailed([{ role: 'user', content: 'hi' }], { json: true, timeoutMs: 500 });
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].strict).toBe(true);
    expect(calls[1].strict).toBe(false);
    expect(calls[1].model).toBe(calls[0].model);   // same model, not the next one
  });

  it('moves on to the next model when the retry also fails', async () => {
    withGroq();
    const models: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model);
      return models.length <= 2
        ? jsonFail()
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"ok"}' } }] }), { status: 200 });
    }));

    const out = await chatDetailed([{ role: 'user', content: 'hi' }], { json: true, timeoutMs: 500 });
    expect(out.ok).toBe(true);
    expect(new Set(models).size).toBeGreaterThan(1);
  });

  it('does not retry when strict mode was never asked for', async () => {
    withGroq();
    const fetchMock = vi.fn(async () => jsonFail());
    vi.stubGlobal('fetch', fetchMock);
    const out = await chatDetailed([{ role: 'user', content: 'hi' }], { json: false, timeoutMs: 500 });
    expect(out.ok).toBe(false);
    // one attempt per model in the chain, never two for the same model
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('leaves reasoning models room to think', async () => {
    withGroq();
    let maxTokens = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      maxTokens = JSON.parse(String(init.body)).max_tokens;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }));
    await chatDetailed([{ role: 'user', content: 'hi' }], { timeoutMs: 500 });
    expect(maxTokens).toBeGreaterThanOrEqual(2048);
  });
});

describe('the shapes Google uses', () => {
  /** Google answers a bad key with 400, not 401, and buries why in the body. */
  const failWith = async (status: number, body: string) => {
    process.env.GEMINI_API_KEY = 'AIzaSyFake';
    respond(status, body);
    const out = await ask();
    if (out.ok) throw new Error('expected a failure');
    return out;
  };

  it('reads a 400 "API key not valid" as a rejected key, not a mystery', async () => {
    const out = await failWith(400, JSON.stringify({
      error: { code: 400, message: 'API key not valid. Please pass a valid API key.',
               status: 'INVALID_ARGUMENT' },
    }));
    expect(out.reason).toBe('unauthorized');
  });

  it('reads a quota message as a rate limit whatever the status', async () => {
    const out = await failWith(400, JSON.stringify({
      error: { message: 'Quota exceeded for quota metric generate_content_free_tier_requests' },
    }));
    expect(out.reason).toBe('rate_limited');
  });
});
