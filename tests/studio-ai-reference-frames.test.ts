/**
 * Reference-frames spike — end-to-end wiring of the request path.
 *
 * The route builds the picture a vision model actually receives. These tests
 * pin three things the spike depends on: reference pixels really reach the
 * model (footage first, reference second), the prompt tells the model what
 * the reference frames are and how to cite them, and when nothing can see
 * the frames the answer is downgraded honestly instead of pretending.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const llm = vi.hoisted(() => ({
  chatDetailed: vi.fn(),
  detectProvider: vi.fn(),
  extractJson: vi.fn((t: string) => JSON.parse(t)),
  explainFailure: vi.fn((r: string) => `failure: ${r}`),
}));

vi.mock('@/lib/ai/llm', () => llm);

const project = {
  id: 'p1', userId: 'u1', durationS: 100,
  clips: [],
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
  llm.chatDetailed.mockReset();
  llm.detectProvider.mockReturnValue({ ready: true, name: 'groq', model: 'qwen' });
  llm.chatDetailed.mockResolvedValue({
    ok: true,
    result: {
      text: JSON.stringify({ reply: 'matching the reference', operations: [] }),
      model: 'qwen-3.6',
    },
  });
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

const BODY = {
  message: 'match the reference style',
  durationS: 100,
  clips: [{ id: 'v1', trackId: 'video', label: 'Shot', startS: 0, endS: 100, type: 'video' }],
  silence: undefined,
  silences: [],
  energy: [0.5, 0.4, 0.3],
  audio: 'ready',
};

describe('reference frames reach the model', () => {
  it('sends footage frames first, then timestamped reference frames', async () => {
    const ref1 = 'data:image/jpeg;base64,AAA';
    const ref2 = 'data:image/jpeg;base64,BBB';
    const foot = 'data:image/jpeg;base64,FFF';
    await ask({
      ...BODY,
      frames: [foot],
      refFrames: [{ tS: 3.2, dataUrl: ref1 }, { tS: 12.0, dataUrl: ref2 }],
    });

    expect(llm.chatDetailed).toHaveBeenCalledTimes(1);
    const [msgs, opts] = llm.chatDetailed.mock.calls[0] as [
      { role: string; content: string }[], { images: string[] },
    ];
    expect(opts.images).toEqual([foot, ref1, ref2]);
    const context = msgs.find(m => m.role === 'system' && m.content.includes('REFERENCE FRAMES ATTACHED'))?.content ?? '';
    expect(context).toContain('taken at 3.2s, 12.0s');
    expect(context).toContain('not the footage');
    expect(context).toContain('("like the reference cuts right');
    const order = msgs.find(m => m.role === 'system' && m.content.includes('IMAGE ORDER'))?.content ?? '';
    expect(order).toContain('1 footage frames first, then 2 reference frames.');
  });

  it('drops reference frames from the text-only retry and says it stayed blind', async () => {
    llm.chatDetailed
      .mockResolvedValueOnce({ ok: false, reason: 'no_vision', status: 0, detail: 'no model can see' })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          text: JSON.stringify({ reply: 'measurements only', operations: [] }),
          model: 'text-1',
        },
      });

    const d = await ask({
      ...BODY,
      frames: ['data:image/jpeg;base64,FFF'],
      refFrames: [{ tS: 3.2, dataUrl: 'data:image/jpeg;base64,AAA' }],
    });

    expect(llm.chatDetailed).toHaveBeenCalledTimes(2);
    const [, retryOpts] = llm.chatDetailed.mock.calls[1] as unknown as [
      unknown, { images: string[] },
    ];
    expect(retryOpts.images).toEqual([]);
    expect(d.aiMessage.text).toContain('no model available');
    expect(d.aiMessage.text).toContain('reference frames');
  });

  it('does not attach reference frames unless the body provided them', async () => {
    await ask({ ...BODY, frames: [] });
    expect(llm.chatDetailed).toHaveBeenCalledTimes(1);
    const [, opts] = llm.chatDetailed.mock.calls[0] as [unknown, { images: string[] }];
    expect(opts.images).toEqual([]);
    const [msgs] = llm.chatDetailed.mock.calls[0] as [{ role: string; content: string }[], unknown];
    expect(msgs.some(m => m.content.includes('REFERENCE FRAMES ATTACHED'))).toBe(false);
  });
});
