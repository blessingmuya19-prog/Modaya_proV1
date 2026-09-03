'use client';
/**
 * React wrapper around the PreviewEngine.
 *
 * Renders the composited canvas and keeps it in step with the editor's
 * transport state. The engine owns playback time; this component only relays
 * outside-initiated seeks, and guards against echoing the engine's own
 * reports back at it (that feedback loop is what used to stutter).
 */
import React, { useEffect, useRef } from 'react';
import { PreviewEngine } from '@/lib/render/engine';
import { Sequence } from '@/lib/render/sequence';

interface Props {
  sequence:  Sequence;
  sourceUrl: string | null;
  sourceId:  string;
  /** Additional media objects clips may read from — a B-roll library:
   *  source id → object URL. The engine resolves each clip's sourceId. */
  extraSources?: Record<string, string>;
  playing:   boolean;
  playheadS: number;
  onTime:    (t: number) => void;
  /** The engine paused — mirror it, but leave the playhead alone. */
  onPaused:  () => void;
  /** Playback reached the end of the programme. */
  onEnded:   () => void;
  style?:    React.CSSProperties;
}

export default function PreviewCanvas({
  sequence, sourceUrl, sourceId, extraSources, playing, playheadS, onTime, onPaused, onEnded, style,
}: Props) {
  const hostRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const echoed    = useRef(-1);
  const onTimeRef = useRef(onTime);
  const onEndRef  = useRef(onEnded);
  const onPauseRef = useRef(onPaused);
  onTimeRef.current  = onTime;
  onEndRef.current   = onEnded;
  onPauseRef.current = onPaused;

  // Create once
  useEffect(() => {
    if (!canvasRef.current || !hostRef.current) return;
    let engine: PreviewEngine | null = null;
    let offTime = () => {};
    let offState = () => {};
    let offEnd = () => {};

    try {
      engine = new PreviewEngine();
      engineRef.current = engine;
      engine.mount(hostRef.current);
      engine.attach(canvasRef.current);

      offTime = engine.onTime(t => {
        echoed.current = t;
        onTimeRef.current(t);
      });
      offState = engine.onState(p => { if (!p) onPauseRef.current(); });
      offEnd   = engine.onEnd(() => onEndRef.current());
    } catch (e) {
      console.warn('PreviewEngine initialization failed', e);
    }

    return () => {
      offTime(); offState(); offEnd();
      try { engine?.destroy(); } catch {}
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    try { engineRef.current?.setSequence(sequence); } catch {}
  }, [sequence]);

  useEffect(() => {
    try {
      if (sourceUrl) engineRef.current?.setSource(sourceId, sourceUrl);
    } catch {}
  }, [sourceId, sourceUrl]);

  // B-roll library objects — registered whenever the set changes identity.
  useEffect(() => {
    if (!extraSources) return;
    try {
      for (const [id, url] of Object.entries(extraSources)) {
        if (url) engineRef.current?.setSource(id, url);
      }
    } catch {}
  }, [extraSources]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    try {
      if (playing) void e.play(); else e.pause();
    } catch {}
  }, [playing]);

  // Only follow the playhead when the change came from outside the engine
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    try {
      if (Math.abs(playheadS - echoed.current) < 0.05) return;
      if (Math.abs(e.time - playheadS) < 0.05) return;
      e.seek(playheadS);
    } catch {}
  }, [playheadS]);

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      <canvas
        ref={canvasRef}
        data-modaya-canvas
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
      />
    </div>
  );
}
