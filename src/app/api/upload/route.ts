/**
 * POST /api/upload
 *
 * Accepts JSON metadata about a video file (no actual bytes — the video
 * stays in the browser as a blob URL). Creates a project record and kicks
 * off simulated processing.
 *
 * Why no file bytes?
 * Vercel serverless functions have a 4.5 MB body limit and a read-only
 * filesystem — we cannot store video files server-side. The blob URL
 * approach keeps the video in-browser for the duration of the tab session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createProject, simulateProcessing } from '@/lib/projects';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'You need to be signed in to upload. Please sign in and try again.' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();

    const {
      filename,
      aspectRatio = '16:9',
      durationS   = 0,
      width       = 0,
      height      = 0,
      sizeMb      = 0,
      prompt      = '',
    } = body as Record<string, string | number>;

    if (!filename) {
      return NextResponse.json({ error: 'Filename is required.' }, { status: 400 });
    }

    const title = String(filename).replace(/\.[^.]+$/, '');
    const ar    = String(aspectRatio);

    const project = createProject({
      userId:      user.id,
      title,
      filename:    String(filename),
      sizeMb:      Number(sizeMb),
      prompt:      String(prompt),
      aspectRatio: ar,
      durationS:   Number(durationS),
      width:       Number(width),
      height:      Number(height),
    });

    simulateProcessing(project.id, String(filename), Number(durationS), ar);

    return NextResponse.json({
      projectId:   project.id,
      aspectRatio: ar,
      durationS:   Number(durationS),
    }, { status: 201 });

  } catch (err) {
    console.error('[upload]', err);
    return NextResponse.json(
      { error: 'Something went wrong on the server. Please try again.' },
      { status: 500 }
    );
  }
}
