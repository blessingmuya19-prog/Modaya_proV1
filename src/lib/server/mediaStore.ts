/**
 * Server-side durable media storage (object store).
 *
 * The browser keeps source footage in IndexedDB so a tab refresh never loses
 * it; but that bytes-live-in-one-browser reality means reopening a project on
 * another device (or a fresh browser) has no video, and a remote ranker such
 * as TwelveLabs Pegasus — which needs a *publicly reachable* video URL — can
 * never see the file. This module is the durable, shareable object store.
 *
 * Three drivers are selected purely by environment — no SDK, no new
 * dependencies — so the free/self-host story stays intact:
 *
 *   1. `s3`  — any S3-compatible object storage (Cloudflare R2, AWS S3,
 *              MinIO, Backblaze B2…). Used when S3_ENDPOINT / S3_BUCKET and
 *              S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are present. Signed
 *              with hand-rolled AWS SigV4 over plain fetch + node streams.
 *   2. `fs`  — local filesystem under <DATA_DIR>/media (default ./data/media).
 *              Development by default; production self-hosts (Docker, a VPS,
 *              `next start`) get durable files for free.
 *   3. `mem` — in-process Map. Fallback on read-only serverless hosts where
 *              the FS cannot be written; the client then keeps using
 *              IndexedDB and nothing breaks.
 *
 * Keys are caller-owned and namespaced per project, e.g.
 *   `proj_abc/main.mp4`, `proj_abc/ref/mov_12.webm`, `proj_abc/out.mp4`.
 *
 * Nothing here is imported by client code — it is a Node/runtime-only module.
 */

// ── Interface ────────────────────────────────────────────────────────────────

import { mimeFromExt } from '../mediaKeys';

export interface StoredObject {
  bytes:     Buffer;
  contentType: string;
  size:      number;
}

export interface OpenReadResult {
  stream: NodeJS.ReadableStream;
  size: number;            // total object size
  contentType: string;
  contentRange?: { start: number; end: number; size: number };
  unsatisfiable?: boolean;
}

export interface MediaStorage {
  readonly driver: 'fs' | 's3' | 'mem';
  /** Whether bytes written here survive the process (i.e. durable). */
  readonly durable: boolean;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  /** Streaming read, optionally a byte range for seeking; null when absent. */
  openRead(key: string, range?: { start: number; end?: number }): Promise<OpenReadResult | null>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

// ── In-memory driver (always available, the serverless fallback) ─────────────

export class MemoryStorage implements MediaStorage {
  readonly driver = 'mem' as const;
  readonly durable = false;
  private map = new Map<string, StoredObject>();

  async put(key: string, bytes: Buffer, contentType: string) {
    const ext = key.split('.').pop() ?? '';
    const ct = contentType && contentType !== 'application/octet-stream' ? contentType : mimeFromExt(ext);
    this.map.set(key, { bytes, contentType: ct, size: bytes.length });
  }
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async openRead(key: string, range?: { start: number; end?: number }): Promise<OpenReadResult | null> {
    const o = this.map.get(key);
    if (!o) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Readable } = require('stream') as typeof import('stream');
    const ext = key.split('.').pop() ?? '';
    const contentType = o.contentType && o.contentType !== 'application/octet-stream' ? o.contentType : mimeFromExt(ext);
    if (range) {
      if (range.start >= o.size || range.start < 0 || (range.end !== undefined && range.end < range.start)) {
        return {
          stream: Readable.from([]),
          size: o.size,
          contentType,
          unsatisfiable: true,
        };
      }
      const start = Math.max(0, range.start);
      const end   = Math.min(o.size - 1, range.end ?? (o.size - 1));
      return {
        stream: Readable.from(o.bytes.subarray(start, end + 1)),
        size: o.size, contentType,
        contentRange: { start, end, size: o.size },
      };
    }
    return { stream: Readable.from(o.bytes), size: o.size, contentType };
  }
  async has(key: string) { return this.map.has(key); }
  async delete(key: string) { this.map.delete(key); }
}

// ── Local filesystem driver ──────────────────────────────────────────────────

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Resolve a storage key to an absolute path *inside* the media root.
 *  Rejects anything that could escape (`..`, absolute paths, odd chars). */
