'use client';
import React, { useState } from 'react';
import { Logo } from '../ui/Logo';
import { Tooltip } from '../ui/Tooltip';
import { Undo2, Redo2, ChevronDown, Download } from 'lucide-react';
import { ExportModal } from './ExportModal';

const versions = [
  { id: 1, label: 'Version 1 — Original AI edit' },
  { id: 2, label: 'Version 2 — Faster pacing' },
  { id: 3, label: 'Version 3 — Shorter' },
];

export function EditorTopbar({ projectName }: { projectName: string }) {
  const [exportOpen, setExportOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(3);

  const iconBtn = (onClick?: () => void) => ({
    width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', cursor: 'pointer', color: '#666', transition: 'all 150ms',
    onClick,
  });

  return (
    <>
      <header style={{
        height: 48, background: '#0A0A0A', borderBottom: '1px solid #242424',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
      }}>
        <Logo size={22} showWordmark={false} />
        <div style={{ width: 1, height: 20, background: '#242424' }} />

        {/* Project + version */}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#FFFFFF' }}>{projectName}</span>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setVersionOpen(!versionOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: '#666', background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 8px', borderRadius: 6, transition: 'all 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#111111'; e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#666'; }}
          >
            v{selectedVersion} <ChevronDown size={11} />
          </button>
          {versionOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              width: 220, background: '#181818', border: '1px solid #242424',
              borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 50, padding: 4, animation: 'slide-up 0.2s ease',
            }}>
              {versions.map(v => (
                <button
                  key={v.id}
                  onClick={() => { setSelectedVersion(v.id); setVersionOpen(false); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12,
                    background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8,
                    color: selectedVersion === v.id ? '#4F8CFF' : '#A1A1A1',
                    transition: 'all 150ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#242424'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Undo/Redo */}
        {[{ icon: <Undo2 size={14} />, tip: 'Undo' }, { icon: <Redo2 size={14} />, tip: 'Redo' }].map(({ icon, tip }) => (
          <Tooltip key={tip} content={tip}>
            <button style={{ width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#666', transition: 'all 150ms' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#111111'; e.currentTarget.style.color = '#A1A1A1'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#666'; }}
            >
              {icon}
            </button>
          </Tooltip>
        ))}

        {/* Export */}
        <button
          onClick={() => setExportOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '0 14px', height: 34, fontSize: 13, fontWeight: 600,
            background: '#4F8CFF', color: '#050505', border: 'none', borderRadius: 8, cursor: 'pointer',
            transition: 'all 150ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#6EA3FF'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#4F8CFF'; e.currentTarget.style.transform = ''; }}
        >
          <Download size={13} /> Export
        </button>
      </header>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}
