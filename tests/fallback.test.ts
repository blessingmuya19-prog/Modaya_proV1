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
    // No invented accuracy, and no claim to have produced words it does not have.
    expect(d.aiMessage.text).not.toMatch(/accuracy|\d+\s*%/i);
    expect(d.aiMessage.text).not.toMatch(/\btranscribed the\b|\bI transcribed\b/i);
    expect(d.aiMessage.text).toMatch(/hasn't been transcribed yet/i);
    expect(d.aiMessage.text).toMatch(/empty caption slots/i);
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

/**
 * With a transcript, two long-standing refusals become real work: captions get
 * the actual words, and filler removal becomes possible. Neither may claim more
 * than the transcript supports.
 */
describe('with a transcript', () => {
  const segments = [
    { startS: 0,   endS: 3,   text: 'Right, today we are working on push ups' },
    { startS: 3,   endS: 3.4, text: 'um, uh' },
    { startS: 4,   endS: 8,   text: 'keep your elbows tucked in close' },
    { startS: 9,   endS: 9.3, text: 'you know, like' },
    { startS: 10,  endS: 14,  text: 'and breathe out on the way up' },
  ];

  beforeEach(() => {
    (project as unknown as { transcript: unknown }).transcript = {
      segments, language: 'en', model: 'whisper-large-v3-turbo', madeAt: '2026-09-01T00:00:00Z',
    };
  });
  afterEach(() => { delete (project as unknown as { transcript?: unknown }).transcript; });

  it('writes captions containing the real words', async () => {
    const d = await ask({ message: 'add captions' });
    const captions = d.edit.newClips.filter((c: { type: string }) => c.type === 'text');
    expect(captions.length).toBe(segments.length);
    expect(captions[0].label).toMatch(/push ups/);
    expect(captions[2].label).toMatch(/elbows tucked/);
    expect(d.aiMessage.text).toMatch(/from the transcript/i);
    expect(d.aiMessage.text).not.toMatch(/empty|blank|can't transcribe/i);
  });

  it('times each caption to when it was said', async () => {
    const d = await ask({ message: 'add captions' });
    const first = d.edit.newClips.find((c: { type: string }) => c.type === 'text');
    expect(first.startS).toBe(0);
    expect(first.endS).toBe(3);
  });

  it('removes filler segments and nothing else', async () => {
    const d = await ask({ message: 'remove filler words' });
    expect(d.edit.savedS).toBe(1);                       // 0.4s + 0.3s, rounded
    const video = d.edit.newClips
      .filter((c: { type: string }) => c.type === 'video')
      .map((c: { startS: number; endS: number }) => [c.startS, c.endS]);
    expect(video).toEqual([[0, 3], [3.4, 9], [9.3, 100]]);
    expect(d.aiMessage.text).toMatch(/filler/i);
  });

  it('sends the transcript to the model with timestamps', async () => {
    process.env.GROQ_API_KEY = 'gsk_transcript_capture';
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"ok","operations":[{"op":"none"}]}' } }],
      }), { status: 200 });
    }));
    await ask({ message: 'what do they say about elbows' });
    expect(body).toMatch(/TRANSCRIPT/);
    expect(body).toMatch(/elbows tucked in close/);
    expect(body).toMatch(/\[4\.0-8\.0\]/);
    vi.unstubAllGlobals();
  });
});

describe('without a transcript', () => {
  it('still refuses filler removal, and says why', async () => {
    const d = await ask({ message: 'remove filler words' });
    expect(d.aiMessage.text).toMatch(/hasn't been transcribed yet/i);
    expect(d.edit.savedS).toBe(0);
  });

  it('captions are empty slots, and admit it', async () => {
    const d = await ask({ message: 'add captions' });
    expect(d.aiMessage.text).toMatch(/empty caption slots/i);
    expect(d.aiMessage.text).toMatch(/hasn't been transcribed/i);
  });
});

/**
 * On a serverless host the request that stores a transcript and the request
 * that uses it routinely land on different instances. The browser holds the
 * only reliable copy, so a transcript sent with the request must work even
 * when the server has never seen one.
 */
describe('transcript supplied by the browser', () => {
  const clientTranscript = {
    segments: [
      { startS: 0,  endS: 4,  text: 'We are delivering the car today' },
      { startS: 4,  endS: 4.5, text: 'um' },
      { startS: 5,  endS: 9,  text: 'and the paperwork is in the glovebox' },
    ],
    language: 'en', model: 'whisper-large-v3-turbo', madeAt: '2026-09-01T00:00:00Z',
  };

  it('writes real captions when the server has no copy', async () => {
    const d = await ask({ message: 'add captions', transcript: clientTranscript });
    const captions = d.edit.newClips.filter((c: { type: string }) => c.type === 'text');
    expect(captions).toHaveLength(3);
    expect(captions[0].label).toMatch(/delivering the car/);
    expect(d.aiMessage.text).toMatch(/from the transcript/i);
  });

  it('removes filler using the browser copy', async () => {
    const d = await ask({ message: 'remove filler words', transcript: clientTranscript });
    const video = d.edit.newClips
      .filter((c: { type: string }) => c.type === 'video')
      .map((c: { startS: number; endS: number }) => [c.startS, c.endS]);
    expect(video).toEqual([[0, 4], [4.5, 100]]);
  });

  it('ignores a malformed transcript rather than trusting it', async () => {
    const d = await ask({ message: 'add captions', transcript: { segments: 'nonsense' } });
    expect(d.aiMessage.text).toMatch(/hasn't been transcribed/i);
  });

  it('clamps segments that run past the end of the video', async () => {
    const d = await ask({
      message: 'add captions',
      transcript: { ...clientTranscript, segments: [{ startS: 95, endS: 500, text: 'over the end' }] },
    });
    const cap = d.edit.newClips.find((c: { type: string }) => c.type === 'text');
    expect(cap.endS).toBeLessThanOrEqual(100);
  });
});
