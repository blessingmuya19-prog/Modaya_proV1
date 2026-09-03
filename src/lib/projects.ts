/**
 * Project helpers — shared between API routes.
 */
import { v4 as uuid } from 'uuid';
import { db, Project, Clip } from './db';

/** Build real clips from what was actually uploaded */
function makeClipsFromFile(opts: {
  filename:    string;
  durationS:   number;
  aspectRatio: string;
}): Clip[] {
  const { filename, durationS } = opts;
  const base = filename.replace(/\.[^.]+$/, ''); // strip extension
  const ext  = (filename.split('.').pop() ?? '').toLowerCase();

  const isAudio = ['mp3','wav','aac','flac','ogg','m4a','opus'].includes(ext);
  const isImage = ['jpg','jpeg','png','gif','webp','heic','avif'].includes(ext);

  if (isImage) {
    // Single image clip — no duration meaningful
    return [
      { id: uuid(), trackId: 'video', label: base, startS: 0, endS: 10, type: 'video' },
    ];
  }

  if (isAudio) {
    return [
      { id: uuid(), trackId: 'aud1', label: filename, startS: 0, endS: durationS, type: 'audio' },
    ];
  }

  // Video — single video track only (audio is embedded in the video clip)
  return [
    { id: uuid(), trackId: 'video', label: base, startS: 0, endS: durationS, type: 'video' as const },
  ];
}

export function createProject(opts: {
  userId:      string;
  title:       string;
  filename:    string;
  sizeMb:      number;
  prompt:      string;
  aspectRatio: string;
  durationS?:  number;
  width?:      number;
  height?:     number;
  thumbnail?:  string;
}): Project {
  const now = new Date().toISOString();
  const dur = opts.durationS ?? 0;
  const project: Project = {
    id:          uuid(),
    userId:      opts.userId,
    title:       opts.title,
    filename:    opts.filename,
    status:      'uploading',
    durationS:   dur,
    aspectRatio: opts.aspectRatio,
    thumbnail:   opts.thumbnail ?? '',
    prompt:      opts.prompt,
    clips:       [],
    aiHistory:   [{
      role: 'ai',
      // Honest: we've received the footage and read its metadata; the actual
      // analysis (loudness/silence measurement, speech-to-text, moments) runs
      // now in Studio. We never claim to have analysed it before we have.
      text: dur > 0
        ? `Received "${opts.filename}" — ${formatDuration(dur)}. I'm analysing the footage now.`
        : `Uploaded "${opts.filename}". What would you like me to do?`,
      ts:   now,
    }],
    createdAt:   now,
    updatedAt:   now,
    exportedAt:  null,
    sizeMb:      opts.sizeMb,
  };
  return db.projects.create(project);
}

/**
 * Mark a project as processing. Called when footage is received; the real
 * analysis runs client-side in Studio, which calls {@link markProjectReady}
 * once the pipeline has actually produced an edit. There is deliberately no
 * timer that pretends work finished — 'ready' only ever reflects a real result.
 */
export function markProjectProcessing(projectId: string) {
  db.projects.update(projectId, { status: 'processing' });
}

/**
 * Called by Studio when the real edit pipeline has finished building a result.
 * Lays down the single honest source clip (the uploaded footage) if no clips
 * have been touched yet, and flips status to 'ready' so the dashboard reflects
 * reality.
 */
export function markProjectReady(projectId: string, source?: {
  filename?: string; durationS?: number; aspectRatio?: string;
}) {
  const current = db.projects.findById(projectId);
  if (!current) return;
  const touched = (current.clips?.length ?? 0) > 0;
  const baseClips = (!touched && source?.filename)
    ? { clips: makeClipsFromFile({
        filename:    source.filename,
        durationS:   source.durationS ?? current.durationS,
        aspectRatio: source.aspectRatio ?? current.aspectRatio,
      }) }
    : {};
  db.projects.update(projectId, { status: 'ready', updatedAt: new Date().toISOString(), ...baseClips });
}

export function formatDuration(s: number): string {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

export function summariseProject(p: Project) {
  return {
    id:          p.id,
    title:       p.title,
    filename:    p.filename,
    status:      p.status,
    durationS:   p.durationS,
    aspectRatio: p.aspectRatio,
    thumbnail:   p.thumbnail ?? '',
    sizeMb:      p.sizeMb,
    createdAt:   p.createdAt,
    updatedAt:   p.updatedAt,
    exportedAt:  p.exportedAt,
    clipCount:   p.clips.length,
  };
}
