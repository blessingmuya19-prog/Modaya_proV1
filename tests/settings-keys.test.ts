/**
 * Adding a second provider key.
 *
 * The trap this guards: someone with a working Groq setup adds a Google key
 * for vision and finds their whole editor quietly moved to a different model.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));

const KEYS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY',
              'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL',
              'LLM_PROVIDER', 'LLM_MODEL', 'LLM_VISION_MODEL'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => { delete process.env[k]; });
  // Every provider answers "OK" to the verification ping.
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    choices:    [{ message: { content: 'OK' } }],
    candidates: [{ content: { parts: [{ text: 'OK' }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  KEYS.forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  });
});

async function save(provider: string, key: string, force = false) {
  const { POST } = await import('@/app/api/settings/ai/route');
  const req = new Request('http://test/api/settings/ai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, key, force }),
  });
  const res = await POST(req as never);
  return { status: res.status, body: await res.json() };
}

async function read() {
  const { GET } = await import('@/app/api/settings/ai/route');
  return (await GET()).json();
}

const GOOGLE = 'AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI';
const GROQ   = `gsk_${'x'.repeat(52)}`;

describe('adding a Google key on top of a working Groq key', () => {
  it('leaves Groq answering', async () => {
    process.env.GROQ_API_KEY = GROQ;
    const { body } = await save('gemini', GOOGLE);

    expect(body.provider, 'the editor was switched to the new provider').toBe('groq');
    expect(process.env.GEMINI_API_KEY).toBe(GOOGLE);
  });

  it('says what the new key changed', async () => {
    process.env.GROQ_API_KEY = GROQ;
    const { body } = await save('gemini', GOOGLE);
    expect(body.note).toMatch(/groq still answers/i);
  });

  it('makes the first key the one in charge when there was nothing before', async () => {
    const { body } = await save('gemini', GOOGLE);
    expect(body.provider).toBe('gemini');
    expect(body.note).toMatch(/can look at frames/i);
  });
});

describe('verifying the key that was actually offered', () => {
  it('tests Google, not the Groq key that already worked', async () => {
    process.env.GROQ_API_KEY = GROQ;

    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'OK' } }],
        candidates: [{ content: { parts: [{ text: 'OK' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await save('gemini', GOOGLE);
    expect(urls.join(' '), 'the ping went to the wrong provider').toMatch(/googleapis\.com/);
    expect(urls.join(' ')).not.toMatch(/groq/);
  });

  it('rejects a bad Google key even though Groq is fine', async () => {
    process.env.GROQ_API_KEY = GROQ;
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('googleapis')
        ? new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));

    const { status, body } = await save('gemini', GOOGLE);
    expect(status, 'a rejected key was accepted').toBe(400);
    expect(body.error).toMatch(/rejected that key/i);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it('puts the old provider back in charge after checking the new one', async () => {
    process.env.GROQ_API_KEY = GROQ;
    process.env.LLM_PROVIDER = 'groq';
    await save('gemini', GOOGLE);
    expect(process.env.LLM_PROVIDER).toBe('groq');
  });

  it('leaves no forced provider behind when there was none', async () => {
    process.env.GROQ_API_KEY = GROQ;
    await save('gemini', GOOGLE);
    expect(process.env.LLM_PROVIDER).toBeUndefined();
  });
});

describe('what the settings screen is told about sight', () => {
  it('names the model that can see and whose key it belongs to', async () => {
    process.env.GROQ_API_KEY = GROQ;
    const out = await read();
    expect(out.vision).toMatchObject({ provider: 'groq', model: 'qwen/qwen3.6-27b' });
  });

  it('routes sight to Google when the answering provider is blind', async () => {
    process.env.CLOUDFLARE_API_TOKEN  = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.GEMINI_API_KEY        = GOOGLE;
    process.env.LLM_PROVIDER          = 'cloudflare';

    const out = await read();
    expect(out.provider).toBe('cloudflare');
    expect(out.vision.provider).toBe('gemini');
  });

  it('says nothing can see rather than implying it can', async () => {
    process.env.CLOUDFLARE_API_TOKEN  = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    const out = await read();
    expect(out.vision).toBeNull();
  });
});

describe('a key pasted into the wrong provider', () => {
  it('spots a Groq key offered as a Google one', async () => {
    const { status, body } = await save('gemini', GROQ);
    expect(status).toBe(400);
    expect(body.error).toMatch(/Groq key/i);
    expect(body.error).toMatch(/AIza/);
    expect(process.env.GEMINI_API_KEY, 'it was saved anyway').toBeUndefined();
  });

  it('spots something that is no kind of Google key', async () => {
    const { status, body } = await save('gemini', 'ya29.a0AfH6SMBx-not-an-api-key');
    expect(status).toBe(400);
    expect(body.error).toMatch(/aistudio\.google\.com/);
    expect(body.canSaveAnyway).toBe(true);
  });

  it('accepts a real-shaped Google key without complaint', async () => {
    const { status } = await save('gemini', GOOGLE);
    expect(status).toBe(200);
  });

  it('still lets a stubborn user save an odd-looking key', async () => {
    const { status, body } = await save('gemini', 'AIza-but-short', true);
    expect(status).toBe(200);
    expect(body.configured).toBe(true);
  });

  it('never echoes the key back', async () => {
    process.env.GROQ_API_KEY = GROQ;
    const { body } = await save('gemini', GOOGLE);
    expect(JSON.stringify(body)).not.toContain(GOOGLE);
    expect(JSON.stringify(body)).not.toContain(GROQ);
  });
});
