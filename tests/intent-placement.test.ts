/**
 * What a bare placement means without an AI model in the loop.
 */
import { describe, it, expect, vi } from 'vitest';

const project = {
  id: 'p1', userId: 'u1', durationS: 53,
  clips: [
    { id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 53, type: 'video' },
    { id: 'txt-0', trackId: 'text', label: 'Subscribe', startS: 0, endS: 53,
      type: 'text', textPosition: 'lower', textAlign: 'right' },
  ],
  aiHistory: [],
};

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/db', () => ({ db: { projects: { findById: () => project, update: () => {} } } }));

async function ask(message: string) {
  const { POST } = await import('@/app/api/projects/[id]/ai/route');
  const req = new Request('http://test/api/projects/p1/ai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return (await POST(req as never, { params: Promise.resolve({ id: 'p1' }) })).json();
}

describe('a placement on its own, with no model', () => {
  it('moves what is on screen for "at top write"', async () => {
    const out = await ask('at top write');
    const sub = out.edit.newClips.find((c: { id: string }) => c.id === 'txt-0');
    expect(sub.textPosition).toBe('top');
    expect(sub.textAlign).toBe('right');
  });

  it('moves, never deletes, for "no top write"', async () => {
    const out = await ask('no top write');
    const sub = out.edit.newClips.find((c: { id: string }) => c.id === 'txt-0');
    expect(sub, 'the correction deleted the overlay').toBeTruthy();
    expect(sub.textPosition).toBe('top');
  });

  it('treats "write subscribe at top" as new text, not a move', async () => {
    const out = await ask('write subscribe at top');
    expect(out.edit.intent).not.toBe('move_text');
  });

  it('treats "add subscribe button" as new text', async () => {
    const out = await ask('add subscribe button');
    expect(out.edit.intent).not.toBe('move_text');
  });
});
