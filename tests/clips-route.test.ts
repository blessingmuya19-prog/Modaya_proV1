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
              'CLOUDFLARE_API_TOKEN', 'OLLAMA_BASE_URL', 'LLM_PROVIDER',
              'TWELVELABS_API_KEY', 'TWELVELABS_URL', 'TWELVELABS_BASE_URL'];
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

  /** A dense, evenly-spaced transcript so several grounded candidate windows
   *  exist for the model to score. */
  const longTranscriptSegments = (() => {
    const segs = [];
    let t = 0;
    const lines = [
      'The one trick nobody tells you about saving money is paying yourself first.',
      'Automate it the day you get paid and you will never miss the money.',
      'I used to wonder where my salary went by the end of every single month.',
      'This simple habit turned my finances around in less than a single year.',
      'Stop waiting for a raise before you start putting money aside for later.',
      'Even fifty dollars a month compounds into something remarkable over time.',
      'The banks profit from you not knowing how powerful this small step is.',
    ];
    for (let i = 0; t < 290; i++) {
      const start = t + (i % 4 === 0 ? 1.2 : 0.05);
      const end = start + 7;
      segs.push({ startS: start, endS: end, text: lines[i % lines.length] });
      t = end;
    }
    return segs;
  })();
  const longTranscript = {
    segments: longTranscriptSegments, language: 'en', model: 'whisper', madeAt: new Date().toISOString(),
  };

  it('scores grounded candidates for virality and keeps our timestamps', async () => {
    process.env.GROQ_API_KEY = 'gsk_clips_test';
    // The model only returns scores for candidate ids we sent (c0..cN). It
    // never returns a timestamp — we derive every bound from the transcript.
    const llmFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        scores: [
          { id: 'c0', virality: 98, title: 'The trick nobody tells you', reason: 'strong hook and clear payoff', hook: 'Pay yourself first', tags: ['money'] },
          { id: 'c999', virality: 100, title: 'hallucinated window', reason: 'fake', tags: [] },
        ],
      }) } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', llmFetch);

    const d = await askClips({ count: 3, energy, transcript: longTranscript });

    // The model's title for a real grounded candidate survives.
    const ai = d.clips.find((c: { title: string }) => c.title.includes('trick'));
    expect(ai).toBeTruthy();
    expect(ai.tags).toContain('money');
    // The candidate id we never sent can't invent a clip.
    expect(d.clips.find((c: { title: string }) => c.title === 'hallucinated window')).toBeFalsy();

    // Every timestamp is ours: in range, ordered, non-overlapping.
    const sorted = [...d.clips].sort((a: { startS: number }, b: { startS: number }) => a.startS - b.startS);
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      expect(c.endS).toBeLessThanOrEqual(300.001);
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.endS - c.startS).toBeGreaterThan(0);
      if (i > 0) expect(c.startS).toBeGreaterThanOrEqual(sorted[i - 1].endS - 0.5);
    }
    expect(d.engine.source).toBe('ai');
    expect(d.reply).toMatch(/clips/i);
  });

  it('blends virality with measured energy and honours "at the start"', async () => {
    process.env.GROQ_API_KEY = 'gsk_clips_start';
    vi.stubGlobal('fetch', vi.fn(async (url?: string) => {
      // Echo back a high score for whichever candidate appears first in the
      // prompt; for start-bias that must be an opening moment.
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          scores: [{ id: 'c0', virality: 95, title: 'Opening hook', reason: 'grabs fast', tags: ['hook'] }],
        }) } }],
      }), { status: 200 });
    }));

    const d = await askClips({ message: 'find 4 clips at the beginning', energy, transcript: longTranscript });
    expect(d.clips.length).toBeGreaterThan(0);
    for (const c of d.clips) expect(c.startS).toBeLessThan(300 * 0.7);
  });

  it('falls back to measurement when the model returns nothing usable', async () => {
    process.env.GROQ_API_KEY = 'gsk_clips_empty';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"scores":"not an array"}' } }],
    }), { status: 200 })));

    const d = await askClips({ count: 2, energy, transcript: longTranscript });
    expect(d.clips.length).toBeGreaterThan(0);
    expect(d.engine.source).toBe('measurement');
  });

  it('boosts clips with TwelveLabs Pegasus when a key and URL are set', async () => {
    process.env.GROQ_API_KEY = 'gsk_clips_twelve';
    process.env.TWELVELABS_API_KEY = 'tl_test_key';
    vi.stubGlobal('fetch', vi.fn(async (url?: string) => {
      const u = String(url ?? '');
      if (u.includes('twelvelabs.io')) {
        return new Response(JSON.stringify({
          segments: [
            { start: 120, end: 160, fields: { reason: 'big on-camera reaction', virality: 'high' } },
          ],
        }), { status: 200 });
      }
      // Groq LLM: score nothing special, let measurement + Pegasus decide.
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ scores: [] }) } }],
      }), { status: 200 });
    }));

    const d = await askClips({
      count: 3, energy, transcript: longTranscript, videoUrl: 'https://example.com/v.mp4',
    });
    expect(d.engine.twelvelabs).toBe(true);
    // A Pegasus moment reached the list (boosted host clip or added moment).
    const peg = d.clips.find((c: { reason: string }) => /pegasus|twelvelabs/i.test(c.reason));
    expect(peg).toBeTruthy();
    delete process.env.TWELVELABS_API_KEY;
  });

  it('ignores TwelveLabs silently when no video URL is available', async () => {
    process.env.TWELVELABS_API_KEY = 'tl_test_key';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ scores: [] }) } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const d = await askClips({ count: 2, energy, transcript: longTranscript }); // no videoUrl
    expect(d.clips.length).toBeGreaterThan(0);
    // No call should have gone to TwelveLabs (no public URL for the blob).
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('twelvelabs.io'))).toBe(false);
    delete process.env.TWELVELABS_API_KEY;
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
