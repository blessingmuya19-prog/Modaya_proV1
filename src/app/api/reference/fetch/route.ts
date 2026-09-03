/**
 * POST /api/reference/fetch
 *
 * Fetch a reference video from a public **direct media link** so the user can
 * paste a URL ("edit my video like this") without downloading anything. The
 * fetch runs on the server to avoid browser CORS limits; the returned bytes
 * are then analysed in the browser exactly like an uploaded reference.
 *
 * Deliberate scope:
 *   • Only direct media URLs are retrieved — a link whose content type is
 *     video/audio, or a file extension Modaya can analyse.
 *   • Platform *watch* pages (YouTube, TikTok, Instagram, Vimeo, Facebook,
 *     X, Shorts…) are NOT downloaded: they are pages, not media files, and
 *     scraping them is both unreliable and against their terms. We recognise
 *     them and tell the user to use a direct file link or upload the file.
 *   • SSRF guard: http(s) only, hostnames only, and no private/loopback/
 *     link-local addresses. Download is capped in size.
 *
 * A reference is style *material*, never footage to copy — the bytes are
 * measured for editing DNA (pacing, cuts, captions, zooms), not output.
 */
import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { getCurrentUser } from '@/lib/auth';
import { classifyLink, isPrivateIp, MEDIA_EXT_RE, MEDIA_CT_RE } from '@/lib/referenceGuard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = Number(process.env.REFERENCE_MAX_MB ?? 300) * 1024 * 1024;
const MAX_HOPS = 5;

/**
 * Resolve a URL's hostname and refuse it if any address is private/loopback/
 * link-local. This catches DNS-rebinding names (e.g. `127.0.0.1.nip.io`) that
 * the string-based guard misses. Returns an error response, or null when safe.
 */
async function assertPublicAddress(target: URL): Promise<NextResponse | null> {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(target.hostname, { all: true, verbatim: true });
  } catch {
    return NextResponse.json({ ok: false, kind: 'unreachable', error: 'That link’s address couldn’t be resolved.' }, { status: 502 });
  }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    return NextResponse.json({ ok: false, kind: 'blocked-address', error: 'That link points to a private or internal address.' }, { status: 400 });
  }
  return null;
}

/** Re-validate a redirect target (which may be relative) through the same policy. */
function classifyAbsolute(target: URL): NextResponse | null {
  const v = classifyLink(target.toString());
  if (v.verdict === 'platform') {
    return NextResponse.json({ ok: false, kind: 'platform', platform: v.platform, error: `That redirects to a ${v.platform} page, not a video file.` }, { status: 422 });
  }
  if (v.verdict !== 'ok' || !v.url) {
    return NextResponse.json({ ok: false, kind: 'blocked-address', error: 'That link redirects to an address Modaya won’t fetch.' }, { status: 400 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to use a reference link.' }, { status: 401 });

  let url = '';
  try {
    const body = await req.json();
    url = String(body?.url ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const verdict = classifyLink(url);
  if (verdict.verdict === 'invalid') {
    return NextResponse.json({ ok: false, kind: 'invalid', error: 'That doesn’t look like a direct video link. Paste a URL to a .mp4/.webm/etc file.' }, { status: 400 });
  }
  if (verdict.verdict === 'blocked-address') {
    return NextResponse.json({ ok: false, kind: 'blocked-address', error: 'That link points to a private or internal address.' }, { status: 400 });
  }
  if (verdict.verdict === 'platform') {
    // Watch pages are recognised and declined honestly rather than scraped.
    return NextResponse.json({
      ok: false, kind: 'platform', platform: verdict.platform,
      error: `That's a ${verdict.platform} page link, not a video file. Download the clip (or copy its direct media link) and use that, or upload it.`,
    }, { status: 422 });
  }
  if (!verdict.url) {
    return NextResponse.json({ ok: false, kind: 'invalid', error: 'That doesn’t look like a direct video link.' }, { status: 400 });
  }

  let parsed = verdict.url;

  // SSRF: validate the *resolved* IP, then follow redirects manually so each
  // hop is re-classified and re-resolved (a redirect to 169.254/127/10.x is
  // refused rather than silently followed).
  const block = await assertPublicAddress(parsed);
  if (block) return block;

  let upstream: Response;
  try {
    let target = parsed;
    let hop = 0;
    for (;;) {
      upstream = await fetch(target.toString(), {
        redirect: 'manual',
        headers: { 'User-Agent': 'ModayaReferenceFetcher/1.0' },
        signal: AbortSignal.timeout(60_000),
      });
      const loc = upstream.headers.get('location');
      if (upstream.status >= 300 && upstream.status < 400 && loc) {
        if (++hop > MAX_HOPS) {
          return NextResponse.json({ ok: false, kind: 'unreachable', error: 'Too many redirects.' }, { status: 502 });
        }
        const next = new URL(loc, target);
        const bad = classifyAbsolute(next) ?? await assertPublicAddress(next);
        if (bad) return bad;
        target = next;
        continue;
      }
      parsed = target;
      break;
    }
  } catch {
    return NextResponse.json({ ok: false, kind: 'unreachable', error: 'Could not reach that link. Check it works in a browser and try again.' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ ok: false, kind: 'unreachable', error: `The link returned status ${upstream.status}.` }, { status: 502 });
  }

  const ctype = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
  const len = Number(upstream.headers.get('content-length') ?? 0);
  const isMediaContent = MEDIA_CT_RE.test(ctype) || MEDIA_EXT_RE.test(parsed.pathname);
  if (!isMediaContent) {
    return NextResponse.json({
      ok: false, kind: 'not-media',
      error: ctype.includes('html')
        ? 'That link is a web page, not a video file. Paste a direct media link or upload the clip.'
        : 'That link doesn’t point to a video or audio file Modaya can analyse.',
    }, { status: 422 });
  }
  if (len && len > MAX_BYTES) {
    return NextResponse.json({ ok: false, kind: 'too-large', error: 'That reference is too large to fetch (limit 300 MB).' }, { status: 413 });
  }

  // Read with a hard cap so a server that lies about content-length can't
  // exhaust memory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Readable } = require('stream') as typeof import('stream');
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const piece of Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream<Uint8Array>)) {
      const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      total += buf.length;
      if (total > MAX_BYTES) {
        return NextResponse.json({ ok: false, kind: 'too-large', error: 'That reference is too large to fetch (limit 300 MB).' }, { status: 413 });
      }
      chunks.push(buf);
    }
  } catch {
    return NextResponse.json({ ok: false, kind: 'unreachable', error: 'The download was interrupted.' }, { status: 502 });
  }

  const buffer = Buffer.concat(chunks);
  const ext = MEDIA_EXT_RE.test(parsed.pathname)
    ? (parsed.pathname.split('.').pop() ?? 'mp4').toLowerCase()
    : (ctype.split('/')[1] ?? 'mp4').replace(/[^a-z0-9]/g, '');
  const filename = `reference-${Date.now()}.${ext || 'mp4'}`;

  // Stream the bytes straight back; the client turns them into a File for the
  // same in-browser analysis pipeline used by uploads.
  return new NextResponse(new Uint8Array(buffer) as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': ctype || 'video/mp4',
      'content-length': String(buffer.length),
      'x-reference-filename': encodeURIComponent(filename),
    },
  });
}
