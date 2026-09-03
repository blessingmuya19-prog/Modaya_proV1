/**
 * POST /api/upload
 *
 * Accepts JSON metadata about a video file (no actual bytes — the video
 * stays in the browser as a blob URL). Creates a project record in the
 * 'processing' state. The REAL analysis runs client-side in Studio (audio
 * loudness/silence measurement, optional speech-to-text, moment detection);
 * Studio flips the project to 'ready' via PATCH when that pipeline actually
 * finishes. Nothing here claims the work is done before it is.
 *
 * Why no file bytes?
 * Vercel serverless functions have a 4.5 MB body limit and a read-only
 * filesystem — we cannot store video files server-side. The blob URL
 * approach keeps the video in-browser for the duration of the tab session,
 * with an IndexedDB copy (and a best-effort durable object store) for reloads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createProject, markProjectProcessing } from '@/lib/projects';

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
      thumbnail   = '',
    } = body as Record<string, string | number>;

    if (!filename) {
      return NextResponse.json({ error: 'Filename is required.' }, { status: 400 });
    }

    const title = String(filename).replace(/\.[^.]+$/, '');
    const ar    = String(aspectRatio);

    // Only accept a reasonably sized JPEG/PNG data URL as the poster frame
    const rawThumb = String(thumbnail);
    const thumb = /^data:image\/(jpeg|png);base64,/.test(rawThumb) && rawThumb.length < 400_000
      ? rawThumb
      : '';

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
      thumbnail:   thumb,
    });

    // Honest status: footage is received, real analysis now runs in Studio.
    // No timer-based flip to 'ready' — Studio reports 'ready' on completion.
    markProjectProcessing(project.id);

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
