/**
 * Real video export — turn the composited programme into a downloadable file.
 *
 * It records exactly what the editor previews. A hidden PreviewEngine renders
 * the finished edit to an offscreen canvas at the chosen resolution; that
 * canvas streams its frames (captureStream), and the source media's audio is
 * tapped through WebAudio into a MediaStreamDestination. MediaRecorder muxes
 * the two into a container (MP4 where the browser supports it, else WebM) and
 * we hand back the Blob plus a progress signal.
 *
 * Constraints, stated plainly:
 *   • Recording runs in real time — a 60s edit takes ~60s to export. Faster
 *     than real-time would need WebCodecs/ffmpeg.
 *   • Resolution never upscales past the source frame.
 *   • Audio is the source media track; the canvas composited video only.
 * Nothing here talks to the network.
 */
import { PreviewEngine } from './engine';
import type { Sequence } from './sequence';

export interface ExportOptions {
  sequence:      Sequence;
  /** Object URL (or data URL) of the source media, keyed by sourceId. */
  sourceUrl:     string;
  sourceId:      string;
  /** Longest edge in pixels (1080 → 1920×1080 landscape, etc). */
  resLongEdge:   number;
  /** Frames per second to capture. */
  fps:           number;
  /** Video bitrate in bits/second. */
  videoBits:     number;
  /** Hint 'mp4' if the user picked MP4, 'webm' otherwise. */
  preferFormat?: 'mp4' | 'webm';
  /** Called 0..1 as the export progresses (by time, not bytes). */
  onProgress?:   (p: number) => void;
}

export interface ExportResult {
  blob:      Blob;
  /** 'mp4' or 'webm' — what MediaRecorder actually produced. */
  extension: 'mp4' | 'webm';
  mimeType:  string;
  durationS: number;
}

const MIME_CANDIDATES = {
  mp4: [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ],
  webm: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ],
} as const;

function pickMime(prefer: 'mp4' | 'webm'): { mimeType: string; extension: 'mp4' | 'webm' } | null {
  const order = prefer === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4'];
  for (const kind of order) {
    for (const m of MIME_CANDIDATES[kind as 'mp4' | 'webm']) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) {
        return { mimeType: m, extension: kind as 'mp4' | 'webm' };
      }
    }
  }
  return null;
}

/** Guard so the export button can be disabled honestly where unsupported. */
export function exportSupported(): boolean {
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

export async function renderToFile(opts: ExportOptions): Promise<ExportResult> {
  if (!exportSupported()) {
    throw new Error('This browser cannot record a video here (needs captureStream + MediaRecorder).');
  }

  const { sequence, sourceUrl, sourceId, fps, videoBits } = opts;
  const durationS = Math.max(0.1, sequence.durationS);

  // Create everything synchronously first, in the user-gesture call chain, so
  // the AudioContext and video playback aren't blocked by autoplay policy.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(host);

  const canvas = document.createElement('canvas');
  host.appendChild(canvas);

  const engine = new PreviewEngine();
  engine.mount(host);
  engine.attach(canvas);

  const picked = pickMime(opts.preferFormat ?? 'mp4')
    ?? { mimeType: '', extension: 'webm' as const };

  const audioCtx = new AudioContext();
  const audioDest = audioCtx.createMediaStreamDestination();
  const unwireAudio = engine.wireAudio(audioCtx, audioDest);

  // Render at the requested resolution, but never upscale past the source.
  engine.setSequence(sequence, opts.resLongEdge);
  engine.setSource(sourceId, sourceUrl);

  // Let the media decode and the first frame settle before we start.
  await new Promise<void>((resolve) => {
    let tries = 0;
    const tick = () => {
      engine.renderFrame();
      const ready = engine.stats.decoded > 0 || tries > 40;
      if (ready) return resolve();
      tries++;
      setTimeout(tick, 100);
    };
    setTimeout(tick, 150);
  });

  const canvasStream = engine.captureStream(fps);
  if (!canvasStream) {
    cleanup();
    throw new Error('Could not start a canvas stream for recording.');
  }

  // Combine video (canvas) + audio (source media via WebAudio).
  const tracks = [
    ...canvasStream.getVideoTracks(),
    ...audioDest.stream.getAudioTracks(),
  ];
  const combined = new MediaStream(tracks);

  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = picked.mimeType
      ? new MediaRecorder(combined, { mimeType: picked.mimeType, videoBitsPerSecond: videoBits, audioBitsPerSecond: 160_000 })
      : new MediaRecorder(combined, { videoBitsPerSecond: videoBits, audioBitsPerSecond: 160_000 });
  } catch (e) {
    cleanup();
    throw e instanceof Error ? e : new Error('MediaRecorder refused these settings.');
  }
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const done = new Promise<ExportResult>((resolve, reject) => {
    let finished = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      if (watchdog) clearTimeout(watchdog);
      engine.pause();
      try { recorder.state !== 'inactive' && recorder.stop(); } catch {}
      try { canvasStream.getTracks().forEach(t => t.stop()); } catch {}
      try { audioCtx.close(); } catch {}
      cleanup();
      if (err) return reject(err);
      const blob = new Blob(chunks, { type: picked.mimeType || 'video/webm' });
      if (blob.size === 0) return reject(new Error('The recording produced no data.'));
      opts.onProgress?.(1);
      resolve({ blob, extension: picked.extension, mimeType: blob.type, durationS });
    };

    recorder.onerror = () => finish(new Error('The video recorder failed mid-export.'));
    recorder.onstop = () => finish();

    // Progress is driven by real playback time; the engine emits the end.
    engine.onEnd(() => setTimeout(() => finish(), 400));
    engine.onTime((t) => opts.onProgress?.(Math.min(0.999, t / durationS)));

    // Safety net: never hang forever if the end event is somehow missed.
    watchdog = setTimeout(() => finish(new Error('Export timed out.')), (durationS + 20) * 1000);

    recorder.start(250);
    engine.seek(0);
    void audioCtx.resume();
    void engine.play();
  });

  function cleanup() {
    try { unwireAudio(); } catch {}
    try { engine.destroy(); } catch {}
    host.parentNode?.removeChild(host);
  }

  return done;
}

/** Trigger a browser download of an exported blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Rough human size for the result card. */
export function describeBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
