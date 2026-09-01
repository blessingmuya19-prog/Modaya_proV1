/**
 * The clipping engine wired through the real route handlers. With no key the
 * chat route must surface measured clip suggestions (and leave the timeline
 * untouched); the dedicated clips route returns the same shape and marks its
 * source honestly. A model that "returns clips" is sanitised, clamped and
 * snapped here, so a hallucinated timecode never reaches the UI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const project = {
  id: 'p1', userId: 'u1', durationS: 300,
  clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 300, type: 'video' }],
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
afterEach(() => {
  KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  vi.unstubAllGlobals();
});

async function askAi(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/projects/[id]/ai/route');
  const req = new Request('http://test/api/projects/p1/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req as never, { params: Promise.resolve({ id: 'p1' }) });
  return res.json();
}

async function askClips(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/projects/[id]/clips/route');
  const req = new Request('http://test/api/projects/p1/clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req as never, { params: Promise.resolve({ id: 'p1' }) });
  return res.json();
}

/** 300s of audio, quiet except for an energetic burst at 120-170s. */
const energy = Array.from({ length: 3000 }, (_, i) =>
  (i / 10 >= 120 && i / 10 < 170 ? 0.9 : 0.05));

describe('clipping through the chat route, no key', () => {
  it('returns measured clip suggestions without touching the timeline', async () => {
    const d = await askAi({ message: 'find me 3 short clips for tiktok', energy });
    expect(Array.isArray(d.edit.clips)).toBe(true);
    expect(d.edit.clips.length).toBeGreaterThan(0);
    for (const c of d.edit.clips) {
      expect(c.endS).toBeLessThanOrEqual(300);
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.title).toBeTruthy();
      expect(c.source).toBe('measurement');
    }
    // Suggestions never edit the timeline until the user cuts to one.
    expect(d.edit.newClips).toHaveLength(1);
    expect(d.aiMessage.text).toMatch(/clips/i);
  });

  it('ranks the energetic burst above the opening', async () => {
    const d = await askAi({ message: 'give me 5 viral shorts', energy });
    const top = [...d.edit.clips].sort((a: { score: number }, b: { score: number }) => b.score - a.score)[0];
    expect(top.startS).toBeGreaterThan(60);
  });

  it('is honest that measurement ranks excitement, not meaning', async () => {
    const d = await askAi({ message: 'find clips', energy });
    expect(d.aiMessage.text).toMatch(/loudness|energy|measur/i);
    expect(d.engine.source).toBe('rules');
  });

  it('handles a bare "30 seconds pls" as a clip length, with no transcript needed', async () => {
    // This used to fall through to a "I need a transcript" refusal / No change.
    const d = await askAi({ message: '30 seconds pls', energy });
    expect(Array.isArray(d.edit.clips)).toBe(true);
    expect(d.edit.clips.length).toBeGreaterThan(0);
    for (const c of d.edit.clips) {
      const len = c.endS - c.startS;
      expect(len).toBeGreaterThan(14);
      expect(len).toBeLessThan(60);
    }
    // It must not demand a transcript — measurement clips never need one.
    expect(d.aiMessage.text).not.toMatch(/need a transcript/i);
    expect(d.edit.summary).not.toBe('No change');
  });

  it('"find clips at the beginning" opens at the start of the video', async () => {
    const d = await askAi({ message: 'find 4 clips at the beginning', energy });
    const first = [...d.edit.clips].sort((a: { startS: number }, b: { startS: number }) => a.startS - b.startS)[0];
    expect(first.startS).toBeLessThan(5);
    expect(d.aiMessage.text).toMatch(/beginning|start/i);
  });

  it('never returns overlapping clips on a long flat video', async () => {
    // The fixture project is 300s; feed flat energy for all of it.
    const flat = Array.from({ length: 300 * 2 }, () => 0.5);
    const d = await askAi({ message: 'find me 5 clips for tiktok', energy: flat });
    const sorted = [...d.edit.clips].sort((a: { startS: number }, b: { startS: number }) => a.startS - b.startS);
    expect(sorted.length).toBeGreaterThan(1);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startS).toBeGreaterThanOrEqual(sorted[i - 1].endS - 0.6);
    }
  });
});

describe('dedicated clips route', () => {
  it('returns clips and an honest engine block with no key', async () => {
    const d = await askClips({ count: 3, energy });
    expect(d.clips.length).toBeGreaterThan(0);
    expect(d.engine.source).toBe('measurement');
    expect(d.engine.provider).toBe('none');
    expect(d.clips[0]).toHaveProperty('title');
    expect(d.clips[0]).toHaveProperty('score');
  });

  it('uses the model when a key is present, and sanitises its timestamps', async () => {
    process.env.GROQ_API_KEY = 'gsk_clips_test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        clips: [
          // one good clip, one past the end of the video, one backwards
          { startS: 120, endS: 160, title: 'The trick nobody tells you', hook: 'Here is the trick', reason: 'strong tip', tags: ['tips'], score: 92 },
          { startS: 290, endS: 99999, title: 'Runs off the end', score: 80 },
          { startS: 200, endS: 100, title: 'backwards', score: 70 },
        ],
      }) } }],
    }), { status: 200 })));

    const d = await askClips({
      count: 3, energy,
      transcript: {
        segments: [{ startS: 118, endS: 162, text: 'Here is the trick that changed everything for me.' }],
        language: 'en', model: 'whisper', madeAt: new Date().toISOString(),
      },
    });

    // The AI clip survives with its real title.
    const ai = d.clips.find((c: { title: string }) => c.title.includes('trick'));
    expect(ai).toBeTruthy();
    expect(ai.tags).toContain('tips');

    // Nothing escapes the video bounds.
    for (const c of d.clips) {
      expect(c.endS).toBeLessThanOrEqual(300);
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.endS - c.startS).toBeGreaterThan(0);
    }
    // The backwards clip is gone.
    expect(d.clips.find((c: { title: string }) => c.title === 'backwards')).toBeFalsy();
    expect(d.engine.source).toBe('ai');
  });

  it('falls back to measurement when the model returns nothing usable', async () => {
    process.env.GROQ_API_KEY = 'gsk_clips_empty';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"clips":"not an array"}' } }],
    }), { status: 200 })));

    const d = await askClips({ count: 2, energy });
    expect(d.clips.length).toBeGreaterThan(0);
    expect(d.engine.source).toBe('measurement');
  });

  it('the chat route returns model-chosen clips when a key + transcript reach it', async () => {
    process.env.GROQ_API_KEY = 'gsk_chat_clips';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        reply: 'Here are the best moments from what was said.',
        operations: [],
        clips: [
          { startS: 108, endS: 150, title: 'The habit that made me rich', hook: 'One habit changed everything', reason: 'Strong money tip', tags: ['money'], score: 96 },
        ],
      }) } }],
    }), { status: 200 })));

    const d = await askAi({
      message: 'find me clips',
      energy,
      transcript: {
        segments: [
          { startS: 108, endS: 125, text: 'One habit changed everything about how I save money.' },
        ],
        language: 'en', model: 'whisper', madeAt: new Date().toISOString(),
      },
    });

    expect(d.edit.clips.length).toBeGreaterThan(0);
    const titled = d.edit.clips.find((c: { title: string }) => c.title.includes('habit'));
    expect(titled).toBeTruthy();
    expect(titled.tags).toContain('money');
    // The model clip is in-range and non-overlapping.
    for (const c of d.edit.clips) {
      expect(c.endS).toBeLessThanOrEqual(300);
      expect(c.endS - c.startS).toBeGreaterThan(0);
    }
    vi.unstubAllGlobals();
  });
});
