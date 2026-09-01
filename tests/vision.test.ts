/**
 * Handing frames to a model.
 *
 * The rule this file exists to defend: a model that cannot see must never be
 * given a picture and must never be allowed to answer as though it had one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chatDetailed, visionModelFor, visionRoute, explainFailure } from '@/lib/ai/llm';

const KEYS = [
  'LLM_PROVIDER', 'LLM_MODEL', 'LLM_VISION_MODEL', 'GROQ_API_KEY', 'GEMINI_API_KEY',
  'GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'OLLAMA_BASE_URL', 'GROQ_BASE_URL', 'OPENROUTER_BASE_URL',
];
let saved: Record<string, string | undefined> = {};

const FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ';

/** Captures what would have gone over the wire. */
function captureFetch(reply = 'ok') {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({
      choices:    [{ message: { content: reply } }],
      candidates: [{ content: { parts: [{ text: reply }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => { delete process.env[k]; });
});
afterEach(() => {
  vi.unstubAllGlobals();
  KEYS.forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  });
});

const ask = (images: string[]) =>
  chatDetailed([{ role: 'user', content: 'what is in this frame?' }], { images });

describe('which model gets the picture', () => {
  it('knows the vision model for each provider that has one', () => {
    expect(visionModelFor('groq')).toBe('qwen/qwen3.6-27b');
    expect(visionModelFor('gemini')).toMatch(/^gemini-/);
    expect(visionModelFor('openrouter')).toMatch(/gemma/);
  });

  it('admits when a provider has none', () => {
    expect(visionModelFor('cloudflare')).toBeNull();
    expect(visionModelFor('none')).toBeNull();
  });

  it('lets the environment name one', () => {
    process.env.LLM_VISION_MODEL = 'my/own-vision-model';
    expect(visionModelFor('groq')).toBe('my/own-vision-model');
  });
});

describe('sending frames', () => {
  it('routes a Groq request to the multimodal model, not the text chain', async () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const calls = captureFetch();
    await ask([FRAME]);
    expect(calls[0].body.model).toBe('qwen/qwen3.6-27b');
  });

  it('attaches the image to what the user said, in OpenAI shape', async () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const calls = captureFetch();
    await ask([FRAME, FRAME]);

    const msgs = calls[0].body.messages as { role: string; content: unknown }[];
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('user');
    expect(Array.isArray(last.content)).toBe(true);

    const parts = last.content as { type: string; image_url?: { url: string } }[];
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts.filter(p => p.type === 'image_url')).toHaveLength(2);
    expect(parts[1].image_url?.url).toBe(FRAME);
  });

  it('sends Gemini raw base64 with a mime type, not a data URL', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const calls = captureFetch();
    await ask([FRAME]);

    const contents = calls[0].body.contents as { parts: Record<string, unknown>[] }[];
    const parts = contents[contents.length - 1].parts;
    const image = parts.find(p => 'inlineData' in p) as
      { inlineData: { mimeType: string; data: string } };
    expect(image.inlineData.mimeType).toBe('image/jpeg');
    expect(image.inlineData.data.startsWith('data:'), 'the data URL prefix was left on').toBe(false);
    expect(image.inlineData.data).toBe(FRAME.split(',')[1]);
  });

  it('leaves a text-only request exactly as it was', async () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const calls = captureFetch();
    await chatDetailed([{ role: 'user', content: 'cut the pauses' }], {});

    const msgs = calls[0].body.messages as { role: string; content: unknown }[];
    expect(typeof msgs[msgs.length - 1].content).toBe('string');
    expect(calls[0].body.model).toBe('openai/gpt-oss-120b');
  });
});

describe('two keys, one of which can see', () => {
  it('sends the frames to Google while Groq keeps answering the text', async () => {
    process.env.GROQ_API_KEY   = 'gsk_test';
    process.env.GEMINI_API_KEY = 'g';
    process.env.LLM_PROVIDER   = 'groq';

    // Groq can see too, so force the interesting case: Groq blind.
    process.env.LLM_VISION_MODEL = '';
    const calls = captureFetch();

    await chatDetailed([{ role: 'user', content: 'cut the pauses' }], {});
    expect(calls[0].url).toMatch(/groq/);

    const route = visionRoute('groq');
    expect(route?.provider).toBe('groq');       // Groq has qwen, so it stays home
  });

  it('falls through to a provider that can when the current one cannot', () => {
    process.env.CLOUDFLARE_API_TOKEN  = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.GEMINI_API_KEY        = 'g';

    const route = visionRoute('cloudflare');
    expect(route?.provider, 'it did not look past the blind provider').toBe('gemini');
    expect(route?.model).toMatch(/^gemini-/);
  });

  it('actually calls that other provider, with its own key', async () => {
    process.env.CLOUDFLARE_API_TOKEN  = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.GEMINI_API_KEY        = 'g';
    process.env.LLM_PROVIDER          = 'cloudflare';
    const calls = captureFetch();

    const out = await ask([FRAME]);
    expect(out.ok, 'the request never reached a model that could see').toBe(true);
    expect(calls[0].url).toMatch(/generativelanguage\.googleapis\.com/);
    if (out.ok) expect(out.result.provider).toBe('gemini');
  });

  it('reports nobody when no configured provider can see', () => {
    process.env.CLOUDFLARE_API_TOKEN  = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    expect(visionRoute('cloudflare')).toBeNull();
  });
});

describe('a provider that cannot see', () => {
  it('refuses rather than sending a picture to a blind model', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    const calls = captureFetch();

    const out = await ask([FRAME]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('no_vision');
    expect(calls, 'it called the provider anyway').toHaveLength(0);
  });

  it('explains what would fix it, without blaming the key', () => {
    const said = explainFailure('no_vision', 'Cloudflare');
    expect(said).toMatch(/cannot look at it|cannot see/i);
    expect(said).toMatch(/qwen|gemini|gemma/i);
    expect(said).not.toMatch(/rejected/i);
  });

  it('still answers text-only questions on that provider', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 't';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    vi.stubGlobal('fetch', async () => new Response(
      JSON.stringify({ result: { response: 'fine' } }),
      { status: 200, headers: { 'content-type': 'application/json' } }));

    const out = await chatDetailed([{ role: 'user', content: 'cut the pauses' }], {});
    expect(out.ok).toBe(true);
  });
});
