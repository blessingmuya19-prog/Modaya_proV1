'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { EditorShell, EditorClip, EditorAIMsg } from '@/components/editor/EditorShell';
import { useToast } from '@/components/ui/Toast';
import { getMedia, setMedia, analyseFile } from '@/lib/videoStore';
import { extractFrames, setProjectFrames, capturePoster, savePoster, loadPoster } from '@/lib/thumbnailStore';
import { loadFrames, saveFrames, saveMediaFile } from '@/lib/mediaDb';
import { getProjectMedia } from '@/lib/mediaCloud';

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


/**
 * Make the project's media available to the editor.
 *
 * 1. Use the in-tab blob if the user just uploaded (fastest path).
 * 2. Otherwise rehydrate the file from IndexedDB — this is what makes a
 *    refreshed / reopened project play for real instead of falling back to
 *    the mock preview with no timeline frames.
 * 3. Paint the timeline strip from the cached frames immediately, and only
 *    decode new ones when there's no cache.
 */
async function prepareMedia(id: string, serverThumb?: string) {
  let media = getMedia(id);

  if (!media?.objectUrl) {
    const stored = await getProjectMedia(id);
    if (stored) {
      // Server copy carries bytes but not probed metadata; re-derive it so
      // frame extraction and the timeline have real duration/dimensions.
      let meta = { width: stored.width, height: stored.height,
        aspectRatio: stored.aspectRatio, durationS: stored.durationS };
      if (!stored.durationS) {
        const file = new File([stored.blob], stored.filename, { type: stored.mimeType });
        const probed = await analyseFile(file).catch(() => null);
        if (probed) meta = { width: probed.width, height: probed.height,
          aspectRatio: probed.aspectRatio, durationS: probed.durationS };
      }
      media = {
        objectUrl:   URL.createObjectURL(stored.blob),
        mimeType:    stored.mimeType,
        mediaType:   stored.mediaType,
        aspectRatio: meta.aspectRatio,
        width:       meta.width,
        height:      meta.height,
        durationS:   meta.durationS,
        filename:    stored.filename,
      };
      setMedia(id, media);          // notifies the editor shell to pick it up
      // Persist the corrected metadata so later loads (EditorShell analysis,
      // refresh) see real duration even when bytes came from the server copy.
      if (stored.durationS !== meta.durationS) {
        void saveMediaFile(id, stored.blob, {
          mimeType: stored.mimeType, mediaType: stored.mediaType,
          aspectRatio: meta.aspectRatio, width: meta.width, height: meta.height,
          durationS: meta.durationS, filename: stored.filename,
        }).catch(() => {});
      }
    }
  }
  if (!media?.objectUrl) return;

  // Cached strip first — instant, no decoding at all on a revisit
  const cached = await loadFrames(id);
  const wanted = Math.min(40, Math.max(8, Math.ceil(media.durationS / 5)));
  if (cached.length >= wanted && cached.every(Boolean)) {
    setProjectFrames(id, cached);
  } else if (media.durationS > 0) {
    if (cached.length) setProjectFrames(id, cached);   // show what we have
    extractFrames(
      media.objectUrl, media.durationS, wanted, 96, 54,
      partial => setProjectFrames(id, [...partial]),   // stream as they decode
    )
      .then(frames => {
        if (!frames.length) return;
        setProjectFrames(id, frames);
        void saveFrames(id, frames);                   // never decode this again
      })
      .catch(() => {});
  }

  // Back-fill the project poster if the server never got one at upload
  if (media.mediaType === 'video' && !serverThumb) {
    const poster = loadPoster(id) || await capturePoster(media.objectUrl).catch(() => '');
    if (poster) {
      savePoster(id, poster);
      fetch(`/api/projects/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ thumbnail: poster }),
      }).catch(() => {});
    }
  }
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
        void prepareMedia(id, data?.project?.thumbnail);
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

  /* The server generates the clip list a few seconds after upload. The editor
     used to fetch once, so a project opened before analysis finished showed an
     empty timeline until a manual refresh. Poll until the clips land. */
  useEffect(() => {
    if (!id || !project) return;
    if (project.status !== 'processing' && project.clips.length > 0) return;

    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      try {
        const r = await fetch(`/api/projects/${id}`);
        const d = r.ok ? await r.json() : null;
        const p = d?.project;
        if (p && (p.clips?.length || p.status === 'ready')) {
          setProject(prev => prev ? { ...prev, status: p.status, clips: p.clips ?? [] } : prev);
          if (p.clips?.length) clearInterval(iv);
        }
      } catch { /* keep trying */ }
      if (tries >= 30) clearInterval(iv);      // give up after ~60s
    }, 2000);
    return () => clearInterval(iv);
  }, [id, project?.status, project?.clips.length]);   // eslint-disable-line react-hooks/exhaustive-deps

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
