'use client';
/**
 * Studio route — the default Modaya experience. Drop footage (and a reference),
 * Modaya does the editing, get a finished video with one-tap export. The full
 * timeline lives one click away at /editor/[id] for power users.
 *
 * `?mode=edit|reference` (set by the /new picker) only focuses the drop
 * screen — the editor itself is identical either way.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Studio from '@/components/studio/Studio';

export default function StudioPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params?.id ?? '';
  const mode = (search?.get('mode') === 'reference' ? 'reference' : 'edit') as 'edit' | 'reference';
  const [title, setTitle] = useState('New project');

  useEffect(() => {
    if (!id) return;
    fetch(`/api/projects/${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.project?.title) setTitle(d.project.title); })
      .catch(() => {});
  }, [id]);

  return <Studio projectId={id} projectName={title} mode={mode} />;
}
