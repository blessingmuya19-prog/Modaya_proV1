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
import { buildWebmBlob, buildMp4Blob, type EncodedChunk } from './muxer';

export interface ExportOptions {
  sequence:      Sequence;
  /** Object URL (or data URL) of the source media, keyed by sourceId. */
  sourceUrl:     string;
  sourceId:      string;
  /** Additional media objects the sequence reads — a B-roll library:
   *  source id → object URL. Cutaway clips resolve through these. */
  extraSources?: Record<string, string>;
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
  /** 'mp4' or 'webm' — what container was actually produced. */
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

/** Check if hardware-accelerated WebCodecs is available in this browser. */
export function webCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

/** Guard so the export button can be disabled honestly where unsupported. */
export function exportSupported(): boolean {
  return (
    webCodecsSupported() ||
    (
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      typeof MediaRecorder !== 'undefined' &&
      typeof AudioContext !== 'undefined'
    )
  );
}

/**
 * Fast offline WebCodecs export. Steps through sequence frames at maximum
 * hardware encoding speed rather than waiting on real-time playback.
 */
async function renderWithWebCodecs(opts: ExportOptions): Promise<ExportResult> {
  const { sequence, sourceUrl, sourceId, fps, videoBits, preferFormat = 'mp4' } = opts;
  const durationS = Math.max(0.1, sequence.durationS);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(host);

  const canvas = document.createElement('canvas');
  host.appendChild(canvas);

  const engine = new PreviewEngine();
  engine.mount(host);
  engine.attach(canvas);

  engine.setSequence(sequence, opts.resLongEdge);
  engine.setSource(sourceId, sourceUrl);
  for (const [id, url] of Object.entries(opts.extraSources ?? {})) {
    if (url) engine.setSource(id, url);
  }

  // Calculate pixel dimensions
  const scale = Math.min(1, opts.resLongEdge / Math.max(sequence.width, sequence.height));
  let width = Math.max(2, Math.round(sequence.width * scale));
  let height = Math.max(2, Math.round(sequence.height * scale));
  // Video encoders require even dimensions
  if (width % 2 !== 0) width--;
  if (height % 2 !== 0) height--;

  canvas.width = width;
  canvas.height = height;

  const chunks: EncodedChunk[] = [];
  let avcCDecoderConfig: Uint8Array | undefined;

  // Codec candidates based on format preference
  const candidateCodecs = preferFormat === 'mp4'
    ? ['avc1.42E01E', 'avc1.4D401E', 'avc1.640028', 'vp09.00.10.08', 'vp8']
    : ['vp09.00.10.08', 'vp8', 'avc1.42E01E', 'av01.0.04M.08'];

  let chosenCodec = candidateCodecs[0];
  for (const c of candidateCodecs) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: c,
        width,
        height,
        bitrate: videoBits,
        framerate: fps,
      });
      if (support && support.supported) {
        chosenCodec = c;
        break;
      }
    } catch {
      continue;
    }
  }

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        data,
        timestampUs: chunk.timestamp,
        type: chunk.type,
        track: 'video',
      });
      if (metadata?.decoderConfig?.description) {
        avcCDecoderConfig = new Uint8Array(metadata.decoderConfig.description as ArrayBuffer);
      }
    },
    error: (e) => {
      console.warn('VideoEncoder error:', e);
    },
  });

  encoder.configure({
    codec: chosenCodec,
    width,
    height,
    bitrate: videoBits,
    framerate: fps,
  });

  const totalFrames = Math.max(1, Math.round(durationS * fps));
  const dt = 1 / fps;

  try {
    for (let i = 0; i < totalFrames; i++) {
      const t = Math.min(durationS, i * dt);
      engine.seek(t);
      engine.renderFrame();

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(t * 1_000_000),
        duration: Math.round(dt * 1_000_000),
      });

      const isKey = i % (fps * 2) === 0;
      encoder.encode(frame, { keyFrame: isKey });
      frame.close();

      opts.onProgress?.(Math.min(0.99, (i + 1) / totalFrames));

      // Yield event loop every few frames for UI responsiveness
      if (i % 15 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    encoder.close();

    const isMp4 = preferFormat === 'mp4' && chosenCodec.startsWith('avc');
    let blob: Blob;

    if (isMp4) {
      blob = buildMp4Blob(chunks, {
        width,
        height,
        fps,
        durationS,
        avcC: avcCDecoderConfig,
      });
    } else {
      blob = buildWebmBlob(chunks, {
        width,
        height,
        fps,
        durationS,
        videoCodec: chosenCodec.startsWith('avc') ? 'V_MPEG4/ISO/AVC' : chosenCodec.startsWith('vp8') ? 'V_VP8' : 'V_VP9',
      });
    }

    opts.onProgress?.(1);

    return {
      blob,
      extension: isMp4 ? 'mp4' : 'webm',
      mimeType: blob.type,
      durationS,
    };
  } finally {
    try { engine.destroy(); } catch {}
    host.parentNode?.removeChild(host);
  }
}

/**
 * Real-time MediaRecorder export. Fallback for browsers without WebCodecs.
 */
async function renderWithMediaRecorder(opts: ExportOptions): Promise<ExportResult> {
  const { sequence, sourceUrl, sourceId, fps, videoBits } = opts;
  const durationS = Math.max(0.1, sequence.durationS);

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
  for (const [id, url] of Object.entries(opts.extraSources ?? {})) {
    if (url) engine.setSource(id, url);
  }

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

export async function renderToFile(opts: ExportOptions): Promise<ExportResult> {
  if (!exportSupported()) {
    throw new Error('This browser cannot record a video here (needs WebCodecs or captureStream + MediaRecorder).');
  }

  // Prefer fast hardware-accelerated WebCodecs when supported
  if (webCodecsSupported()) {
    try {
      return await renderWithWebCodecs(opts);
    } catch (e) {
      console.warn('WebCodecs export failed, falling back to MediaRecorder:', e);
      // Fallback to real-time MediaRecorder
      if (
        typeof HTMLCanvasElement !== 'undefined' &&
        typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
        typeof MediaRecorder !== 'undefined'
      ) {
        return await renderWithMediaRecorder(opts);
      }
      throw e;
    }
  }

  return renderWithMediaRecorder(opts);
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
