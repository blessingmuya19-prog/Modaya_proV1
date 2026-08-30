'use client';
import React, { useState } from 'react';
import { Scissors, Trash2, Zap, Star, Crop, AlignLeft, Sliders, ArrowRight } from 'lucide-react';

const aiActions = [
  { id: 'tighten', icon: Scissors, label: 'Tighten',          desc: 'Remove unnecessary pauses.',         accent: false },
  { id: 'cleanup', icon: Trash2,   label: 'Clean up',          desc: 'Remove mistakes and repetitions.',    accent: false },
  { id: 'faster',  icon: Zap,      label: 'Make faster',       desc: 'Increase pacing throughout.',         accent: false },
  { id: 'moments', icon: Star,     label: 'Find best moments', desc: 'Identify the strongest sections.',    accent: true  },
  { id: 'reframe', icon: Crop,     label: 'Reframe',           desc: 'Auto-adjust framing for 9:16.',       accent: false },
  { id: 'captions',icon: AlignLeft,label: 'Captions',          desc: 'Generate timed captions.',            accent: false },
  { id: 'custom',  icon: Sliders,  label: 'Custom',            desc: 'Describe your own edit.',             accent: false },
];

export function AIEditPanel({ onAction }: { onAction: (id: string, prompt?: string) => void }) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleAction = (id: string) => {
    setActiveAction(id);
    onAction(id, id === 'custom' ? customPrompt : undefined);
    setTimeout(() => setActiveAction(null), 2200);
  };

  return (
    <div style={{
      width: 200, flexShrink: 0,
      background: '#0A0A0A', borderRight: '1px solid #242424',
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #242424', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4F8CFF' }} />
        <span style={{ fontSize: 10, color: '#666', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>AI Edit</span>
      </div>

      {/* Actions */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {aiActions.map(action => {
          const Icon = action.icon;
          const isActive = activeAction === action.id;
          return (
            <button
              key={action.id}
              onClick={() => handleAction(action.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                padding: '10px 12px', borderRadius: 8, border: 'none', textAlign: 'left', cursor: 'pointer',
                background: isActive ? 'rgba(79,140,255,0.1)' : action.accent ? 'rgba(79,140,255,0.05)' : 'transparent',
                outline: isActive ? '1px solid rgba(79,140,255,0.35)' : action.accent ? '1px solid rgba(79,140,255,0.15)' : '1px solid transparent',
                transition: 'all 150ms',
              }}
              onMouseEnter={e => {
                if (!isActive && !action.accent) {
                  e.currentTarget.style.background = '#111111';
                  e.currentTarget.style.outline = '1px solid #242424';
                }
              }}
              onMouseLeave={e => {
                if (!isActive && !action.accent) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.outline = '1px solid transparent';
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon size={13} style={{ color: isActive || action.accent ? '#4F8CFF' : '#666', flexShrink: 0 }} />
                <span style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 650, fontSize: 12, color: isActive || action.accent ? '#4F8CFF' : '#A1A1A1' }}>
                  {action.label}
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#666', lineHeight: 1.4, margin: 0, paddingLeft: 21 }}>{action.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Custom input */}
      <div style={{ padding: 10, borderTop: '1px solid #242424' }}>
        <textarea
          value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
          placeholder="Describe your edit..."
          rows={3}
          style={{
            width: '100%', background: '#111111', border: '1px solid #242424',
            borderRadius: 8, padding: '8px 10px', fontSize: 11,
            color: '#FFFFFF', outline: 'none', resize: 'none',
            fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#333'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#242424'; }}
        />
        <button
          onClick={() => handleAction('custom')}
          disabled={!customPrompt.trim()}
          style={{
            marginTop: 6, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '7px', fontSize: 11, fontWeight: 600,
            background: customPrompt.trim() ? '#4F8CFF' : '#181818',
            color: customPrompt.trim() ? '#050505' : '#444',
            border: 'none', borderRadius: 6, cursor: customPrompt.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 150ms',
          }}
        >
          Apply <ArrowRight size={11} />
        </button>
      </div>
    </div>
  );
}
