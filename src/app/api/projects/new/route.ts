import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { getCurrentUser } from '@/lib/auth';
import { db, Project } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/new
 *
 * Mint an empty draft project for the Studio mode picker (/new). The Studio
 * attaches footage/reference/media afterwards (the upload/AI routes update the
 * record), so this only reserves the id and remembers which door the user came
 * in through. Returns { projectId, mode }.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to create a project.' }, { status: 401 });

  let mode: 'edit' | 'reference' = 'edit';
  try {
    const body = await req.json().catch(() => ({}));
    mode = body?.mode === 'reference' ? 'reference' : 'edit';
  } catch { /* default to edit */ }

  const now = new Date().toISOString();
  const project: Project = {
    id: uuid(),
    userId: user.id,
    title: mode === 'reference' ? 'Reference edit' : 'New edit',
    filename: '',
    status: 'draft',
    durationS: 0,
    aspectRatio: '16:9',
    thumbnail: '',
    prompt: '',
    clips: [],
    aiHistory: [
      { role: 'ai', text: 'Empty project created.', ts: now },
    ],
    createdAt: now,
    updatedAt: now,
    exportedAt: null,
    sizeMb: 0,
    mode,
  };

  db.projects.create(project);
  return NextResponse.json({ projectId: project.id, mode }, { status: 201 });
}
