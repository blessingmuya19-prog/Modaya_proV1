/**
 * Media object routes — durable object storage for project media.
 *
 *   PUT  /api/media/<projectId>/main.<ext>                source footage
 *   PUT  /api/media/<projectId>/ref/<n>.<ext>             reference videos
 *   PUT  /api/media/<projectId>/broll/<n>.<ext>           B-roll clips
 *   GET  /api/media/<projectId>/<…>                       stream (Range-aware)
 *
 * GET accepts either the session cookie (the signed-in browser) or a
 * short-lived HMAC token (?token=&exp=) so an external ranker such as
 * TwelveLabs Pegasus can fetch a hosted public URL of the footage.
 *
 * Self-host/dev store bytes on the local filesystem; cloud deployments set
 * the S3-or-R2 environment vars and the same routes stream to/from an
 * S3-compatible bucket. On a read-only serverless host the store is
 * in-memory (non-durable) and the client falls back to IndexedDB.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { mediaStore, verifyMediaToken } from '@/lib/server/mediaStore';
import { mediaKey, type MediaRole } from '@/lib/mediaKeys';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_UPLOAD_MB = Number(process.env.MEDIA_MAX_UPLOAD_MB ?? 2000);

/** Map the URL tail (e.g. `main.mp4` or `ref/0.webm`) to a storage key + role. */
function resolveKey(projectId: string, rest: string[]): { key: string; role: MediaRole } | null {
  if (!rest.length) return null;
  const tail = rest.join('/');
  if (tail.startsWith('ref/'))   { const m = /^ref\/(\d+)\.[A-Za-z0-9]{2,5}$/.exec(tail); if (m) return { key: mediaKey(projectId, 'ref', tail.split('.').pop()!, Number(m[1])), role: 'ref' }; }
  if (tail.startsWith('broll/')) { const m = /^broll\/(\d+)\.[A-Za-z0-9]{2,5}$/.exec(tail); if (m) return { key: mediaKey(projectId, 'broll', tail.split('.').pop()!, Number(m[1])), role: 'broll' }; }
  if (/^main\.[A-Za-z0-9]{2,5}$/.test(tail))  return { key: mediaKey(projectId, 'main', tail.split('.').pop()!), role: 'main' };
  if (/^out\.[A-Za-z0-9]{2,5}$/.test(tail))   return { key: mediaKey(projectId, 'out', tail.split('.').pop()!), role: 'out' };
  return null;
}

// ── PUT — upload bytes ───────────────────────────────────────────────────────

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string; rest?: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { projectId, rest: restRaw } = await params;
  const rest = restRaw ?? [];
  const resolved = resolveKey(projectId, rest);
  if (!resolved) return NextResponse.json({ error: 'Bad media path' }, { status: 400 });

  // The project must exist and belong to the caller.
  const project = db.projects.findById(projectId);
  if (!project)                return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) return NextResponse.json({ error: 'Empty upload' }, { status: 400 });
    if (buf.length > MAX_UPLOAD_MB * 1024 * 1024) {
      return NextResponse.json({ error: `Media exceeds ${MAX_UPLOAD_MB} MB limit` }, { status: 413 });
    }
    const contentType = (req.headers.get('content-type') ?? 'application/octet-stream').split(';')[0];

    const store = mediaStore();
    await store.put(resolved.key, buf, contentType);

    // Record what durable media exists so a reopened project can stream it.
    if (store.durable) {
      const tail = rest.join('/');
      const ext = (tail.split('.').pop() ?? '').toLowerCase();
      if (resolved.role === 'main') {
        db.projects.update(projectId, { media: { ...project.media, main: { ext } } });
      } else if (resolved.role === 'ref') {
        const m = /^ref\/(\d+)\./.exec(tail);
        const idx = m ? Number(m[1]) : 0;
        const refs = [...(project.media?.refs ?? [])];
        refs[idx] = { ext };
        db.projects.update(projectId, { media: { ...project.media, refs } });
      } else if (resolved.role === 'broll') {
        const m = /^broll\/(\d+)\./.exec(tail);
        const idx = m ? Number(m[1]) : 0;
        const brolls = [...(project.media?.brolls ?? [])];
        brolls[idx] = { ext };
        db.projects.update(projectId, { media: { ...project.media, brolls } });
      }
    }

    return NextResponse.json({
      ok: true, key: resolved.key, role: resolved.role,
      bytes: buf.length, durable: store.durable, driver: store.driver,
    }, { status: 201 });
  } catch (err) {
    console.error('[media PUT]', err);
    return NextResponse.json({ error: 'Failed to store media', durable: false }, { status: 507 });
  }
}

// ── GET — stream bytes (Range-aware; cookie or signed token) ─────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string; rest?: string[] }> }) {
  const { projectId, rest: restRaw } = await params;
  const rest = restRaw ?? [];
  const resolved = resolveKey(projectId, rest);
  if (!resolved) return NextResponse.json({ error: 'Bad media path' }, { status: 400 });

  // Auth: session cookie OR valid signed token (external ranker fetch).
  const user = await getCurrentUser();
  if (!user) {
    const u = new URL(req.url);
    const token = u.searchParams.get('token') ?? '';
    const exp   = u.searchParams.get('exp') ?? '';
    if (!token || !verifyMediaToken(projectId, resolved.key, token, exp)) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  } else {
    const project = db.projects.findById(projectId);
    if (!project)                return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (project.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Byte range for seeking (video elements send `Range: bytes=start-end`).
  let range: { start: number; end: number } | undefined;
  const rangeHeader = req.headers.get('range');
  if (rangeHeader) {
    const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (m) {
      const start = Number(m[1]);
      const end   = m[2] ? Number(m[2]) : undefined;
      range = { start, end: end ?? Number.MAX_SAFE_INTEGER };
    }
  }

  const obj = await mediaStore().openRead(resolved.key, range);
  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Readable } = require('stream') as typeof import('stream');
  const webStream = Readable.toWeb(obj.stream as unknown as import('stream').Readable) as unknown as ReadableStream;

  const headers: Record<string, string> = {
    'content-type': obj.contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
  };

  if (obj.contentRange) {
    const { start, end, size } = obj.contentRange;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
    headers['content-length'] = String(end - start + 1);
    return new NextResponse(webStream as unknown as BodyInit, { status: 206, headers });
  }
  headers['content-length'] = String(obj.size);
  return new NextResponse(webStream as unknown as BodyInit, { status: 200, headers });
}

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ projectId: string; rest?: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { projectId, rest: restRaw } = await params;
  const rest = restRaw ?? [];
  const resolved = resolveKey(projectId, rest);
  if (!resolved) return NextResponse.json({ error: 'Bad media path' }, { status: 400 });

  const project = db.projects.findById(projectId);
  if (!project)                return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await mediaStore().delete(resolved.key);
  return NextResponse.json({ ok: true });
}