function resolveSafe(root: string, key: string): string {
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new Error(`Unsafe media key: ${key}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const full = path.join(root, key);
  const rel  = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Media key escapes storage root: ${key}`);
  }
  return full;
}

export class FsStorage implements MediaStorage {
  readonly driver = 'fs' as const;
  readonly durable = true;

  constructor(private root: string) {}

  private async ensureReady(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs/promises') as typeof import('fs/promises');
    await fs.mkdir(this.root, { recursive: true });
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    await this.ensureReady();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs   = require('fs/promises') as typeof import('fs/promises');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const fp = resolveSafe(this.root, key);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, bytes);
    const ext = key.split('.').pop() ?? '';
    const ct = contentType && contentType !== 'application/octet-stream' ? contentType : mimeFromExt(ext);
    await fs.writeFile(fp + '.type', ct, 'utf-8').catch(() => {});
  }

  async get(key: string): Promise<StoredObject | null> {
    const r = await this.openRead(key);
    if (!r) return null;
    const chunks: Buffer[] = [];
    for await (const c of r.stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
    return { bytes: Buffer.concat(chunks), contentType: r.contentType, size: r.size };
  }

  async openRead(key: string, range?: { start: number; end?: number }): Promise<OpenReadResult | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs   = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsp  = require('fs/promises') as typeof import('fs/promises');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Readable } = require('stream') as typeof import('stream');
      const fp   = resolveSafe(this.root, key);
      const stat = await fsp.stat(fp);
      if (!stat.isFile()) return null;
      let contentType = await fsp.readFile(fp + '.type', 'utf-8').catch(() => '');
      if (!contentType || contentType === 'application/octet-stream') {
        const ext = key.split('.').pop() ?? '';
        contentType = mimeFromExt(ext);
      }
      if (range) {
        if (range.start >= stat.size || range.start < 0 || (range.end !== undefined && range.end < range.start)) {
          return {
            stream: Readable.from([]),
            size: stat.size,
            contentType,
            unsatisfiable: true,
          };
        }
        const start = Math.max(0, range.start);
        const end   = Math.min(stat.size - 1, range.end ?? (stat.size - 1));
        return {
          stream: fs.createReadStream(fp, { start, end }),
          size: stat.size, contentType,
          contentRange: { start, end, size: stat.size },
        };
      }
      return { stream: fs.createReadStream(fp), size: stat.size, contentType };
    } catch {
      return null;
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.openRead(key)) !== null;
  }

  async delete(key: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsp  = require('fs/promises') as typeof import('fs/promises');
    await fsp.rm(resolveSafe(this.root, key), { force: true }).catch(() => {});
    await fsp.rm(resolveSafe(this.root, key) + '.type', { force: true }).catch(() => {});
  }
}

// ── S3 / R2 driver (SigV4, dependency-free) ──────────────────────────────────

interface S3Config {
  endpoint: string;   // e.g. https://<acct>.r2.cloudflarestorage.com  or  https://s3.amazonaws.com
  region:   string;
  bucket:   string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional path-style prefix (e.g. a subdirectory in the bucket). */
  prefix:   string;
}

/** Tiny AWS Signature V4 signer for the handful of requests we make.
 *  Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html */
