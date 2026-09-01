/**
 * The no-key fallback must never describe work it did not perform.
 * These tests hit the real route handler with no provider configured.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const project = {
  id: 'p1', userId: 'u1', durationS: 100,
  clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
  aiHistory: [],
};

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/db', () => ({
  db: { projects: { findById: () => project, update: () => {} } },
}));

const KEYS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
              'CLOUDFLARE_API_TOKEN', 'OLLAMA_BASE_URL', 'LLM_PROVIDER'];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => { delete process.env[k]; });
});
afterEach(() => KEYS.forEach(k => {
  if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
}));

async function ask(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/projects/[id]/ai/route');
  const req = new Request('http://test/api/projects/p1/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req as never, { params: Promise.resolve({ id: 'p1' }) });
  return res.json();
}

describe('no-key fallback', () => {
  it('reports itself as the rules engine, not as AI', async () => {
    const d = await ask({ message: 'cut the dead air', silences: [[10, 14]] });
    expect(d.engine).toMatchObject({ source: 'rules', provider: 'none' });
  });

  it('cuts exactly the silences it was given, and says so', async () => {
    const d = await ask({ message: 'cut the dead air', silences: [[10, 14], [40, 47]] });
    expect(d.edit.savedS).toBe(11);
    expect(d.aiMessage.text).toMatch(/2 silent gaps/);
    const video = d.edit.newClips.filter((c: { type: string }) => c.type === 'video');
    expect(video.map((c: { startS: number; endS: number }) => [c.startS, c.endS]))
      .toEqual([[0, 10], [14, 40], [47, 100]]);
  });

  it('admits it cannot cut silence when nothing was measured', async () => {
    const d = await ask({ message: 'cut the dead air' });
    expect(d.edit.savedS).toBe(0);
    expect(d.aiMessage.text).toMatch(/couldn't find any measurable silence/i);
    expect(d.edit.newClips).toHaveLength(1);        // timeline untouched
  });

  it('never claims a transcription accuracy figure', async () => {
    const d = await ask({ message: 'add captions' });
    expect(d.aiMessage.text).not.toMatch(/accuracy|%|transcrib(ed|ing)\b/i);
    expect(d.aiMessage.text).toMatch(/can't transcribe/i);
    expect(d.edit.newClips.some((c: { type: string }) => c.type === 'text')).toBe(true);
  });

  it('says outright that it cannot reframe or remove fillers', async () => {
    const vertical = await ask({ message: 'make it vertical for tiktok' });
    expect(vertical.aiMessage.text).toMatch(/can't reframe/i);
    expect(vertical.edit.savedS).toBe(0);

    const fillers = await ask({ message: 'remove the ums and filler words' });
    expect(fillers.aiMessage.text).toMatch(/needs a transcript/i);
    expect(fillers.edit.savedS).toBe(0);
  });

  it('picks highlights from real audio energy, and flags the limitation', async () => {
    const energy = Array.from({ length: 100 }, (_, i) => (i < 30 ? 0.9 : 0.05));
    const d = await ask({ message: 'find the best moments', energy });
    const kept = d.edit.newClips.filter((c: { type: string }) => c.type === 'video');
    expect(kept.length).toBeGreaterThan(0);
    // everything kept comes from the loud opening
    for (const c of kept) expect(c.startS).toBeLessThan(35);
    expect(d.aiMessage.text).toMatch(/loudness, not meaning/i);
  });

  it('explains its own limits when it does not understand', async () => {
    const d = await ask({ message: 'make it feel more cinematic and emotional' });
    expect(d.aiMessage.text).toMatch(/without an AI model/i);
    expect(d.edit.savedS).toBe(0);
  });
});

/**
 * A configured key that cannot be reached is a different situation from having
 * no key at all, and the chat reply must not confuse the two — telling someone
 * to "add a free API key" when they already added one is a dead end.
 */
