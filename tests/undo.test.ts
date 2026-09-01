/**
 * One step back, always available.
 *
 * The editor deleted a user's on-screen title after misreading a correction.
 * Whatever else goes wrong, saying "undo" has to return the timeline.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Clip = Record<string, unknown>;
const video = { id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 53, type: 'video' };
const text  = { id: 'txt-0', trackId: 'text', label: 'Subscribe', startS: 0, endS: 53,
                type: 'text', textPosition: 'top', textAlign: 'right' };

const project: {
  id: string; userId: string; durationS: number;
  clips: Clip[]; previousClips?: Clip[]; aiHistory: unknown[];
} = { id: 'p1', userId: 'u1', durationS: 53, clips: [], aiHistory: [] };

vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/db', () => ({
  db: { projects: {
    findById: () => project,
    update: (_id: string, patch: Record<string, unknown>) => Object.assign(project, patch),
  } },
}));

async function ask(message: string) {
  const { POST } = await import('@/app/api/projects/[id]/ai/route');
  const req = new Request('http://test/api/projects/p1/ai', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return (await POST(req as never, { params: Promise.resolve({ id: 'p1' }) })).json();
}

beforeEach(() => {
  project.clips = [video];
  project.previousClips = [video, text];
  project.aiHistory = [];
});

describe('undo', () => {
  it('brings back text that was taken off', async () => {
    const out = await ask('undo');
    expect(project.clips.find(c => c.id === 'txt-0'),
      'undo did not restore the deleted overlay').toBeTruthy();
    expect(out.aiMessage.text).toMatch(/back/i);
  });

  it('answers the other ways people say it', async () => {
    for (const phrase of ['undo that', 'revert', 'put it back', 'Ctrl Z']) {
      project.clips = [video];
      project.previousClips = [video, text];
      await ask(phrase);
      expect(project.clips.length, `"${phrase}" did not undo`).toBe(2);
    }
  });

  it('can be undone again to come back', async () => {
    await ask('undo');
    expect(project.clips.length).toBe(2);
    await ask('undo');
    expect(project.clips.length, 'a second undo did not redo').toBe(1);
  });

  it('says so plainly when there is nothing to undo', async () => {
    project.previousClips = undefined;
    const out = await ask('undo');
    expect(out.aiMessage.text).toMatch(/nothing to undo/i);
    expect(project.clips.length).toBe(1);
  });

  it('does not treat "undocumented" as undo', async () => {
    const out = await ask('undocumented feature?');
    expect(out.edit.intent).not.toBe('undo');
  });
});
