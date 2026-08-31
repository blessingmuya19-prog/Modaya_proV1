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
