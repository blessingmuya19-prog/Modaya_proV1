'use client';
import { useState, useEffect, useCallback } from 'react';

export interface ProjectSummary {
  id:          string;
  title:       string;
  filename:    string;
  status:      'uploading' | 'processing' | 'ready' | 'draft' | 'failed';
  durationS:   number;
  aspectRatio: string;
  sizeMb:      number;
  createdAt:   string;
  updatedAt:   string;
  exportedAt:  string | null;
  clipCount:   number;
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to load projects');
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const deleteProject = useCallback(async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setProjects(ps => ps.filter(p => p.id !== id));
  }, []);

  const renameProject = useCallback(async (id: string, title: string) => {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      setProjects(ps => ps.map(p => p.id === id ? { ...p, title } : p));
    }
  }, []);

  return { projects, loading, error, refetch: fetch_, deleteProject, renameProject };
}

// Format duration seconds → "3:32"
export function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Format relative time
export function fmtRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}
