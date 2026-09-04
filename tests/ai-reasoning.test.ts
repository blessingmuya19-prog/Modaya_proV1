/**
 * The AI's reasoning depth: it must understand the request, break compound
 * asks into ordered steps, and explain the plan before/with the edit — with a
 * model (LLM plan + reason) and without one (deterministic step reasoning).
 * A plan that would delete the entire video is refused, not delivered.
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await POST(req as never, { params: Promise.resolve({ id: 'p1' }) })).json();
}

/** 100s, quiet except for a burst at 20–40. */
const energy = Array.from({ length: 1000 }, (_, i) =>
  (i / 10 >= 20 && i / 10 < 40 ? 0.9 : 0.05));

const transcript = {
  segments: [
    { startS: 5, endS: 9, text: 'this is the opening line' },
    { startS: 12, endS: 16, text: 'and here the story begins' },
    { startS: 50, endS: 55, text: 'the payoff lands right here' },
  ],
  language: 'en', model: 'whisper', madeAt: new Date().toISOString(),
};

describe('deterministic reasoning: compound requests', () => {
  it('runs "cut the pauses and add captions" as two ordered steps', async () => {
    const d = await ask({
      message: 'cut the dead air and add captions',
      durationS: 100,
      clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
      silences: [[8, 12], [44, 49]],
      energy,
      transcript,
    });
    expect(d.edit.savedS).toBe(9);                       // both gaps removed
    const caps = d.edit.newClips.filter((c: { type: string }) => c.type === 'subtitle');
    expect(caps.length).toBeGreaterThan(0);              // captions were added
    expect(caps.map((c: { label: string }) => c.label)).toContain('this is the opening line');
    expect(d.edit.reason).toMatch(/Step 1/);
    expect(d.edit.reason).toMatch(/Step 2/);
    /* The reply narrates both steps, never one alone. */
    expect(d.aiMessage.text).toMatch(/gaps/i);
  });

  it('does not decompose a single-intent request', async () => {
    const d = await ask({
      message: 'cut the dead air',
      durationS: 100,
      clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
      silences: [[10, 14]],
    });
    expect(d.edit.reason).toBeUndefined();               // one step, no narration
    expect(d.edit.savedS).toBe(4);
  });

  it('captions are added before they are restyled', async () => {
    const d = await ask({
      message: 'add captions and make them bold',
      durationS: 100,
      clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
      transcript,
    });
    const caps = d.edit.newClips.filter((c: { type: string }) => c.type === 'subtitle');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps[0].textStyle?.bold).toBe(true);          // restyle found them
    expect(d.edit.reason).toMatch(/Step 1:.*caption|Step 2/i);
  });
});

describe('LLM reasoning', () => {
  it('returns the model reason and applies multi-op plans in order', async () => {
    process.env.GROQ_API_KEY = 'gsk_reasoning_ok';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        reply: 'Kept the payoff, then captioned it and warmed it up.',
        reason: 'The reference is warm and punchy, so first I keep only the energetic payoff, then caption the words, then match the warm grade.',
        operations: [
          { op: 'keep_ranges', ranges: [[45, 60]] },
          { op: 'add_captions', position: 'lower', everyS: 3 },
          { op: 'grade', brightness: 1.05, contrast: 1.1, saturation: 1.15 },
        ],
      }) } }],
    }), { status: 200 })));

    const d = await ask({
      message: 'like the reference but shorter, with bold captions',
      durationS: 100,
      clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
      energy,
      transcript,
      style: 'warm grade, saturation +45%, bold captions along the bottom',
    });
    expect(d.engine.source).toBe('llm');
    expect(d.edit.reason).toMatch(/warm/i);
    /* keep_ranges ran first: only 45–60 survives. */
    const video = d.edit.newClips.filter((c: { type: string }) => c.type === 'video');
    expect(video).toHaveLength(1);
    expect(video[0]).toMatchObject({ trackId: 'video', startS: 45, endS: 60, type: 'video' });
    /* captions then landed on that window; the grade was applied (look op). */
    expect(d.edit.newClips.some((c: { type: string }) => c.type === 'subtitle')).toBe(true);
    expect(d.edit.applied?.some((o: { op: string }) => o.op === 'grade')).toBe(true);
  });

  it('refuses a plan that would delete the entire video, and says why', async () => {
    process.env.GROQ_API_KEY = 'gsk_reasoning_delete';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        reply: 'Removing everything.',
        reason: 'The user asked for it all gone.',
        operations: [{ op: 'remove_ranges', ranges: [[0, 100]] }],
      }) } }],
    }), { status: 200 })));

    const d = await ask({
      message: 'delete everything',
      durationS: 100,
      clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
    });
    expect(d.edit.summary).toBe('no change — whole video protected');
    expect(d.edit.newClips).toHaveLength(1);             // timeline untouched
    expect(d.edit.reason).toMatch(/safety check/i);
    expect(d.aiMessage.text).toMatch(/won't remove the entire video/i);
  });

  it('keeps reasoning honest when the model only asked a question', async () => {
    process.env.GROQ_API_KEY = 'gsk_reasoning_ask';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        reply: 'Which part should I keep — the opening or the ending?',
        reason: 'The request is ambiguous; no edit is safe until you choose the window.',
        operations: [{ op: 'none' }],
      }) } }],
    }), { status: 200 })));

    const d = await ask({
      message: 'make it shorter',
      durationS: 100,
      clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
    });
    expect(d.edit.newClips).toHaveLength(1);             // nothing changed yet
    expect(d.edit.summary).toBe('No change');
    expect(d.aiMessage.text).toMatch(/\?/);
    expect(d.edit.reason).toMatch(/ambiguous/i);
  });
});
