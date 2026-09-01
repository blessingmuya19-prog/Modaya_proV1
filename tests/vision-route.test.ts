/**
 * The route's half of vision: what it does with measurements, and what it
 * says when it has not seen anything.
 *
 * No provider key is set in these tests, so this is the deterministic path —
 * the one that has to be honest without a model to hide behind.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const project = {
  id: 'p1', userId: 'u1', durationS: 100,
  clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
  aiHistory: [],
};

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/db', () => ({ db: { projects: { findById: () => project, update: () => {} } } }));

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

/** A scan with the action, and a cut, in known places. */
const scan = {
  durationS: 100,
  cuts: [40],
  samples: Array.from({ length: 100 }, (_, i) => ({
    tS: i,
    brightness: i < 3 ? 0.01 : 0.5,
    motion: i >= 60 && i < 80 ? 0.45 : 0.005,
  })),
};

describe('being asked what is in the video', () => {
  it('says it cannot see, then reports what was measured', async () => {
    const out = await ask({ message: 'what do you see in this video?', visual: scan });
    const said = out.aiMessage.text;

    expect(said).toMatch(/cannot see/i);
    expect(said).toMatch(/1 shot change, at 40\.0s/);
    expect(said).toMatch(/most movement around 6[0-9]/);
    expect(said).toMatch(/black or near-black/);
  });

  it('does not invent anything when nothing has been measured', async () => {
    const out = await ask({ message: 'what do you see?' });
    expect(out.aiMessage.text).toMatch(/have not measured this video yet/i);
    expect(out.aiMessage.text).not.toMatch(/shot change|movement around/);
  });

  it('adds the words when a transcript came along too', async () => {
    const out = await ask({
      message: 'describe the video',
      visual: scan,
      transcript: { segments: [{ startS: 1, endS: 3, text: 'he shoots from the logo' }] },
    });
    expect(out.aiMessage.text).toMatch(/he shoots from the logo/);
  });

  it('changes nothing on the timeline just for being asked', async () => {
    const out = await ask({ message: 'what is happening in this footage?', visual: scan });
    expect(out.edit.newClips).toHaveLength(1);
    expect(out.edit.savedS).toBe(0);
  });
});

describe('picking highlights with the picture as well as the sound', () => {
  const flatEnergy = Array.from({ length: 100 }, () => 0.5);

  it('keeps the part that moves when the sound says nothing useful', async () => {
    const out = await ask({ message: 'find the best moments', energy: flatEnergy, visual: scan });
    const kept = out.edit.newClips as { startS: number; endS: number }[];
    const covered = kept.reduce((a, c) => a + (c.endS - c.startS), 0);

    expect(covered).toBeLessThan(100);

    /* The moving stretch is 60-80s. All twenty of those seconds have to
       survive, and they have to make up the bulk of what is left — the rest
       is filler chosen from an evenly loud, evenly still video. */
    const inAction = kept.filter(c => c.startS >= 55 && c.endS <= 85)
      .reduce((a, c) => a + (c.endS - c.startS), 0);
    expect(inAction, 'the part that actually moves was cut').toBeGreaterThanOrEqual(19);
    expect(inAction / covered).toBeGreaterThan(0.5);
  });

  it('says which measurements it used', async () => {
    const out = await ask({ message: 'find the best moments', energy: flatEnergy, visual: scan });
    expect(out.aiMessage.text).toMatch(/loudness and movement/i);
  });

  it('falls back to loudness alone when the picture was never measured', async () => {
    const energy = Array.from({ length: 100 }, (_, i) => (i >= 10 && i < 30 ? 0.9 : 0.1));
    const out = await ask({ message: 'find the best moments', energy });
    expect(out.aiMessage.text).toMatch(/by audio energy/i);
  });
});

describe('what the route accepts from the browser', () => {
  it('ignores anything that is not an image data URL', async () => {
    const out = await ask({
      message: 'what do you see?', visual: scan,
      frames: ['javascript:alert(1)', 'https://example.com/x.jpg', 42],
    });
    expect(out.aiMessage.text).toMatch(/cannot see/i);   // nothing usable was attached
  });

  it('survives a malformed scan instead of failing the request', async () => {
    const out = await ask({ message: 'what do you see?', visual: { samples: 'nonsense' } });
    expect(out.aiMessage.text).toMatch(/have not measured/i);
  });
});
