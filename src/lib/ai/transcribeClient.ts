/**
 * Client-side transcription helper: decode media to 16 kHz mono, split into
 * quiet-boundary chunks, upload to the Whisper endpoint, and stitch the lines
 * back together. Used by the Studio flow so captions are the real spoken
 * words. Returns null when there is no speech service / nothing heard — the
 * caller degrades silently rather than failing the edit.
 */
import { decodeForAsr, chunkForAsr } from './audioForAsr';
import type { TranscriptLine } from '../studio/editPlan';

export interface TranscribeProgress { (message: string): void }

export async function transcribeMedia(
  projectId: string,
  blob: Blob,
  durationS: number,
  onProgress?: TranscribeProgress,
): Promise<TranscriptLine[] | null> {
  try {
    const samples = await decodeForAsr(blob);
    if (!samples || samples.length === 0) return null;
    const chunks = chunkForAsr(samples);

    const lines: TranscriptLine[] = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(chunks.length > 1 ? `Listening… part ${i + 1} of ${chunks.length}` : 'Listening to the audio…');
      const form = new FormData();
      form.append('audio', chunks[i].blob, 'audio.wav');
      form.append('offsetS', String(chunks[i].offsetS));
      form.append('durationS', String(durationS));

      const res = await fetch(`/api/projects/${projectId}/transcribe`, { method: 'POST', body: form });
      if (!res.ok) return lines.length ? lines : null;
      const data = await res.json().catch(() => null) as { segments?: Array<{ startS?: number; start?: number; endS?: number; end?: number; text?: string }> } | null;
      for (const sg of data?.segments ?? []) {
        const startS = Number(sg.startS ?? sg.start ?? 0);
        const endS = Number(sg.endS ?? sg.end ?? 0);
        const text = String(sg.text ?? '').trim();
        if (text && endS > startS) lines.push({ startS, endS, text });
      }
    }
    lines.sort((a, b) => a.startS - b.startS);
    return lines;
  } catch {
    return null;
  }
}
