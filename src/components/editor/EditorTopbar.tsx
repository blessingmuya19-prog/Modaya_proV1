'use client';
import React, { useState } from 'react';
import { Logo } from '../ui/Logo';
import { ChevronDown, Download, Undo2, Redo2, ArrowLeft, ChevronRight } from 'lucide-react';
import { ExportModal } from './ExportModal';
import Link from 'next/link';

const versions = [
  { id: 'v3', label: 'v3 — Tightened',  time: 'just now'   },
  { id: 'v2', label: 'v2 — Cleaned up', time: '8 min ago'  },
  { id: 'v1', label: 'v1 — Original',   time: '22 min ago' },
];

export function EditorTopbar({ projectName }: { projectName: string }) {
  const [exportOpen,       setExportOpen      ] = useState(false);
  const [versionOpen,      setVersionOpen     ] = useState(false);
  const [selectedVersion,  setSelectedVersion ] = useState('v3');

  return (
    <>
      <header style={{
        height: 50, display: 'flex', alignItems: 'center',
        borderBottom: '1px solid #111', background: '#070707',
        padding: '0 12px', flexShrink: 0, gap: 6, position: 'relative', zIndex: 40,
      }}>

        {/* ── EXIT BUTTON — clear and prominent ── */}
        <Link href="/dashboard" style={{ textDecoration: 'none' }}>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8,
            background: '#0e0e0e', border: '1px solid #1e1e1e',
            fontSize: 12, fontWeight: 500, color: '#888',
            cursor: 'pointer', transition: 'all 150ms', flexShrink: 0,
          }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#141414';
              e.currentTarget.style.color = '#FFFFFF';
              e.currentTarget.style.borderColor = '#2a2a2a';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#0e0e0e';
              e.currentTarget.style.color = '#888';
              e.currentTarget.style.borderColor = '#1e1e1e';
            }}
          >
            <ArrowLeft size={13} />
            <span>Dashboard</span>
          </button>
        </Link>

        <div style={{ width: 1, height: 20, background: '#141414', flexShrink: 0 }} />

        {/* Logo */}
        <Logo size={22} />

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <ChevronRight size={12} style={{ color: '#2a2a2a', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
            {projectName}
          </span>
        </div>

        {/* Version badge */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setVersionOpen(!versionOpen)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            fontSize: 11, fontWeight: 600, color: '#4F8CFF',
            background: 'rgba(79,140,255,0.08)', border: '1px solid rgba(79,140,255,0.2)',
            borderRadius: 7, cursor: 'pointer', transition: 'all 120ms',
          }}>
            {selectedVersion} <ChevronDown size={10} />
          </button>
          {versionOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0,
              width: 200, background: '#111', border: '1px solid #1e1e1e',
              borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
              zIndex: 100, padding: 4, animation: 'slide-up 0.15s ease',
            }}>
              {versions.map(v => (
                <button key={v.id} onClick={() => { setSelectedVersion(v.id); setVersionOpen(false); }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', fontSize: 12, background: 'none', border: 'none',
                  cursor: 'pointer', borderRadius: 7,
                  color: selectedVersion === v.id ? '#4F8CFF' : '#777',
                  transition: 'all 120ms',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                >
                  <span>{v.label}</span>
                  <span style={{ fontSize: 10, color: '#2a2a2a' }}>{v.time}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Undo / Redo */}
        {([['Undo', Undo2], ['Redo', Redo2]] as const).map(([tip, Icon]) => (
          <button key={tip} title={tip} style={{
            width: 30, height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer', color: '#2a2a2a', transition: 'all 120ms',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#111'; e.currentTarget.style.color = '#777'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#2a2a2a'; }}
          >
            <Icon size={13} />
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: '#141414', flexShrink: 0 }} />

        {/* Export */}
        <button onClick={() => setExportOpen(true)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '0 18px', height: 34, fontSize: 13, fontWeight: 600,
          background: '#4F8CFF', color: '#fff', border: 'none',
          borderRadius: 8, cursor: 'pointer', flexShrink: 0,
          boxShadow: '0 2px 12px rgba(79,140,255,0.25)',
          transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#6EA3FF'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#4F8CFF'; e.currentTarget.style.transform = ''; }}
        >
          <Download size={12} /> Export
        </button>
      </header>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}
