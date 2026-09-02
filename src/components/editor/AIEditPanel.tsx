'use client';
import React, { useState } from 'react';
import { Scissors, Trash2, Zap, Star, Crop, AlignLeft, Sliders, ChevronRight, RotateCcw } from 'lucide-react';

const aiActions = [
  { id: 'tighten',  icon: Scissors,  label: 'Tighten edit',      desc: 'Remove unnecessary pauses and dead air.'     },
  { id: 'cleanup',  icon: Trash2,    label: 'Clean up mistakes',  desc: 'Remove filler words and repetitions.'        },
  { id: 'faster',   icon: Zap,       label: 'Make faster',        desc: 'Increase overall pacing.'                   },
  { id: 'moments',  icon: Star,      label: 'Best moments',       desc: 'Keep only the strongest sections.',  highlight: true },
  { id: 'reframe',  icon: Crop,      label: 'Reframe 9:16',       desc: 'Crop and reframe for vertical.'             },
  { id: 'captions', icon: AlignLeft, label: 'Add captions',       desc: 'Generate timed, accurate captions.'         },
  { id: 'custom',   icon: Sliders,   label: 'Custom edit',        desc: 'Type your own instruction.'                 },
];

const VERSIONS = [
  { id: 'v3', label: 'v3 — Tightened',   time: 'Now'     },
  { id: 'v2', label: 'v2 — Cleaned up',  time: '8 min ago' },
  { id: 'v1', label: 'v1 — Original',    time: '22 min ago' },
];

export function AIEditPanel({ onAction }: { onAction: (id: string, prompt?: string) => void }) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState('v3');
  const [showCustom, setShowCustom] = useState(false);

  const handle = (id: string) => {
    if (id === 'custom') { setShowCustom(true); return; }
    setActiveAction(id);
    onAction(id);
    setTimeout(() => setActiveAction(null), 2400);
  };

  const submitCustom = () => {
    if (!customPrompt.trim()) return;
    setActiveAction('custom');
    onAction('custom', customPrompt);
    setCustomPrompt('');
    setShowCustom(false);
    setTimeout(() => setActiveAction(null), 2400);
  };

  return (
    <div style={{
      width: 220, flexShrink: 0,
      background: '#070707', borderRight: '1px solid #111',
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #111', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8B5CF6' }} />
        <span style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>AI Edit</span>
      </div>

      {/* Version history */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #0e0e0e' }}>
        <p style={{ fontSize: 10, color: '#2a2a2a', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', margin: '0 0 6px' }}>Version</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {VERSIONS.map(v => (
            <button key={v.id} onClick={() => setActiveVersion(v.id)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', textAlign: 'left',
              background: activeVersion === v.id ? '#111' : 'transparent',
              transition: 'background 120ms',
            }}
              onMouseEnter={e => { if (activeVersion !== v.id) e.currentTarget.style.background = '#0a0a0a'; }}
              onMouseLeave={e => { if (activeVersion !== v.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 12, color: activeVersion === v.id ? '#FFFFFF' : '#444', fontWeight: activeVersion === v.id ? 500 : 400 }}>{v.label}</span>
              <span style={{ fontSize: 10, color: '#2a2a2a' }}>{v.time}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        <p style={{ fontSize: 10, color: '#2a2a2a', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', margin: '0 4px 6px' }}>Actions</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {aiActions.map(action => {
            const Icon = action.icon;
            const isActive = activeAction === action.id;
            return (
              <button key={action.id} onClick={() => handle(action.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 10px', borderRadius: 8, border: 'none', textAlign: 'left', cursor: 'pointer',
                background: isActive ? 'rgba(139,92,246,0.1)' : action.highlight ? 'rgba(139,92,246,0.04)' : 'transparent',
                outline: action.highlight && !isActive ? '1px solid rgba(139,92,246,0.1)' : 'none',
                transition: 'all 150ms',
              }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#0e0e0e'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = action.highlight ? 'rgba(139,92,246,0.04)' : 'transparent'; }}
              >
                <Icon size={13} style={{ color: isActive ? '#8B5CF6' : action.highlight ? '#8B5CF6' : '#333', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: isActive ? '#8B5CF6' : action.highlight ? '#7AABFF' : '#888', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{action.label}</p>
                </div>
                {isActive
                  ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8B5CF6', animation: 'pulse-dot 1.2s ease-in-out infinite', flexShrink: 0 }} />
                  : <ChevronRight size={10} style={{ color: '#222', flexShrink: 0 }} />
                }
              </button>
            );
          })}
        </div>

        {/* Custom prompt box */}
        {showCustom && (
          <div style={{ marginTop: 10, padding: '10px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 10 }}>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="Describe your edit..."
              autoFocus
              rows={3}
              style={{
                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                fontSize: 12, color: '#FFFFFF', fontFamily: "'Inter',sans-serif",
                resize: 'none', lineHeight: 1.6, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => { setShowCustom(false); setCustomPrompt(''); }} style={{ flex: 1, padding: '6px', fontSize: 11, background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#444', cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitCustom} disabled={!customPrompt.trim()} style={{ flex: 1, padding: '6px', fontSize: 11, fontWeight: 600, background: customPrompt.trim() ? '#8B5CF6' : '#111', border: 'none', borderRadius: 6, color: '#fff', cursor: customPrompt.trim() ? 'pointer' : 'not-allowed' }}>Apply</button>
            </div>
          </div>
        )}
      </div>

      {/* Undo */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #0e0e0e' }}>
        <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 6, width: '100%', transition: 'all 120ms' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.background = '#0e0e0e'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#333'; e.currentTarget.style.background = 'none'; }}
        >
          <RotateCcw size={12} /> Undo last edit
        </button>
      </div>
    </div>
  );
}
