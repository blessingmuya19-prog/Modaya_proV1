import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mediaKey, mediaPath, extFromFilename } from '../src/lib/mediaKeys';

// The server module is Node-only (fs/crypto) — import directly under vitest.
import { FsStorage, verifyMediaToken, signMediaUrl } from '../src/lib/server/mediaStore';

describe('mediaKeys', () => {
  it('builds namespaced keys per role', () => {
    expect(mediaKey('proj_1', 'main', 'mp4')).toBe('proj_1/main.mp4');
    expect(mediaKey('proj_1', 'ref', 'webm', 2)).toBe('proj_1/ref/2.webm');
    expect(mediaKey('proj_1', 'broll', 'mov', 0)).toBe('proj_1/broll/0.mov');
    expect(mediaKey('proj_1', 'out', 'mp4')).toBe('proj_1/out.mp4');
  });

  it('sanitises the project id and extension', () => {
    expect(mediaKey('../etc/passwd', 'main', 'mp4')).not.toContain('..');
    expect(mediaKey('p1', 'main', 'MP4!')).toBe('p1/main.mp4');
  });

  it('derives an extension from a filename', () => {
    expect(extFromFilename('clip.MOV')).toBe('mov');
    expect(extFromFilename('noext')).toBe('mp4');
    expect(extFromFilename('a.b.webm')).toBe('webm');
  });

  it('maps keys to the media API path', () => {
    expect(mediaPath('p1', 'main', 'mp4')).toBe('/api/media/p1/main.mp4');
    expect(mediaPath('p1', 'ref', 'mp4', 3)).toBe('/api/media/p1/ref/3.mp4');
  });
});

describe('FsStorage', () => {
  const dir = `/tmp/modaya-test-media-${process.pid}`;
  const store = new FsStorage(dir);

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs/promises') as typeof import('fs/promises');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports durable fs driver', () => {
    expect(store.driver).toBe('fs');
    expect(store.durable).toBe(true);
  });

  it('round-trips an object and reads it back', async () => {
    const bytes = Buffer.from('hello media world');
    await store.put('p1/main.mp4', bytes, 'video/mp4');
    expect(await store.has('p1/main.mp4')).toBe(true);

    const got = await store.get('p1/main.mp4');
    expect(got).not.toBeNull();
    expect(got!.size).toBe(bytes.length);
    expect(got!.contentType).toBe('video/mp4');
    expect(got!.bytes.toString()).toBe('hello media world');
  });

  it('serves byte ranges for seeking', async () => {
    const part = await store.openRead('p1/main.mp4', { start: 0, end: 4 });
    expect(part).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const c of part!.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
    expect(part!.contentRange).toEqual({ start: 0, end: 4, size: 17 });
  });

  it('returns null for missing objects', async () => {
    expect(await store.get('p1/nope.mp4')).toBeNull();
    expect(await store.openRead('p1/nope.mp4')).toBeNull();
    expect(await store.has('p1/nope.mp4')).toBe(false);
  });

  it('refuses path traversal', async () => {
    // Writes with an unsafe key are rejected outright…
    await expect(store.put('../escape.bin', Buffer.from('x'), 'application/octet-stream'))
      .rejects.toThrow();
    // …and reads never escape the root: a traversal key resolves to "absent",
    // never to bytes outside the media directory.
    expect(await store.openRead('../../etc/passwd')).toBeNull();
    expect(await store.get('../../etc/hosts')).toBeNull();
  });

  it('deletes objects', async () => {
    await store.put('p1/out.mp4', Buffer.from('out'), 'video/mp4');
    await store.delete('p1/out.mp4');
    expect(await store.has('p1/out.mp4')).toBe(false);
  });
});

describe('signed media URLs', () => {
  beforeEach(() => { process.env.JWT_SECRET = 'test-secret'; delete process.env.SIGNED_MEDIA_SECRET; });

  it('produces a public absolute URL that verifies round-trip', () => {
    process.env.PUBLIC_BASE_URL = 'https://modaya.example.com/';
    const url = signMediaUrl('proj9', 'main', 'mp4');
    expect(url.startsWith('https://modaya.example.com/api/media/proj9/main.mp4?')).toBe(true);

    const u = new URL(url);
    const token = u.searchParams.get('token')!;
    const exp = u.searchParams.get('exp')!;
    expect(verifyMediaToken('proj9', mediaKey('proj9', 'main', 'mp4'), token, exp)).toBe(true);
  });

  it('rejects a token for a different project or key', () => {
    process.env.PUBLIC_BASE_URL = 'https://modaya.example.com';
    const url = new URL(signMediaUrl('projA', 'main', 'mp4'));
    const token = url.searchParams.get('token')!;
    const exp = url.searchParams.get('exp')!;
    // wrong project
    expect(verifyMediaToken('projB', mediaKey('projA', 'main', 'mp4'), token, exp)).toBe(false);
    // wrong key (ref vs main)
    expect(verifyMediaToken('projA', mediaKey('projA', 'ref', 'mp4'), token, exp)).toBe(false);
  });

  it('rejects an expired token', () => {
    process.env.PUBLIC_BASE_URL = 'https://modaya.example.com';
    const url = new URL(signMediaUrl('projC', 'main', 'mp4'));
    const token = url.searchParams.get('token')!;
    const past = String(Math.floor(Date.now() / 1000) - 10);
    expect(verifyMediaToken('projC', mediaKey('projC', 'main', 'mp4'), token, past)).toBe(false);
  });

  it('returns a relative URL when no public origin is configured', () => {
    delete process.env.PUBLIC_BASE_URL;
    const url = signMediaUrl('projD', 'main', 'mp4');
    expect(url.startsWith('/api/media/')).toBe(true);
  });
});
