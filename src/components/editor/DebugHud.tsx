'use client';
/**
 * Opt-in diagnostic overlay for the editor.  Add ?debug=1 to the editor URL.
 *
 * It renders nothing unless explicitly enabled, so normal use is unaffected.
 * It reports the things that determine whether the timeline and playback can
 * possibly work: is there a real video, is the video actually advancing, is
 * the playhead tracking it, can the timeline scroll at all, and how many
 * thumbnail frames have been decoded.
 */
import React, { useEffect, useState } from 'react';
import { getProjectFrames } from '@/lib/thumbnailStore';

interface Reading {
  source:    string;
  videoT:    string;
  ready:     string;
  dropped:   string;
  playhead:  string;
  scroll:    string;
  frames:    string;
  fps:       string;
}

export default function DebugHud({ projectId }: { projectId?: string }) {
  const [on, setOn] = useState(false);
  const [r, setR]   = useState<Reading | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOn(q.get('debug') === '1');
  }, []);

  useEffect(() => {
    if (!on) return;

    // Render frames-per-second of the React tree, sampled continuously
    let ticks = 0;
    let raf = 0;
    const count = () => { ticks++; raf = requestAnimationFrame(count); };
    raf = requestAnimationFrame(count);

    const id = setInterval(() => {
      const v    = document.querySelector('video') as HTMLVideoElement | null;
      const cv   = document.querySelector('[data-modaya-canvas]') as HTMLCanvasElement | null;
      const tl   = document.querySelector('[data-modaya-timeline]') as HTMLElement | null;
      const ph   = document.querySelector('[data-modaya-playhead]') as HTMLElement | null;
      const frames = projectId ? getProjectFrames(projectId) : [];
      const filled = frames.filter(Boolean).length;

      let dropped = 'n/a';
      try {
        const q = v?.getVideoPlaybackQuality?.();
        if (q) dropped = `${q.droppedVideoFrames} / ${q.totalVideoFrames}`;
      } catch { /* unsupported */ }

      setR({
        source:   cv ? `canvas compositor ${cv.width}x${cv.height}` : v?.src ? 'raw video element' : 'MOCK — no video',
        videoT:   v ? `${v.currentTime.toFixed(2)}s  ${v.paused ? '(paused)' : '(playing)'}` : '—',
        ready:    v ? `readyState ${v.readyState}  net ${v.networkState}` : '—',
        dropped,
        playhead: ph ? `${Math.round(parseFloat(ph.style.left || '0'))}px` : '—',
        scroll:   tl ? `${Math.round(tl.scrollLeft)} / ${tl.scrollWidth}px  view ${tl.clientWidth}px  ${tl.scrollWidth > tl.clientWidth + 2 ? 'SCROLLABLE' : 'fits — nothing to scroll'}` : '—',
        frames:   frames.length ? `${filled} / ${frames.length} decoded` : 'none extracted',
        fps:      `${ticks} fps`,
      });
      ticks = 0;
    }, 1000);

    return () => { clearInterval(id); cancelAnimationFrame(raf); };
  }, [on, projectId]);

  if (!on || !r) return null;

  const row = (k: string, v: string) => (
    <div style={{ display: 'flex', gap: 8, lineHeight: 1.5 }}>
      <span style={{ color: '#7c8798', minWidth: 74 }}>{k}</span>
      <span style={{ color: '#e6e9ef' }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      position: 'fixed', bottom: 10, left: 10, zIndex: 9999,
      background: 'rgba(0,0,0,0.88)', border: '1px solid #2a3140', borderRadius: 8,
      padding: '10px 12px', font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
      pointerEvents: 'none', maxWidth: 460,
    }}>
      <div style={{ color: '#4F8CFF', fontWeight: 700, marginBottom: 4 }}>MODAYA DIAGNOSTICS</div>
      {row('source',   r.source)}
      {row('video',    r.videoT)}
      {row('buffer',   r.ready)}
      {row('dropped',  r.dropped)}
      {row('playhead', r.playhead)}
      {row('timeline', r.scroll)}
      {row('frames',   r.frames)}
      {row('render',   r.fps)}
    </div>
  );
}
