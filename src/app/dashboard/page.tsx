'use client';
import React, { useState } from 'react';
import { ProjectCard, EmptyProjectState } from '@/components/dashboard/ProjectCard';
import type { Project } from '@/components/dashboard/ProjectCard';
import { Grid3x3, List, Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';

const mockProjects: Project[] = [
  { id: 'proj-1', title: 'Podcast Episode 14',       duration: '3:32',  lastEdited: '12 minutes ago', status: 'ready' },
  { id: 'proj-2', title: 'Product Demo — July 2026', duration: '8:15',  lastEdited: '2 hours ago',    status: 'processing' },
  { id: 'proj-3', title: 'Team Update Q3',            duration: '12:40', lastEdited: 'Yesterday',      status: 'draft' },
  { id: 'proj-4', title: 'Interview with Sarah Chen', duration: '45:20', lastEdited: '3 days ago',     status: 'ready' },
  { id: 'proj-5', title: 'Tutorial: Getting Started', duration: '6:05',  lastEdited: '1 week ago',     status: 'ready' },
];

const filters = ['all', 'ready', 'processing', 'draft'] as const;
type Filter = typeof filters[number];

export default function DashboardPage() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = mockProjects.filter(p => filter === 'all' || p.status === filter);

  const filterBtn = (f: Filter) => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, border: 'none', cursor: 'pointer',
    background: filter === f ? '#181818' : 'transparent',
    border2: filter === f ? '1px solid #242424' : '1px solid transparent',
    outline: filter === f ? '1px solid #242424' : '1px solid transparent',
    color: filter === f ? '#FFFFFF' : '#666',
    transition: 'all 150ms', textTransform: 'capitalize' as const,
  });

  const iconBtn = (active: boolean) => ({
    padding: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? '#111111' : 'transparent', border: 'none', cursor: 'pointer',
    color: active ? '#FFFFFF' : '#666', transition: 'all 150ms',
  });

  return (
    <div style={{ padding: '32px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 28, letterSpacing: '-0.04em', color: '#FFFFFF', margin: '0 0 4px' }}>
            Projects
          </h1>
          <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Your videos, all in one place.</p>
        </div>
        <Link href="/upload" style={{ textDecoration: 'none' }}>
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 42, fontSize: 13, fontWeight: 600,
            background: '#4F8CFF', color: '#050505', border: 'none', borderRadius: 10, cursor: 'pointer', transition: 'all 150ms',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#6EA3FF'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#4F8CFF'; e.currentTarget.style.transform = ''; }}
          >
            <Plus size={14} /> New video
          </button>
        </Link>
      </div>

      {/* Filters + view */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', background: '#111111', border: '1px solid #242424', borderRadius: 10, padding: 3 }}>
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={filterBtn(f)}>{f}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#111111'; e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#666'; }}
          >
            <SlidersHorizontal size={13} /> Sort
          </button>
          <div style={{ display: 'flex', border: '1px solid #242424', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setViewMode('grid')} style={iconBtn(viewMode === 'grid')}><Grid3x3 size={14} /></button>
            <button onClick={() => setViewMode('list')} style={iconBtn(viewMode === 'list')}><List size={14} /></button>
          </div>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <EmptyProjectState />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: viewMode === 'grid' ? 'repeat(auto-fill,minmax(240px,1fr))' : '1fr',
          gap: 16,
        }}>
          {filtered.map(project => <ProjectCard key={project.id} project={project} />)}
        </div>
      )}
    </div>
  );
}
