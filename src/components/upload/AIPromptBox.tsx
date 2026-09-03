'use client';
import React, { useState } from 'react';
import { ArrowRight, AlignLeft, Zap, Clock } from 'lucide-react';

const PLACEHOLDER = 'Make this fast-paced, remove mistakes and long pauses, add captions, and keep the strongest moments.';

export function AIPromptBox({ onEdit }: { onEdit: (prompt: string, opts: Record<string, string>) => void }) {
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('16:9');
  const [captions, setCaptions] = useState(true);
  const [style, setStyle] = useState('natural');
  const [length, setLength] = useState('auto');

  const pill = (active: boolean) => ({
    padding: '5px 10px', borderRadius: 7, fontSize: 12, border: 'none', cursor: 'pointer',
    background: active ? '#181818' : 'transparent',
    color: active ? '#FFFFFF' : '#666',
    transition: 'all 150ms',
  } as React.CSSProperties);

  const pillGroup = {
    display: 'flex', background: '#0A0A0A', borderRadius: 9, padding: 3,
    border: '1px solid #242424',
  } as React.CSSProperties;

  return (
    <div style={{ background: '#111111', border: '1px solid #242424', borderRadius: 16, overflow: 'hidden' }}>
      <textarea
        value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder={PLACEHOLDER} rows={4}
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none',
          padding: '20px 20px 12px', fontSize: 14, color: '#FFFFFF',
          fontFamily: "'Inter', sans-serif", resize: 'none', lineHeight: 1.6,
        }}
      />

      <div style={{ height: 1, background: '#242424' }} />

      {/* Controls */}
      <div style={{ padding: '12px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        {/* Aspect */}
        <div style={pillGroup}>
          {['16:9', '9:16', '1:1'].map(a => (
            <button key={a} onClick={() => setAspect(a)} style={pill(aspect === a)}>{a}</button>
          ))}
        </div>

        {/* Captions */}
        <button onClick={() => setCaptions(!captions)} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
          border: `1px solid ${captions ? 'rgba(255,255,255,0.3)' : '#242424'}`,
          background: captions ? 'rgba(255,255,255,0.1)' : 'transparent',
          color: captions ? '#FAFAFA' : '#666', transition: 'all 150ms',
        }}>
          <AlignLeft size={12} /> Captions
        </button>

        {/* Style */}
        <div style={pillGroup}>
          {['natural', 'punchy'].map(s => (
            <button key={s} onClick={() => setStyle(s)} style={{
              ...pill(style === s),
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {s === 'punchy' && <Zap size={10} />}{s}
            </button>
          ))}
        </div>

        {/* Length */}
        <div style={pillGroup}>
          {['auto', '60s', '3 min'].map(l => (
            <button key={l} onClick={() => setLength(l)} style={{
              ...pill(length === l),
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {l === 'auto' && <Clock size={10} />}{l}
            </button>
          ))}
        </div>

        {/* Submit */}
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={() => onEdit(prompt, { aspect, captions: String(captions), style, length })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0 20px', height: 42, fontSize: 14, fontWeight: 600,
              background: '#FAFAFA', color: '#050505', border: 'none', borderRadius: 10,
              cursor: 'pointer', transition: 'all 150ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#D4D4D8'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#FAFAFA'; e.currentTarget.style.transform = ''; }}
          >
            Edit video <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
