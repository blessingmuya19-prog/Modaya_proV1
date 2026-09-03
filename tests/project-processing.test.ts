/**
 * Project status must reflect real work: it is 'processing' when footage is
 * received and only becomes 'ready' when the analysis pipeline actually
 * finishes (Studio calls markProjectReady). Nothing is faked on a timer.
 * Finishing must also never undo an edit the user already made.
 */
import { describe, it, expect } from 'vitest';
import { markProjectProcessing, markProjectReady } from '@/lib/projects';
import { db } from '@/lib/db';

const make = (clips: unknown[]) => {
  const id = `p-${Math.random().toString(36).slice(2)}`;
  db.projects.create({
    id, userId: 'u1', name: 'test', filename: 'a.mp4', status: 'uploading',
    durationS: 20, aspectRatio: '16:9', width: 1920, height: 1080,
    clips,
    aiHistory: [{ role: 'ai', text: "I've analysed it.", ts: '' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    exportedAt: null, sizeMb: 1,
  } as never);
  return id;
};

describe('honest project status', () => {
  it('stays processing until the real pipeline marks it ready', () => {
    const id = make([]);
    markProjectProcessing(id);
    expect(db.projects.findById(id)?.status).toBe('processing');

    markProjectReady(id, { filename: 'a.mp4', durationS: 20, aspectRatio: '16:9' });
    const p = db.projects.findById(id);
    expect(p?.status).toBe('ready');
  });

  it('lays down the honest source clip when nothing was edited yet', () => {
    const id = make([]);
    markProjectReady(id, { filename: 'a.mp4', durationS: 20, aspectRatio: '16:9' });

    const p = db.projects.findById(id);
    expect(p?.status).toBe('ready');
    expect(p?.clips.some(c => c.type === 'video')).toBe(true);
    // The source clip spans the whole uploaded footage — no invented cuts.
    const src = p?.clips.find(c => c.type === 'video');
    expect(src?.startS).toBe(0);
    expect(src?.endS).toBe(20);
  });

  it('leaves an already-edited timeline untouched when it completes', () => {
    const id = make([{ id: 'txt-0', trackId: 'text', label: 'Blessing Muya',
                       startS: 0, endS: 20, type: 'text', textPosition: 'top' }]);
    markProjectReady(id, { filename: 'a.mp4', durationS: 20, aspectRatio: '16:9' });

    const p = db.projects.findById(id);
    expect(p?.status).toBe('ready');
    expect(p?.clips.find(c => c.id === 'txt-0'),
      'completing the analysis wiped out the text that had just been added').toBeTruthy();
  });

  it('is a no-op (and never throws) for an unknown project', () => {
    expect(() => markProjectReady('does-not-exist')).not.toThrow();
    expect(() => markProjectProcessing('does-not-exist')).not.toThrow();
  });
});
