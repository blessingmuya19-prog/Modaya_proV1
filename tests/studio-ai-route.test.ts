/**
 * /api/projects/:id/ai must be able to edit the timeline the Studio sends
 * from the browser. Studio keeps its clips in IndexedDB, so the server copy
 * is empty while the browser owns the real timeline — the route has to trust
 * the body, or the Studio would run the Pro Editor AI against nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const project = {
  id: 'p1', userId: 'u1', durationS: 100,
  clips: [],              // server copy knows nothing; Studio sent its own
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

describe('studio sends its timeline to the pro AI route', () => {
  it('cuts the sent clips, not the empty server timeline', async () => {
    const d = await ask({
      message: 'cut the dead air',
      durationS: 100,
      clips: [
        { id: 'v1', trackId: 'video', label: 'Shot', startS: 0, endS: 100, type: 'video' },
        { id: 'cap-1', trackId: 'subs', label: 'Caption', startS: 10, endS: 14,
          type: 'subtitle', textPosition: 'lower', textAlign: 'centre' },
      ],
      silences: [[40, 50]],
      energy: [0.5, 0.5, 0.2, 0.2, 0.2],
      audio: 'ready',
      history: [{ role: 'user', text: 'cut the dead air' }],
    });
    expect(d.engine).toMatchObject({ source: 'rules', provider: 'none' });
    const video = d.edit.newClips.filter((c: { type: string }) => c.type === 'video');
    expect(video.map((c: { startS: number; endS: number }) => [c.startS, c.endS]))
      .toEqual([[0, 40], [50, 100]]);
    /* caption clips survive the cut untouched (they were not in the cut span) */
    expect(d.edit.newClips.some((c: { id: string }) => c.id === 'cap-1')).toBe(true);
  });

  it('answers add-captions using the browser transcript it was handed', async () => {
    const d = await ask({
      message: 'add captions',
      durationS: 100,
      clips: [
        { id: 'v1', trackId: 'video', label: 'Shot', startS: 0, endS: 100, type: 'video' },
      ],
      transcript: {
        segments: [
          { startS: 2, endS: 5, text: 'hello there' },
          { startS: 8, endS: 11, text: 'welcome back' },
        ],
        language: '', model: 'whisper', madeAt: new Date().toISOString(),
      },
    });
    const caps = d.edit.newClips.filter((c: { type: string }) => c.type === 'subtitle');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.map((c: { label: string }) => c.label)).toContain('hello there');
    /* every caption falls inside spoken brackets */
    for (const c of caps) {
      expect(c.startS).toBeGreaterThanOrEqual(0);
      expect(c.endS).toBeLessThanOrEqual(100);
      expect(c.endS).toBeGreaterThan(c.startS);
    }
  });

  it('rejects a malformed clip list and falls back to the server copy', async () => {
    const d = await ask({
      message: 'cut the dead air',
      silences: [[10, 20]],
      clips: [{ id: 'broken', trackId: 'video', startS: 'nope', endS: 0, type: 'video' }],
    });
    expect(d.edit.savedS).toBe(0);          // nothing valid to cut
    expect(d.edit.newClips).toHaveLength(0);
  });
});