async function s3Fetch(cfg: S3Config, method: string, key: string, opts: {
  body?: Buffer;
  contentType?: string;
  range?: string;
  unsignedPayload?: boolean;
} = {}): Promise<Response> {
  const crypto = globalThis.crypto;
  const enc = new TextEncoder();
  const endpoint = cfg.endpoint.replace(/\/+$/, '');
  const objectKey = `${cfg.prefix}${cfg.prefix && !cfg.prefix.endsWith('/') ? '/' : ''}${key}`;
  const url = `${endpoint}/${cfg.bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const sha256Hex = async (data: ArrayBuffer | Uint8Array | string) => {
    const buf = typeof data === 'string' ? enc.encode(data) : data;
    const hash = await crypto.subtle.digest('SHA-256', buf as ArrayBuffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const body = opts.body ?? null;
  const payloadHash = body
    ? await sha256Hex(body)
    : (method === 'PUT' ? await sha256Hex(new Uint8Array(0)) : '');
  // Streaming GETs (and anything the caller marks) use UNSIGNED-PAYLOAD so the
  // request body need not be buffered to hash it — the standard S3 pattern.
  const signedPayload = opts.unsignedPayload
    ? 'UNSIGNED-PAYLOAD'
    : payloadHash || 'UNSIGNED-PAYLOAD';

  const headers: Record<string, string> = {
    host: new URL(endpoint).host,
    'x-amz-content-sha256': signedPayload,
    'x-amz-date': amzDate,
  };
  if (opts.contentType) headers['content-type'] = opts.contentType;
  if (opts.range) headers['range'] = opts.range;

  const canonicalHeaders = Object.keys(headers).sort().map(
    k => `${k}:${headers[k].trim()}\n`
  ).join('');
  const signedHeaders = Object.keys(headers).sort().join(';');

  const { pathname, search } = new URL(url);
  const canonicalUri = pathname.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [
    method, canonicalUri, search.replace(/^\?/, ''),
    canonicalHeaders, signedHeaders, signedPayload,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest),
  ].join('\n');

  const hmac = async (key: ArrayBuffer | Uint8Array, data: string) => {
    const h = await crypto.subtle.importKey(
      'raw', key as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', h, enc.encode(data)));
  };
  let k: Uint8Array | ArrayBuffer = enc.encode(`AWS4${cfg.secretAccessKey}`);
  k = await hmac(k, dateStamp);
  k = await hmac(k, cfg.region);
  k = await hmac(k, 's3');
  k = await hmac(k, 'aws4_request');
  const signature = Array.from(await hmac(k, stringToSign))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method, headers, cache: 'no-store',
    // Buffer is a Uint8Array; cast through the stream body type fetch accepts.
    body: body ? (new Uint8Array(body) as unknown as BodyInit) : null,
  });
}

class S3Storage implements MediaStorage {
  readonly driver = 's3' as const;
  readonly durable = true;

  constructor(private cfg: S3Config) {}

  async put(key: string, bytes: Buffer, contentType: string) {
    const res = await s3Fetch(this.cfg, 'PUT', key, { body: bytes, contentType });
    if (!res.ok) throw new Error(`S3 put ${key} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await s3Fetch(this.cfg, 'GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 get ${key} failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    return { bytes: Buffer.from(ab), contentType: res.headers.get('content-type') ?? 'application/octet-stream', size: ab.byteLength };
  }

  async openRead(key: string, range?: { start: number; end?: number }): Promise<OpenReadResult | null> {
    const rangeHeader = range ? (range.end !== undefined ? `bytes=${range.start}-${range.end}` : `bytes=${range.start}-`) : undefined;
    const res = await s3Fetch(this.cfg, 'GET', key, { range: rangeHeader, unsignedPayload: true });
    if (res.status === 404) return null;
    if (res.status === 416) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Readable } = require('stream') as typeof import('stream');
      const cr = res.headers.get('content-range');
      const m = /bytes\s+\*\/(\d+)/.exec(cr ?? '');
      const total = m ? Number(m[1]) : 0;
      return { stream: Readable.from([]), size: total, contentType: 'application/octet-stream', unsatisfiable: true };
    }
    if (res.status !== 200 && res.status !== 206 || !res.body) {
      throw new Error(`S3 open ${key} failed: ${res.status}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Readable } = require('stream') as typeof import('stream');
    const webStream = res.body as unknown as import('stream/web').ReadableStream<Uint8Array>;
    const ext = key.split('.').pop() ?? '';
    const headerCt = res.headers.get('content-type');
    const contentType = headerCt && headerCt !== 'application/octet-stream' ? headerCt : mimeFromExt(ext);

    const cr = res.headers.get('content-range');          // e.g. "bytes 0-99/12345"
    const cl = Number(res.headers.get('content-length') ?? 0);
    if (cr) {
      const m = /bytes\s+(\d+)-(\d+)\/(\d+)/.exec(cr);
      if (m) {
        const start = Number(m[1]), end = Number(m[2]), total = Number(m[3]);
        return {
          stream: Readable.fromWeb(webStream), size: total, contentType,
          contentRange: { start, end, size: total },
        };
      }
    }
    if (range && cl > 0) {
      const end = range.end !== undefined ? range.end : cl - 1;
      return {
        stream: Readable.fromWeb(webStream), size: cl, contentType,
        contentRange: { start: range.start, end, size: Math.max(cl, end + 1) },
      };
    }
    return { stream: Readable.fromWeb(webStream), size: cl, contentType };
  }

  async has(key: string): Promise<boolean> {
    const res = await s3Fetch(this.cfg, 'HEAD', key);
    return res.ok;
  }

  async delete(key: string) {
    await s3Fetch(this.cfg, 'DELETE', key).catch(() => {});
  }
}

// ── Selection ────────────────────────────────────────────────────────────────

function envTrim(k: string): string { return (process.env[k] ?? '').trim(); }

let _instance: MediaStorage | null = null;

/** The active media store. Selected once, lazily, by environment:
 *  S3/R2 creds win; otherwise a writable local media dir; else in-memory. */
export function mediaStore(): MediaStorage {
  if (_instance) return _instance;

  const endpoint = envTrim('S3_ENDPOINT') || envTrim('R2_ENDPOINT');
  const bucket   = envTrim('S3_BUCKET')   || envTrim('R2_BUCKET');
  const ak       = envTrim('S3_ACCESS_KEY_ID')     || envTrim('R2_ACCESS_KEY_ID');
  const sk       = envTrim('S3_SECRET_ACCESS_KEY') || envTrim('R2_SECRET_ACCESS_KEY');

  if (endpoint && bucket && ak && sk) {
    _instance = new S3Storage({
      endpoint,
      bucket,
      accessKeyId: ak,
      secretAccessKey: sk,
      region:   envTrim('S3_REGION') || envTrim('R2_REGION') || 'auto',
      prefix:   envTrim('S3_PREFIX') || envTrim('R2_PREFIX') || 'media',
    });
    return _instance;
  }

  // Default data root is statically scoped to ./data so Turbopack can trace
  // it; an explicit DATA_DIR (self-host volume) opts out of that tracing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const defaultDir = path.join(process.cwd(), 'data', 'media');
  const mediaDir = envTrim('DATA_DIR')
    ? path.join(/* turbopackIgnore: true */ envTrim('DATA_DIR'), 'media')
    : defaultDir;

  // fs is usable in development, or in production when the directory is
  // writable (self-host). On read-only serverless FS, creation fails and we
  // fall through to the in-memory driver without ever throwing.
  const wantFs = process.env.STORAGE_DRIVER
    ? process.env.STORAGE_DRIVER.trim() === 'fs'
    : process.env.NODE_ENV !== 'production' || writableFs(mediaDir);
  if (wantFs && writableFs(mediaDir)) {
    _instance = new FsStorage(mediaDir);
    return _instance;
  }

  _instance = new MemoryStorage();
  return _instance;
}

function writableFs(dir: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

// ── Keys (re-exported from the isomorphic shared module) ─────────────────────

export { mediaKey, mediaPath, extFromFilename } from '../mediaKeys';
export type { MediaRole } from '../mediaKeys';

// ── Signed public URLs (for external rankers such as TwelveLabs Pegasus) ─────

import { mediaKey as _mediaKey, mediaPath as _mediaPath, type MediaRole } from '../mediaKeys';

/**
 * Media GET is normally cookie-authenticated. A remote model provider cannot
 * send our session cookie, so we mint a short-lived HMAC-signed URL that the
 * media route accepts in place of the cookie. This is the "hosted public
 * video URL" Pegasus needs; it only works on a deployment whose origin is
 * reachable from the public internet (PUBLIC_BASE_URL). Returns a relative
 * path when no public origin is configured.
 */
export function signMediaUrl(projectId: string, role: MediaRole, ext: string, index?: number, ttlSeconds = 60 * 60 * 12): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto');
  const key = _mediaKey(projectId, role, ext, index);
  const secret = process.env.SIGNED_MEDIA_SECRET || process.env.JWT_SECRET || 'modaya-dev-secret-change-in-production';
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${projectId}.${key}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const path = _mediaPath(projectId, role, ext, index);
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}${path}?token=${sig}&exp=${exp}`;
}

export function verifyMediaToken(projectId: string, key: string, token: string, exp: string): boolean {
  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN < Math.floor(Date.now() / 1000)) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto');
  const secret = process.env.SIGNED_MEDIA_SECRET || process.env.JWT_SECRET || 'modaya-dev-secret-change-in-production';
  const payload = `${projectId}.${key}.${expN}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
