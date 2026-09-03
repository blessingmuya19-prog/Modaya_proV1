import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';

// GET /api/projects/:id — full project detail (including clips + AI history)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const project = db.projects.findById(id);
  if (!project)              return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json({ project });
}

// PATCH /api/projects/:id — update title, prompt, clips, etc.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const project = db.projects.findById(id);
  if (!project)              return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  // Only allow safe fields to be patched
  const allowed = ['title', 'prompt', 'clips', 'status', 'aspectRatio', 'exportedAt', 'thumbnail', 'media',
    'filename', 'durationS', 'width', 'height', 'sizeMb', 'mode'] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  const updated = db.projects.update(id, patch);
  return NextResponse.json({ project: updated });
}

// DELETE /api/projects/:id
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await params;
  const project = db.projects.findById(id);
  if (!project)              return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (project.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Remove any durable media objects alongside the project record.
  try {
    const { mediaStore, mediaKey } = await import('@/lib/server/mediaStore');
    const store = mediaStore();
    const m = project.media;
    if (m?.main)  await store.delete(mediaKey(id, 'main', m.main.ext));
    if (m?.refs)  await Promise.all(m.refs.filter(Boolean).map((r, i) => store.delete(mediaKey(id, 'ref', r.ext, i))));
  } catch { /* object-store cleanup is best-effort */ }

  db.projects.delete(id);
  return NextResponse.json({ ok: true });
}
