'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Grid3x3, List, Plus, SlidersHorizontal, Pencil, Trash2, Check, X, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useProjects, fmtDuration, fmtRelative, ProjectSummary } from '@/lib/useProjects';
import { capturePoster, savePoster, loadPoster } from '@/lib/thumbnailStore';
import { getMedia } from '@/lib/videoStore';

const F = "'Inter Tight', Inter, system-ui, sans-serif";
const C = {
  bg: '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b: '#111', b2: '#141414', b3: '#1a1a1a',
  text: '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  accent: '#4F8CFF', accentH: '#6EA3FF', danger: '#f87171', dangerBg: 'rgba(248,113,113,0.08)',
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  ready:      { bg: 'rgba(52,211,153,0.1)',  color: '#34D399', label: 'Ready'      },
  processing: { bg: 'rgba(79,140,255,0.1)',  color: '#4F8CFF', label: 'Processing' },
  uploading:  { bg: 'rgba(79,140,255,0.07)', color: '#4F8CFF', label: 'Uploading'  },
  draft:      { bg: 'rgba(115,125,141,0.1)', color: '#737D8D', label: 'Draft'      },
  failed:     { bg: 'rgba(248,113,113,0.1)', color: '#f87171', label: 'Failed'     },
};

const filters = ['all', 'ready', 'processing', 'draft'] as const;
type Filter = typeof filters[number];

// ── Delete confirm modal ──────────────────────────────────────────────────────

function DeleteConfirmModal({
  project,
  onConfirm,
  onCancel,
  deleting,
}: {
  project:   ProjectSummary;
  onConfirm: () => void;
  onCancel:  () => void;
  deleting:  boolean;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'fadeIn 120ms ease',
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="del-title"
        style={{
          position: 'fixed', zIndex: 1001,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '100%', maxWidth: 420,
          background: '#0c0c0c',
          border: '1px solid #1e1e1e',
          borderRadius: 16,
          padding: '28px 28px 24px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          animation: 'scaleIn 140ms cubic-bezier(0.34,1.56,0.64,1)',
          fontFamily: F,
        }}
      >
        {/* Icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: C.dangerBg, border: `1px solid rgba(248,113,113,0.2)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 18,
        }}>
          <AlertTriangle size={20} color={C.danger} strokeWidth={1.75} />
        </div>

        {/* Heading */}
        <h2 id="del-title" style={{
          fontSize: 18, fontWeight: 700, letterSpacing: '-0.025em',
          color: C.text, margin: '0 0 8px',
        }}>
          Delete project?
        </h2>

        {/* Body */}
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.55, margin: '0 0 6px' }}>
          <span style={{ color: C.sec, fontWeight: 600 }}>"{project.title}"</span> will be
          permanently removed. This action cannot be undone.
        </p>

        {/* File meta */}
        <p style={{ fontSize: 12, color: C.dim, margin: '0 0 28px' }}>
          {project.filename} · {fmtDuration(project.durationS)}
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              flex: 1, height: 40, fontFamily: F, fontSize: 14, fontWeight: 600,
              letterSpacing: '-0.01em', background: '#141414', color: C.sec,
              border: '1px solid #1e1e1e', borderRadius: 10, cursor: 'pointer',
              transition: 'all 120ms', opacity: deleting ? 0.5 : 1,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1a1a1a'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#141414'; }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              flex: 1, height: 40, fontFamily: F, fontSize: 14, fontWeight: 600,
              letterSpacing: '-0.01em',
              background: deleting ? '#1a0f0f' : 'rgba(248,113,113,0.12)',
              color: deleting ? C.dim : C.danger,
              border: `1px solid ${deleting ? '#1e1e1e' : 'rgba(248,113,113,0.3)'}`,
              borderRadius: 10, cursor: deleting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              transition: 'all 120ms',
            }}
            onMouseEnter={e => { if (!deleting) { e.currentTarget.style.background = 'rgba(248,113,113,0.2)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.5)'; } }}
            onMouseLeave={e => { if (!deleting) { e.currentTarget.style.background = 'rgba(248,113,113,0.12)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)'; } }}
          >
            {deleting
              ? <><div style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Deleting…</>
              : <><Trash2 size={13} /> Delete forever</>
            }
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes scaleIn { from { opacity: 0; transform: translate(-50%,-50%) scale(0.94) } to { opacity: 1; transform: translate(-50%,-50%) scale(1) } }
      `}</style>
    </>
  );
}

// ── Inline rename input ───────────────────────────────────────────────────────

function RenameInput({ value, onSave, onCancel }: {
  value: string; onSave(v: string): void; onCancel(): void;
}) {
  const [val, setVal] = useState(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.preventDefault()}>
      <input autoFocus value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel(); }}
        style={{ flex: 1, background: C.s3, border: `1px solid ${C.accent}55`, borderRadius: 6,
          padding: '4px 8px', fontFamily: F, fontSize: 13, fontWeight: 600, color: C.text,
          outline: 'none', letterSpacing: '-0.01em' }}
      />
      <button onClick={() => onSave(val)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#34D399', display: 'flex' }}><Check size={13}/></button>
      <button onClick={onCancel}          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex' }}><X size={13}/></button>
    </div>
  );
}

/** Stable per-project gradient so a thumbnail-less card still looks intentional. */
function placeholderBg(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 42% 12%), hsl(${(h + 40) % 360} 38% 7%))`;
}

