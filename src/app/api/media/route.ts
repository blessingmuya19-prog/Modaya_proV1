/**
 * GET /api/media — storage capability probe.
 *
 * The browser asks the server whether durable server-side media storage is
 * available before it tries to push bytes. On read-only serverless hosts the
 * store falls back to in-memory (durable:false), in which case the client
 * keeps footage in IndexedDB and nothing about the current flow changes.
 */
import { NextResponse } from 'next/server';
import { mediaStore } from '@/lib/server/mediaStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const store = mediaStore();
  return NextResponse.json({
    available: true,
    durable: store.durable,
    driver: store.driver,
    maxUploadMb: Number(process.env.MEDIA_MAX_UPLOAD_MB ?? 2000),
  });
}
