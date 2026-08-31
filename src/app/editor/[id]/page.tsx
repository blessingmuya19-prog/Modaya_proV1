'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { EditorShell, EditorClip, EditorAIMsg } from '@/components/editor/EditorShell';
import { useToast } from '@/components/ui/Toast';
import { getMedia } from '@/lib/videoStore';
import { extractFrames, setProjectFrames, capturePoster, savePoster, loadPoster } from '@/lib/thumbnailStore';

const F = "'Inter Tight', Inter, system-ui, sans-serif";
const C = { bg: '#050505', muted: '#737D8D', accent: '#4F8CFF' };

interface ProjectData {
  id:          string;
  title:       string;
  durationS:   number;
  aspectRatio: string;
  status:      string;
  clips:       EditorClip[];
  aiHistory:   EditorAIMsg[];
}

export default function EditorPage() {
  const { id }       = useParams<{ id: string }>();
  const { addToast } = useToast();

  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading ] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/projects/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.project) {
          setProject({
            id:          data.project.id,
            title:       data.project.title,
            durationS:   data.project.durationS,
            aspectRatio: data.project.aspectRatio,
            status:      data.project.status,
            clips:       data.project.clips    ?? [],
            aiHistory:   data.project.aiHistory ?? [],
          });
        } else {
          // Demo fallback for non-API ids (e.g. proj-1 direct links)
          setProject({
            id,
            title:       'Demo Project',
            durationS:   1578,
            aspectRatio: '16:9',
            status:      'ready',
            clips:       [],
            aiHistory:   [{
              role: 'ai',
              text: "I've analysed your footage — 26:18 total. I can see 4 sections that could be cut. What would you like me to do?",
              ts:   new Date().toISOString(),
            }],
          });
        }
        // Kick off thumbnail extraction in the background
        const media = getMedia(id);
        if (media?.objectUrl && media.durationS > 0) {
          const frameCount = Math.min(40, Math.max(8, Math.ceil(media.durationS / 5)));
          // Publish partial results so the strip fills in as frames decode
          extractFrames(
            media.objectUrl, media.durationS, frameCount, 96, 54,
            partial => setProjectFrames(id, [...partial]),
          )
            .then(frames => setProjectFrames(id, frames))
            .catch(() => {});
        }

        // Back-fill the project poster if the server never got one at upload
        if (media?.objectUrl && media.mediaType === 'video' && !data?.project?.thumbnail) {
          const cached = loadPoster(id);
          const work = cached ? Promise.resolve(cached) : capturePoster(media.objectUrl);
          work.then(url => {
            if (!url) return;
            savePoster(id, url);
            fetch(`/api/projects/${id}`, {
              method:  'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ thumbnail: url }),
            }).catch(() => {});
          }).catch(() => {});
        }
        setLoading(false);
      })
      .catch(() => {
        setProject({
          id,
          title:       'Demo Project',
          durationS:   1578,
          aspectRatio: '16:9',
          status:      'ready',
          clips:       [],
          aiHistory:   [{
            role: 'ai',
            text: "I've analysed your footage — 26:18 total. I can see 4 sections that could be cut. What would you like me to do?",
            ts:   new Date().toISOString(),
          }],
        });
        setLoading(false);
      });
  }, [id]);

  // onAIAction is kept for compatibility but the panel now handles its own API call
  const handleAIAction = (_msg: string) => { void _msg; };

  if (loading) {
    return (
      <div style={{ height: '100vh', background: C.bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 12, fontFamily: F }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%',
          border: `2px solid ${C.accent}`, borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: C.muted }}>Loading project…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  return (
    <EditorShell
      projectId={id}
      projectName={project!.title}
      onAIAction={handleAIAction}
      clips={project!.clips}
      durationS={project!.durationS}
      aiHistory={project!.aiHistory}
    />
  );
}