describe('configured key, provider unreachable', () => {
  afterEach(() => vi.unstubAllGlobals());

  const unreachable = () => {
    process.env.GROQ_API_KEY = 'gsk_configured_but_offline';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('ENOTFOUND api.groq.com') });
    }));
  };

  it('says it could not reach the provider, and does not blame the key', async () => {
    unreachable();
    const d = await ask({ message: 'make this feel like a hype reel' });
    expect(d.aiMessage.text).toMatch(/could not reach groq/i);
    expect(d.aiMessage.text).toMatch(/not a problem with your key/i);
    expect(d.aiMessage.text).not.toMatch(/running without an AI model/i);
    expect(d.aiMessage.text).not.toMatch(/add a free API key/i);
  });

  it('still offers the work it can genuinely do', async () => {
    unreachable();
    const d = await ask({ message: 'make this feel like a hype reel' });
    expect(d.aiMessage.text).toMatch(/cut the dead air|highlights|captions/i);
  });

  it('reports the failure reason to the debug panel', async () => {
    unreachable();
    const d = await ask({ message: 'anything at all' });
    expect(d.engine).toMatchObject({ source: 'rules', provider: 'groq', failure: 'unreachable' });
  });

  it('a reachable provider that rejects the key says exactly that', async () => {
    process.env.GROQ_API_KEY = 'gsk_revoked';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid"}', { status: 401 })));
    const d = await ask({ message: 'make this feel like a hype reel' });
    expect(d.aiMessage.text).toMatch(/rejected that key/i);
    expect(d.engine.failure).toBe('unauthorized');
  });

  it('with no key at all, the original advice to add one is unchanged', async () => {
    const d = await ask({ message: 'make this feel like a hype reel' });
    expect(d.aiMessage.text).toMatch(/running without an AI model/i);
    expect(d.engine.failure).toBeUndefined();
  });
});

/**
 * The model has no eyes and no ears. Everything it knows about the footage
 * arrives in the prompt, so the measured loudness must actually be in there —
 * otherwise "the best 30 seconds" can only ever mean "the first 30 seconds".
 */
describe('what the model is told', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The fixture project is 100s. Quiet throughout, with a burst at 40-50s. */
  const energy = Array.from({ length: 1000 }, (_, i) =>
    (i / 10 >= 40 && i / 10 < 50 ? 0.9 : 0.05));

  const capturePrompt = async (message: string) => {
    process.env.GROQ_API_KEY = 'gsk_test_prompt_capture';
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"ok","operations":[{"op":"none"}]}' } }],
      }), { status: 200 });
    }));
    await ask({ message, silences: [], energy });
    return body;
  };

  it('sends the measured loudness curve', async () => {
    const body = await capturePrompt('find the best 30 seconds');
    expect(body).toMatch(/LOUDNESS/);
    expect(body).toMatch(/loudest continuous window/i);
    // the burst sits at 40-50s, so the 10s window must land on it
    expect(body).toMatch(/10s -> \[4\d\.\d, /);
    expect(body).toMatch(/loudness 0-9 across the whole video/);
  });

  it('tells the model not to default to the opening', async () => {
    const body = await capturePrompt('find the best 30 seconds');
    expect(body).toMatch(/[Nn]ever default to the opening/);
  });

  it('tells the model it cannot see the picture or read the file name as evidence', async () => {
    const body = await capturePrompt('what happens in this video');
    expect(body).toMatch(/cannot see the picture/i);
    expect(body).toMatch(/title is not evidence/i);
  });

  it('says plainly when no audio has been measured', async () => {
    process.env.GROQ_API_KEY = 'gsk_test_prompt_capture';
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"ok","operations":[{"op":"none"}]}' } }],
      }), { status: 200 });
    }));
    await ask({ message: 'best bit', silences: [], energy: [] });
    expect(body).toMatch(/no audio measured/i);
  });
});

describe('audio measurement state reaches the model', () => {
  afterEach(() => vi.unstubAllGlobals());

  const capture = async (audio: string) => {
    process.env.GROQ_API_KEY = 'gsk_state_capture';
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"ok","operations":[{"op":"none"}]}' } }],
      }), { status: 200 });
    }));
    await ask({ message: 'strongest 20 seconds', silences: [], energy: [], audio });
    return body;
  };

  it('tells the model the decode is still running', async () => {
    expect(await capture('pending')).toMatch(/still decoding/i);
  });

  it('tells the model the decode failed', async () => {
    expect(await capture('failed')).toMatch(/could not be decoded/i);
  });
});
