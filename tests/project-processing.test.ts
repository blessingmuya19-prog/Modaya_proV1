/**
 * The analysis pass must not undo an edit made while it was still running.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { simulateProcessing } from '@/lib/projects';
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('analysis finishing after an edit', () => {
  it('leaves an edited timeline alone', () => {
    const id = make([{ id: 'txt-0', trackId: 'text', label: 'Blessing Muya',
                       startS: 0, endS: 20, type: 'text', textPosition: 'top' }]);
    simulateProcessing(id, 'a.mp4', 20, '16:9');
    vi.advanceTimersByTime(5000);

    const p = db.projects.findById(id);
    expect(p?.status).toBe('ready');
    expect(p?.clips.find(c => c.id === 'txt-0'),
      'the analysis wiped out the text that had just been added').toBeTruthy();
  });

  it('still lays down the analysed clips when nothing was edited', () => {
    const id = make([]);
    simulateProcessing(id, 'a.mp4', 20, '16:9');
    vi.advanceTimersByTime(5000);

    const p = db.projects.findById(id);
    expect(p?.status).toBe('ready');
    expect(p?.clips.some(c => c.type === 'video')).toBe(true);
    expect(p?.clips.find(c => c.id === 'txt-0')).toBeFalsy();
  });
});
