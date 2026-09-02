'use client';
import React, { useState } from 'react';
import { Play, MoreHorizontal, Clock, Cpu } from 'lucide-react';
import { Badge } from '../ui/Badge';
import Link from 'next/link';

// Fixed waveform so SSR and client match exactly
const THUMB_WAVEFORM = Array.from({ length: 40 }, (_, i) =>
  `${Math.abs(Math.sin(i * 0.4)) * 65 + 10}%`
);

export interface Project {
  id: string; title: string; duration: string; lastEdited: string;
  status: 'ready' | 'processing' | 'draft'; thumbnail?: string;
}

const statusConfig = {
  ready:      { label: 'Ready',      variant: 'success' as const },
  processing: { label: 'Processing', variant: 'ai'      as const, dot: true },
  draft:      { label: 'Draft',      variant: 'default' as const },
};

export function ProjectCard({ project }: { project: Project }) {
  const status = statusConfig[project.status];
  const [hovered, setHovered] = useState(false);

  return (
    <Link href={`/studio/${project.id}`} style={{ textDecoration: 'none' }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: '#101014',
          border: `1px solid ${hovered ? '#8B5CF6' : '#26262E'}`,
          borderRadius: 16, overflow: 'hidden',
          transform: hovered ? 'translateY(-2px)' : 'none',
          boxShadow: hovered ? '0 16px 40px rgba(139,92,246,0.18)' : '0 6px 20px rgba(0,0,0,0.28)',
          transition: 'all 200ms ease',
          cursor: 'pointer',
        }}
      >
        {/* Thumbnail */}
        <div style={{ position: 'relative', aspectRatio: '16/9', background: 'linear-gradient(135deg,#0A0A0A 0%,#181818 50%,#111 100%)' }}>
          {/* Waveform */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, display: 'flex', alignItems: 'flex-end', gap: 1, padding: '0 12px 4px' }}>
            {THUMB_WAVEFORM.map((h, i) => (
              <div key={i} style={{ flex: 1, borderRadius: 2, height: h, background: 'rgba(255,255,255,0.06)' }} />
            ))}
          </div>

          {/* Play overlay */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: hovered ? 1 : 0, transition: 'opacity 200ms',
          }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Play size={14} fill="white" color="white" style={{ marginLeft: 2 }} />
            </div>
          </div>

          {/* Status */}
          <div style={{ position: 'absolute', top: 10, right: 10 }}>
            <Badge variant={status.variant} size="sm" dot={(status as { dot?: boolean }).dot}>
              {status.label}
            </Badge>
          </div>

          {/* Processing overlay */}
          {project.status === 'processing' && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Cpu size={14} style={{ color: '#A78BFA', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 12, color: '#A78BFA', fontWeight: 600 }}>AI editing...</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#FAFAFA', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {project.title}
            </h3>
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#737D8D', padding: 2, borderRadius: 4, display: 'flex', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#FAFAFA'; e.currentTarget.style.background = '#1E1E26'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#737D8D'; e.currentTarget.style.background = 'none'; }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#737D8D' }}>
              <Play size={10} />{project.duration}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#737D8D' }}>
              <Clock size={10} />{project.lastEdited}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function EmptyProjectState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: '#101014', border: '1px solid #242424', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Play size={22} style={{ color: '#737D8D' }} />
      </div>
      <h3 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 650, fontSize: 18, letterSpacing: '-0.03em', color: '#FAFAFA', margin: '0 0 8px' }}>
        Your next edit starts here.
      </h3>
      <p style={{ fontSize: 13, color: '#737D8D', margin: '0 0 24px' }}>Create a video and let AI do the editing.</p>
      <Link href="/new" style={{ textDecoration: 'none' }}>
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '0 20px', height: 42, fontSize: 13, fontWeight: 600,
          background: 'linear-gradient(180deg,#8B5CF6,#7C3AED)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer',
        }}>
          Create video
        </button>
      </Link>
    </div>
  );
}
