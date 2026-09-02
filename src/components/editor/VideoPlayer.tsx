'use client';
import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize2 } from 'lucide-react';

export function VideoPlayer() {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(28);
  const [volume, setVolume] = useState(85);
  const [hovered, setHovered] = useState(false);

  const totalSecs = 212;
  const currentSecs = Math.floor((progress / 100) * totalSecs);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const ctrlBtn = { width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#666', borderRadius: 6, transition: 'all 150ms' } as React.CSSProperties;

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#000', position: 'relative', overflow: 'hidden' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Video frame */}
      <div style={{
        position: 'relative', width: 'min(100%, 700px)',
        aspectRatio: '16/9',
        background: 'linear-gradient(135deg,#0A0A0A 0%,#111 50%,#0A0A0A 100%)',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.05)',
        boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        cursor: 'pointer',
      }} onClick={() => setPlaying(!playing)}>
        {/* Bars */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '9%', background: '#000', zIndex: 10 }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '9%', background: '#000', zIndex: 10 }} />

        {/* Fake person silhouette */}
        <div style={{ position: 'absolute', inset: '9%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 64, height: 96, background: 'rgba(255,255,255,0.025)', borderRadius: '50% 50% 0 0', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
          </div>
        </div>

        {/* Center play */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 150ms',
          }}>
            {playing ? <Pause size={18} fill="white" color="white" /> : <Play size={18} fill="white" color="white" style={{ marginLeft: 2 }} />}
          </div>
        </div>

        {/* Caption */}
        <div style={{ position: 'absolute', bottom: '14%', left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}>
          <div style={{ padding: '5px 14px', background: 'rgba(0,0,0,0.78)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, backdropFilter: 'blur(4px)' }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}>
              &ldquo;And that&apos;s the key thing you need to know.&rdquo;
            </span>
          </div>
        </div>

        {/* AI badge */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', padding: '4px 10px', borderRadius: 9999, border: '1px solid #242424' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8B5CF6' }} />
          <span style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 600 }}>AI Edit · v3</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ width: 'min(100%, 700px)', marginTop: 12, padding: '0 4px', opacity: hovered ? 1 : 0.55, transition: 'opacity 200ms' }}>
        {/* Progress */}
        <div
          style={{ position: 'relative', height: 4, background: '#181818', borderRadius: 9999, cursor: 'pointer', marginBottom: 10 }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            setProgress(((e.clientX - rect.left) / rect.width) * 100);
          }}
        >
          <div style={{ position: 'absolute', inset: 0, width: `${progress}%`, background: '#8B5CF6', borderRadius: 9999, transition: 'width 150ms' }} />
          <div style={{ position: 'absolute', top: '50%', left: `${progress}%`, transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: '#8B5CF6', boxShadow: '0 0 6px rgba(139,92,246,0.5)' }} />
        </div>

        {/* Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button style={ctrlBtn} onClick={() => setProgress(Math.max(0, progress - 5))}
            onMouseEnter={e => { e.currentTarget.style.background = '#111111'; e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#666'; }}>
            <SkipBack size={14} />
          </button>
          <button style={{ ...ctrlBtn, background: '#111111', border: '1px solid #242424', color: '#FFFFFF' }} onClick={() => setPlaying(!playing)}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button style={ctrlBtn} onClick={() => setProgress(Math.min(100, progress + 5))}
            onMouseEnter={e => { e.currentTarget.style.background = '#111111'; e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#666'; }}>
            <SkipForward size={14} />
          </button>

          <span style={{ fontSize: 11, color: '#666', marginLeft: 4 }}>{fmt(currentSecs)} / 3:32</span>

          <div style={{ flex: 1 }} />

          <Volume2 size={13} style={{ color: '#666' }} />
          <div style={{ width: 60, height: 3, background: '#242424', borderRadius: 9999, cursor: 'pointer', position: 'relative' }}
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              setVolume(((e.clientX - rect.left) / rect.width) * 100);
            }}>
            <div style={{ height: '100%', width: `${volume}%`, background: '#A1A1A1', borderRadius: 9999 }} />
          </div>

          <button style={ctrlBtn}
            onMouseEnter={e => { e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#666'; }}>
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