// ── Project card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, viewMode, onRequestDelete, onRename }: {
  project:         ProjectSummary;
  viewMode:        'grid' | 'list';
  onRequestDelete: (p: ProjectSummary) => void;
  onRename:        (id: string, title: string) => void;
}) {
  const [hovered,  setHovered ] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [poster,   setPoster  ] = useState(project.thumbnail || '');
  const [mediaUrl, setMediaUrl] = useState('');

  // Poster resolution: server record → local cache → capture from in-tab media.
  // A freshly captured frame is cached and pushed back to the server so the
  // card keeps its thumbnail on every future visit and device.
  useEffect(() => {
    if (poster) return;

    const cached = loadPoster(project.id);
    if (cached) { setPoster(cached); return; }

    const media = getMedia(project.id);
    if (!media?.objectUrl || media.mediaType !== 'video') return;

    // Show the video element immediately; canvas capture may still be running
    setMediaUrl(media.objectUrl);

    let cancelled = false;
    capturePoster(media.objectUrl).then(url => {
      if (!url || cancelled) return;
      setPoster(url);
      savePoster(project.id, url);
      fetch(`/api/projects/${project.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ thumbnail: url }),
      }).catch(() => { /* card still shows the local poster */ });
    });
    return () => { cancelled = true; };
  }, [project.id, poster]);
  const badge   = STATUS_BADGE[project.status] ?? STATUS_BADGE.draft;
  const isReady = project.status === 'ready';

  const card = (
    <div
      style={{
        background: C.surface, border: `1px solid ${hovered ? C.b3 : C.b2}`,
        borderRadius: 12, overflow: 'hidden', transition: 'all 150ms',
        cursor: isReady ? 'pointer' : 'default',
        display: 'flex', flexDirection: viewMode === 'list' ? 'row' : 'column',
        alignItems: viewMode === 'list' ? 'center' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail */}
      <div style={{
        background: '#0A0E14', flexShrink: 0,
        height: viewMode === 'list' ? 52 : 120,
        width:  viewMode === 'list' ? 88 : '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
        overflow: 'hidden',
      }}>
        {poster ? (
          <>
            {/* Blurred fill so a vertical clip keeps its shape instead of being cropped */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={poster}
              alt=""
              aria-hidden
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', filter: 'blur(14px) brightness(0.45)', transform: 'scale(1.15)',
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={poster}
              alt=""
              style={{
                position: 'relative', maxWidth: '100%', maxHeight: '100%',
                width: 'auto', height: '100%', objectFit: 'contain', display: 'block',
              }}
            />
          </>
        ) : mediaUrl ? (
          // Canvas capture unavailable (e.g. HEVC) — let the browser paint the frame
          <video
            src={`${mediaUrl}#t=0.5`}
            muted
            playsInline
            preload="metadata"
            style={{ maxWidth: '100%', maxHeight: '100%', height: '100%', width: 'auto',
              objectFit: 'contain', display: 'block' }}
          />
        ) : (
          // Nothing decodable available — deterministic placeholder, never a blank box
          <>
            <div style={{ position: 'absolute', inset: 0, background: placeholderBg(project.id) }} />
            <span style={{
              fontFamily: F, fontWeight: 700,
              fontSize: viewMode === 'list' ? 18 : 30,
              color: 'rgba(255,255,255,0.16)', letterSpacing: '-0.03em', userSelect: 'none',
            }}>
              {(project.title || '?').trim().charAt(0).toUpperCase()}
            </span>
          </>
        )}

        {/* Format badge */}
        <span style={{
          position: 'absolute', bottom: 6, right: 6,
          fontFamily: F, fontSize: viewMode === 'list' ? 8 : 9, fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'rgba(255,255,255,0.92)',
          background: 'rgba(0,0,0,0.6)',
          padding: '2px 6px',
          borderRadius: 5,
        }}>
          {project.aspectRatio}
        </span>
      </div>

      {/* Info */}
      <div style={{ flex: 1, padding: viewMode === 'list' ? '0 14px' : '12px 14px 14px', minWidth: 0 }}>
        {renaming ? (
          <RenameInput value={project.title}
            onSave={v => { onRename(project.id, v); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <p style={{ fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.025em',
            color: C.text, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.title}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: F, fontSize: 11, color: C.muted }}>
            {fmtDuration(project.durationS)} · {fmtRelative(project.updatedAt)}
          </span>
          <span style={{ fontFamily: F, fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
            padding: '2px 7px', borderRadius: 9999, background: badge.bg, color: badge.color }}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* Actions — visible on hover */}
      {hovered && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4,
            padding: viewMode === 'list' ? '0 12px 0 0' : '0 10px 10px', flexShrink: 0 }}
          onClick={e => e.preventDefault()}
        >
          <button
            onClick={() => setRenaming(true)}
            title="Rename"
            style={{ width: 28, height: 28, borderRadius: 7, background: C.s3, border: `1px solid ${C.b3}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: C.muted, transition: 'all 120ms' }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.muted; }}
          ><Pencil size={11}/></button>

          <button
            onClick={() => onRequestDelete(project)}
            title="Delete"
            style={{ width: 28, height: 28, borderRadius: 7, background: C.s3, border: `1px solid ${C.b3}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: C.muted, transition: 'all 120ms' }}
            onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.background = C.dangerBg; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = C.s3; e.currentTarget.style.borderColor = C.b3; }}
          ><Trash2 size={11}/></button>
        </div>
      )}
    </div>
  );

  return isReady ? (
    <Link href={`/editor/${project.id}`} style={{ textDecoration: 'none' }}>{card}</Link>
  ) : card;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: C.s3, border: `1px solid ${C.b3}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Grid3x3 size={22} color={C.dim} />
      </div>
      <p style={{ fontFamily: F, fontSize: 16, fontWeight: 600, letterSpacing: '-0.025em', color: C.text, margin: '0 0 6px' }}>
        {filtered ? 'No projects match that filter' : 'No projects yet'}
      </p>
      <p style={{ fontFamily: F, fontSize: 13, color: C.muted, margin: '0 0 24px' }}>
        {filtered ? 'Try a different filter.' : 'Upload your first video to get started.'}
      </p>
      {!filtered && (
        <Link href="/new" style={{ textDecoration: 'none' }}>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 38,
            fontFamily: F, fontSize: 13, fontWeight: 600, background: C.accent, color: '#fff',
            border: 'none', borderRadius: 9, cursor: 'pointer' }}>
            <Plus size={13}/> Start an edit
          </button>
        </Link>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { projects, loading, error, deleteProject, renameProject } = useProjects();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter,   setFilter  ] = useState<Filter>('all');
  const [search,   setSearch  ] = useState('');

  // Delete modal state
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [deleting,      setDeleting     ] = useState(false);

  const handleRequestDelete = useCallback((p: ProjectSummary) => {
    setPendingDelete(p);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    await deleteProject(pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
  }, [pendingDelete, deleteProject]);

  const handleCancelDelete = useCallback(() => {
    if (deleting) return; // don't close while in-flight
    setPendingDelete(null);
  }, [deleting]);

  const filtered = projects.filter(p => {
    const matchFilter = filter === 'all' || p.status === filter;
    const matchSearch = !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.filename.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  return (
    <div className="dashboard-content" style={{ minHeight: '100%', animation: 'page-fade-up 380ms cubic-bezier(0.22,1,0.36,1) both' }}>

      {/* Header */}
      <div className="dashboard-header-row">
        <div>
          <h1 style={{ fontFamily: F, fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em',
            color: C.text, margin: '0 0 4px' }}>Projects</h1>
          <p style={{ fontFamily: F, fontSize: 12, color: C.muted, margin: 0 }}>
            {loading ? '…' : `${projects.length} video${projects.length !== 1 ? 's' : ''}`}
            {projects.length > 0 && !loading && ` · last edited ${fmtRelative(projects[0]?.updatedAt)}`}
          </p>
        </div>
        <Link href="/new" style={{ textDecoration: 'none' }}>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 38,
            fontFamily: F, fontSize: 13, fontWeight: 600, background: C.accent, color: '#fff',
            border: 'none', borderRadius: 9, cursor: 'pointer', boxShadow: `0 2px 12px ${C.accent}33`,
            transition: 'all 150ms' }}
            onMouseEnter={e => { e.currentTarget.style.background = C.accentH; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.accent; }}
          ><Plus size={13} strokeWidth={2.5}/> New edit</button>
        </Link>
      </div>

      {/* Filter row */}
      <div className="dashboard-filter-row">
        <div style={{ position: 'relative', flex: 1, maxWidth: 280, minWidth: 0 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            style={{ width: '100%', background: C.s3, border: `1px solid ${C.b3}`, borderRadius: 8,
              padding: '7px 14px', fontFamily: F, fontSize: 13, color: C.text, outline: 'none',
              boxSizing: 'border-box', transition: 'border-color 150ms' }}
            onFocus={e => { e.currentTarget.style.borderColor = C.accent + '55'; }}
            onBlur={e  => { e.currentTarget.style.borderColor = C.b3; }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', background: C.s2, border: `1px solid ${C.b2}`, borderRadius: 9, padding: 3, gap: 2 }}>
            {filters.map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '5px 11px', borderRadius: 7, fontFamily: F, fontSize: 12, fontWeight: 500,
                border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                background: filter === f ? C.b3 : 'transparent',
                outline:    filter === f ? `1px solid ${C.b3}` : 'none',
                color:      filter === f ? C.text : C.muted, transition: 'all 120ms',
              }}>{f}</button>
            ))}
          </div>

          <button style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: F, fontSize: 12,
            color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 7 }}>
            <SlidersHorizontal size={12}/> Sort
          </button>

          <div style={{ display: 'flex', border: `1px solid ${C.b2}`, borderRadius: 7, overflow: 'hidden' }}>
            {([['grid', Grid3x3], ['list', List]] as const).map(([mode, Icon]) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                padding: '6px 9px', display: 'flex', alignItems: 'center',
                background: viewMode === mode ? C.b3 : 'transparent',
                border: 'none', cursor: 'pointer',
                color: viewMode === mode ? C.text : C.muted, transition: 'all 120ms',
              }}><Icon size={14}/></button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className={viewMode === 'grid' ? 'project-grid-auto' : ''}
          style={viewMode === 'list' ? { display: 'flex', flexDirection: 'column', gap: 8 } : {}}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              borderRadius: 12, overflow: 'hidden',
              border: `1px solid ${C.b2}`, background: C.surface,
              display: 'flex', flexDirection: viewMode === 'list' ? 'row' : 'column',
              animationDelay: `${i * 60}ms`,
            }}>
              <div className="shimmer" style={{
                height: viewMode === 'list' ? 52 : 120,
                width: viewMode === 'list' ? 88 : '100%',
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, padding: viewMode === 'list' ? '0 14px' : '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                <div className="shimmer" style={{ height: 13, width: '65%', borderRadius: 6 }} />
                <div className="shimmer" style={{ height: 10, width: '40%', borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div style={{ padding: '32px', fontFamily: F, fontSize: 13, color: '#f87171' }}>
          Failed to load: {error}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filtered={filter !== 'all' || !!search} />
      ) : (
        <div
          className={viewMode === 'grid' ? 'project-grid-auto' : ''}
          style={viewMode === 'list' ? { display: 'flex', flexDirection: 'column', gap: 8 } : {}}
        >
          {filtered.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              viewMode={viewMode}
              onRequestDelete={handleRequestDelete}
              onRename={renameProject}
            />
          ))}
        </div>
      )}

      {/* Delete confirm modal — rendered at page level so it overlays everything */}
      {pendingDelete && (
        <DeleteConfirmModal
          project={pendingDelete}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
          deleting={deleting}
        />
      )}

      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes page-fade-up { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
      `}</style>
    </div>
  );
}
