'use client';
import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { ProgressBar } from '../ui/ProgressBar';
import { Download, ExternalLink, CheckCircle } from 'lucide-react';

type State = 'configure' | 'rendering' | 'done';

export function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<State>('configure');
  const [resolution, setResolution] = useState('1080p');
  const [aspect, setAspect] = useState('16:9');
  const [quality, setQuality] = useState('high');
  const [progress, setProgress] = useState(0);

  const handleExport = () => {
    setState('rendering');
    setProgress(0);
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 8 + 2;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(() => setState('done'), 400); }
      setProgress(p);
    }, 200);
  };

  const handleClose = () => { setState('configure'); setProgress(0); onClose(); };

  const optBtn = (active: boolean, onClick: () => void, label: string) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        flex: 1, padding: '10px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
        border: `1px solid ${active ? 'rgba(79,140,255,0.4)' : '#242424'}`,
        background: active ? 'rgba(79,140,255,0.08)' : '#111111',
        color: active ? '#4F8CFF' : '#A1A1A1',
        transition: 'all 150ms',
      }}
    >
      {label}
    </button>
  );

  return (
    <Modal open={open} onClose={handleClose}>
      {state === 'configure' && (
        <div>
          <h3 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.03em', color: '#FFFFFF', margin: '0 0 4px' }}>
            Export video
          </h3>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 24px' }}>Podcast Episode 14 · 3:32</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <p style={{ fontSize: 11, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Resolution</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {['1080p', '4K'].map(r => optBtn(resolution === r, () => setResolution(r), r))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Aspect ratio</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {['16:9', '9:16', '1:1'].map(a => optBtn(aspect === a, () => setAspect(a), a))}
              </div>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Quality</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {['standard', 'high'].map(q => optBtn(quality === q, () => setQuality(q), q.charAt(0).toUpperCase() + q.slice(1)))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#181818', border: '1px solid #242424', borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: '#666' }}>Format</span>
              <span style={{ fontSize: 13, color: '#A1A1A1', fontWeight: 600 }}>MP4</span>
            </div>
          </div>

          <button onClick={handleExport} style={{
            marginTop: 24, width: '100%', padding: '13px', fontSize: 14, fontWeight: 600,
            background: '#4F8CFF', color: '#050505', border: 'none', borderRadius: 10, cursor: 'pointer', transition: 'all 150ms',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#6EA3FF'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#4F8CFF'; }}
          >
            Export video
          </button>
        </div>
      )}

      {state === 'rendering' && (
        <div style={{ padding: '16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4F8CFF', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
            <span style={{ fontSize: 10, color: '#4F8CFF', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Rendering</span>
          </div>
          <h3 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.03em', color: '#FFFFFF', margin: '0 0 6px' }}>
            Rendering your video...
          </h3>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 24px' }}>{resolution} · {aspect} · {quality} quality</p>
          <ProgressBar value={progress} />
          <p style={{ fontSize: 11, color: '#666', textAlign: 'right', marginTop: 6 }}>{Math.round(progress)}%</p>
        </div>
      )}

      {state === 'done' && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'rgba(20,83,45,0.4)', border: '1px solid rgba(22,101,52,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', animation: 'scale-in 0.3s cubic-bezier(0.22,1,0.36,1)',
          }}>
            <CheckCircle size={22} style={{ color: '#4ade80' }} />
          </div>
          <h3 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.03em', color: '#FFFFFF', margin: '0 0 6px' }}>
            Your video is ready.
          </h3>
          <p style={{ fontSize: 13, color: '#666', margin: '0 0 24px' }}>
            Podcast Episode 14 · {resolution} · 3:32 · {aspect}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px', fontSize: 13, fontWeight: 600, background: '#4F8CFF', color: '#050505', border: 'none', borderRadius: 10, cursor: 'pointer' }}>
              <Download size={14} /> Download
            </button>
            <button onClick={handleClose} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px', fontSize: 13, fontWeight: 500, background: '#181818', color: '#FFFFFF', border: '1px solid #242424', borderRadius: 10, cursor: 'pointer' }}>
              <ExternalLink size={14} /> Open in editor
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
