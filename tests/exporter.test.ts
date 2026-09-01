/**
 * Real export wiring. jsdom has no canvas.captureStream, MediaRecorder or
 * AudioContext, so the honest behaviour is: capability guard reports false and
 * renderToFile rejects with a clear message instead of throwing obscurely.
 * describeBytes is pure formatting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  exportSupported, describeBytes, downloadBlob, renderToFile,
} from '@/lib/render/exporter';
import type { Sequence } from '@/lib/render/sequence';

afterEach(() => vi.unstubAllGlobals());

const seq: Sequence = {
  durationS: 10, width: 1920, height: 1080, fps: 30,
  clips: [{
    id: 'v1', trackId: 'video', kind: 'video', label: '',
    sourceId: 'main', sourceIn: 0, timelineIn: 0, timelineOut: 10,
    muted: false, transform: { type: 'cover' }, effects: { opacity: 1 },
  } as never],
} as unknown as Sequence;

describe('exportSupported', () => {
  it('is false in environments without captureStream/MediaRecorder (jsdom)', () => {
    expect(exportSupported()).toBe(false);
  });

  it('is true when all the browser pieces exist', () => {
    vi.stubGlobal('MediaRecorder', class {});
    vi.stubGlobal('AudioContext', class {});
    // captureStream on the canvas prototype
    (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream = () => ({});
    expect(exportSupported()).toBe(true);
    delete (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;
  });
});

describe('renderToFile', () => {
  it('rejects with a clear message rather than throwing when unsupported', async () => {
    await expect(renderToFile({
      sequence: seq, sourceUrl: 'blob:x', sourceId: 'main',
      resLongEdge: 1920, fps: 30, videoBits: 12_000_000,
    })).rejects.toThrow(/cannot record|captureStream|MediaRecorder/i);
  });
});

describe('describeBytes', () => {
  it('formats B / KB / MB sensibly', () => {
    expect(describeBytes(512)).toBe('512 B');
    expect(describeBytes(2048)).toBe('2 KB');
    expect(describeBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('downloadBlob', () => {
  it('creates an object URL and triggers an anchor download', () => {
    const click = vi.fn();
    const create = vi.fn(() => 'blob:mock');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const anchor: Record<string, unknown> = { click, remove: vi.fn() };
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      (tag === 'a' ? anchor : {}) as HTMLElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor as never);

    downloadBlob(new Blob(['x']), 'clip.mp4');
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(anchor.download).toBe('clip.mp4');
  });
});
