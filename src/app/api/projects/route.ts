import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { summariseProject } from '@/lib/projects';

// GET /api/projects — list all projects for the current user
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const projects = db.projects.findByUser(user.id).map(summariseProject);
  return NextResponse.json({ projects });
}
