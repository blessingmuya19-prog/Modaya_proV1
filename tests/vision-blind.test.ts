/**
 * What the chat says when frames were offered and nothing could look at them.
 *
 * The dangerous outcome is not the missing answer — it is an answer that
 * sounds like it came from watching the video.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const project = {
  id: 'p1', userId: 'u1', durationS: 100,
  clips: [{ id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' }],
  aiHistory: [],
};

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/db', () => ({ db: { projects: { findById: () => project, update: () => {} } } }));

/** A provider that is happy to talk but cannot see. */
const calls: { images: number }[] = [];
vi.mock('@/lib/ai/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/llm')>();
  return {
    ...real,
    detectProvider: () => ({ name: 'cloudflare' as const, model: 'text-only-model', ready: true }),
    chatDetailed: async (_msgs: unknown, opts: { images?: string[] } = {}) => {
      calls.push({ images: opts.images?.length ?? 0 });
      if (opts.images?.length) {
        return { ok: false as const, reason: 'no_vision' as const, status: 0, detail: 'blind' };
      }
      return {
        ok: true as const,
        result: {
          text: JSON.stringify({
            reply: 'The clip opens on a wide shot of the court.',
            operations: [{ op: 'none' }],
          }),
          provider: 'cloudflare' as const,
          model: 'text-only-model',
        },
      };
    },
  };
});

async function ask(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/projects/[id]/ai/route');
  const req = new Request('http://test/api/projects/p1/ai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await POST(req as never, { params: Promise.resolve({ id: 'p1' }) })).json();
}

const FRAME = 'data:image/jpeg;base64,AAAA';
const scan  = {
  durationS: 100, cuts: [40],
  samples: Array.from({ length: 50 }, (_, i) => ({ tS: i * 2, brightness: 0.5, motion: 0.01 })),
};

beforeEach(() => { calls.length = 0; });

describe('frames offered to a model that cannot see', () => {
  it('tries once with the pictures, then again without', async () => {
    await ask({ message: 'what do you see?', visual: scan, frames: [FRAME, FRAME] });
    expect(calls.map(c => c.images)).toEqual([2, 0]);
  });

  it('marks the answer as not having seen anything', async () => {
    const out = await ask({ message: 'what do you see?', visual: scan, frames: [FRAME] });
    expect(out.aiMessage.text).toMatch(/no model available to this app can look at the frames/i);
  });

  it('names what would fix it', async () => {
    const out = await ask({ message: 'what do you see?', visual: scan, frames: [FRAME] });
    expect(out.aiMessage.text).toMatch(/Google AI Studio|qwen/i);
  });

  it('leaves an ordinary request unmarked', async () => {
    const out = await ask({ message: 'cut the dead air', visual: scan });
    expect(out.aiMessage.text).not.toMatch(/look at the frames/i);
    expect(calls.map(c => c.images)).toEqual([0]);
  });
});
