'use client';
/**
 * Studio — the default Modaya experience.
 *
 * The product rule: the user drops footage (and, optionally, a reference
 * video) and Modaya does the editing. There is no timeline, no codec, no
 * parameters. The user watches named creative stages complete, then gets a
 * preview they can Export, Regenerate, or adjust by typing what they want
 * changed. The full timeline is one "Advanced" click away for power users.
 *
 * Every heavy lifting calls into the same engine the pro editor uses — this
 * component is only the simple surface over it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Film, Upload, Wand2, Download, RefreshCw, Sparkles, Send, SlidersHorizontal, CheckCircle2, Loader2 } from 'lucide-react';
import { LogoMark } from '../ui/Logo';
import { getMedia, setMedia, subscribeMedia, analyseFile, type MediaEntry } from '@/lib/videoStore';
import { loadMediaFile, saveMediaFile } from '@/lib/mediaDb';
import { analyseAudio, analyseReference, interestCurve } from '@/lib/ai/analyseReference';
import { generateEditPlan, type EditPlan } from '@/lib/ai/styleTransfer';
import type { StyleProfile } from '@/lib/ai/styleProfile';
import { buildSequence, type Sequence, type StyleLayer } from '@/lib/render/sequence';
import PreviewCanvas from '../editor/PreviewCanvas';
import { ExportModal } from '../editor/ExportModal';
import {
  stagesForRun, markActive, markDone, pipelineProgress, referenceMatch, resultHeadline,
  type StageState, type StageId,
} from '@/lib/studio/pipeline';
import { refineProfile } from '@/lib/studio/refine';
import type { EditorClip } from '../editor/EditorShell';

const F = "'Inter Tight', Inter, system-ui, sans-serif";
const C = {
  bg: '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b: '#111', b2: '#161616', b3: '#1d1d1d',
  accent: '#4F8CFF', accentH: '#6EA3FF',
  text: '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  green: '#34D399',
};

type Phase = 'drop' | 'working' | 'result';

function clipToEditor(c: { id: string; trackId?: string; label: string; startS: number; endS: number; type?: string; textPosition?: string; textAlign?: string }): EditorClip {
  return {
    id: c.id,
    trackId: c.trackId ?? (c.type === 'text' ? 'text' : 'video'),
    label: c.label,
    startS: c.startS, endS: c.endS,
    type: (c.type ?? 'video') as EditorClip['type'],
    textPosition: c.textPosition as EditorClip['textPosition'] | undefined,
    textAlign: c.textAlign as EditorClip['textAlign'] | undefined,
  };
}

export default function Studio({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [media, setMediaState] = useState<MediaEntry | null>(() => (projectId ? getMedia(projectId) : null));
  const setMediaEntry = useCallback((e: MediaEntry | null) => {
    if (projectId && e) setMedia(projectId, e);
    setMediaState(e);
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    setMediaState(getMedia(projectId));
    // Rehydrate from IndexedDB on a fresh tab, exactly like the pro editor.
    if (!getMedia(projectId)) {
      void loadMediaFile(projectId).then(stored => {
        if (stored && !getMedia(projectId)) {
          setMedia(projectId, {
            objectUrl: URL.createObjectURL(stored.blob),
            mimeType: stored.mimeType, mediaType: stored.mediaType, aspectRatio: stored.aspectRatio,
            width: stored.width, height: stored.height, durationS: stored.durationS, filename: stored.filename,
          });
          setMediaState(getMedia(projectId));
        }
      });
    }
    return subscribeMedia(id => { if (id === projectId) setMediaState(getMedia(projectId)); });
  }, [projectId]);

  const [phase, setPhase] = useState<Phase>('drop');
  const [stages, setStages] = useState<StageState[]>(stagesForRun(false));
  const [hasRef, setHasRef] = useState(false);
  const [refName, setRefName] = useState<string | null>(null);
  const [match, setMatch] = useState(0);
  const [headline, setHeadline] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [styleLayer, setStyleLayer] = useState<StyleLayer>({});
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [totalS, setTotalS] = useState(media?.durationS || 0);
  const [expOpen, setExpOpen] = useState(false);

  const [chats, setChats] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const refInput = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  /** Everything a regeneration needs, captured on the first run. */
  const ctxRef = useRef<{
    blob: Blob; durationS: number; onsets: number[]; interest: number[];
    baseProfile: StyleProfile; hasRef: boolean; captionsWanted: boolean;
    sourceName?: string;
  } | null>(null);
  /** The profile currently driving the edit (reference/default, then refined). */
  const profileRef = useRef<StyleProfile | null>(null);
  const seedRef = useRef(1);
  const matchRef = useRef(0);

  /** Build the EditPlan from the current profile and push it to the preview.
   *  Shared by the first run, Regenerate and every chat refinement. Returns
   *  the plan plus the grounded reference-match score. */
  const applyPlan = useCallback((profile: StyleProfile, seed: number): { plan: EditPlan; match: number } | null => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const editPlan = generateEditPlan({
      profile, durationS: ctx.durationS, sourceName: ctx.sourceName,
      onsets: ctx.onsets, interest: ctx.interest, seed,
    });
    setPlan(editPlan);
    const mapped = editPlan.clips.map(clipToEditor);
    const layer: StyleLayer = {};
    for (const c of editPlan.clips) {
      layer[c.id] = { sourceIn: c.sourceIn, transform: c.transform, effects: c.effects };
    }
    setClips(mapped);
    setStyleLayer(layer);
    setTotalS(editPlan.durationS);

    const captionClips = editPlan.clips.filter(c => c.type === 'text');
    const cutCount = Math.max(1, editPlan.cutCount || editPlan.clips.filter(c => c.type === 'video').length);
    const editCpm = (cutCount / Math.max(1, editPlan.durationS)) * 60;
    const m = referenceMatch({
      hasReference: ctx.hasRef,
      editCutsPerMin: editCpm,
      refCutsPerMin: ctx.baseProfile.cutsPerMin || editCpm,
      beatSnapRate: ctx.hasRef ? 0.7 : 0,
      refPunchInRate: ctx.baseProfile.punchInRate,
      editPunchInRate: profile.punchInRate,
      captionsWanted: ctx.captionsWanted,
      captionsPresent: !ctx.captionsWanted || captionClips.length > 0,
    });
    matchRef.current = m;
    setMatch(m);
    return { plan: editPlan, match: m };
  }, []);

  const sourceUrl = media?.objectUrl ?? null;

  const sequence: Sequence | null = useMemo(() => {
    if (!media || !clips.length) return null;
    return buildSequence(clips as never[], {
      durationS: totalS,
      width: media.width ?? 1920,
      height: media.height ?? 1080,
      sourceId: projectId || 'main',
      style: styleLayer,
    });
  }, [clips, media, totalS, projectId, styleLayer]);

  const setStage = useCallback((id: StageId, state: 'active' | 'done') => {
    setStages(prev => (state === 'active' ? markActive(prev, id) : markDone(prev, id)));
  }, []);

  /**
   * The whole creative pipeline. Each stage maps to a real engine call; the
   * user only sees the named step light up.
   */
  const run = useCallback(async (refFile?: File) => {
    if (!projectId) return;
    setError(null);
    const stored = await loadMediaFile(projectId);
    const entry = getMedia(projectId);
    const blob = stored?.blob;
    if (!blob) { setError('Upload your footage first.'); return; }

    const withRef = !!refFile;
    cancelRef.current = false;
    setHasRef(withRef);
    setRefName(refFile?.name ?? null);
    setStages(stagesForRun(withRef));
    setPhase('working');
    setChats([]);

    const tick = async (id: StageId, work: () => Promise<void> | void) => {
      if (cancelRef.current) return;
      setStage(id, 'active');
      await Promise.resolve(work());
      setStage(id, 'done');
    };

    try {
      let profile: StyleProfile | null = null as StyleProfile | null;

      // 1 — understand the source footage (audio / energy)
      let env: Awaited<ReturnType<typeof analyseAudio>> = null as Awaited<ReturnType<typeof analyseAudio>>;
      await tick('understand-source', async () => {
        env = await analyseAudio(blob).catch(() => null);
      });

      // 2 — learn the reference, if provided
      if (withRef && refFile) {
        await tick('learn-reference', async () => {
          const meta = await analyseFile(refFile).catch(() => null);
          const dur = meta?.durationS ?? refFile.size / 90000;
          const res = await analyseReference(refFile, { name: refFile.name, durationS: dur },
            () => {}).catch(() => null);
          profile = res?.profile ?? null;
        });
      }

      const durationS = stored.durationS || entry?.durationS || 60;
      const interest = interestCurve(env, durationS);
      const baseProfile: StyleProfile = profile ?? defaultPunchyProfile(durationS);

      // Capture everything a later regeneration/refinement needs.
      ctxRef.current = {
        blob, durationS,
        onsets: env?.onsets ?? [], interest,
        baseProfile, hasRef: withRef && !!profile,
        captionsWanted: baseProfile.captions.present,
        sourceName: stored.filename || entry?.filename,
      };
      profileRef.current = baseProfile;
      seedRef.current = 1;

      // 3 — find the strongest moments (drives which footage the plan keeps)
      await tick('find-moments', () => {});

      // 4+5 — match pacing/cuts and captions (the plan encodes both)
      let built: { plan: EditPlan; match: number } | null = null as { plan: EditPlan; match: number } | null;
      await tick('match-pacing', () => { built = applyPlan(baseProfile, 1); });
      await tick('captions', () => {});

      // 6 — the edit is already in state (applyPlan); just mark it.
      await tick('build-edit', () => {});

      // 7 — render the first frame; full render happens on export.
      await tick('render', () => {});

      if (cancelRef.current) return;
      setHeadline(resultHeadline({
        hasReference: ctxRef.current?.hasRef ?? false,
        match: built?.match ?? 0,
        durationS: built?.plan.durationS ?? durationS,
      }));
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong building the edit.');
      setPhase('drop');
    }
  }, [projectId, setStage]);

  // Auto-run once footage exists if the user came straight here (e.g. after upload)
  const autoRan = useRef(false);
  useEffect(() => {
    if (media && phase === 'drop' && !autoRan.current) {
      autoRan.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  const uploadFootage = useCallback(async (f: File) => {
    const meta = await analyseFile(f).catch(() => null);
    const url = URL.createObjectURL(f);
    const entry: MediaEntry = {
      objectUrl: url,
      mimeType: f.type || 'video/mp4',
      mediaType: 'video',
      aspectRatio: meta?.aspectRatio ?? '16:9',
      width: meta?.width ?? 0,
      height: meta?.height ?? 0,
      durationS: meta?.durationS ?? 0,
      filename: f.name,
    };
    setMediaEntry(entry);
    await saveMediaFile(projectId, f, {
      mimeType: entry.mimeType, mediaType: entry.mediaType, aspectRatio: entry.aspectRatio,
      width: entry.width, height: entry.height, durationS: entry.durationS, filename: entry.filename,
    }).catch(() => {});
  }, [projectId, setMediaEntry]);

  /**
   * "Tell Modaya what to change." The phrase is mapped onto the style profile
   * (pacing, punch-ins, captions, grade, length) and the EditPlan is
   * regenerated — the same brain as the first pass, so the change is real and
   * previewed immediately. No model call is needed for the common intents.
   */
  const sendRefinement = () => {
    const text = input.trim();
    if (!text || chatBusy) return;
    setChats(c => [...c, { role: 'user', text }]);
    setInput('');
    setChatBusy(true);
    try {
      const current = profileRef.current ?? ctxRef.current?.baseProfile;
      if (!current || !ctxRef.current) {
        setChats(c => [...c, { role: 'ai', text: 'Create an edit first, then tell me what to change.' }]);
        return;
      }
      const { profile: next, changed, reply } = refineProfile(current, text);
      if (changed) {
        profileRef.current = next;
        const built = applyPlan(next, ++seedRef.current);
        if (built) {
          setHeadline(resultHeadline({
            hasReference: ctxRef.current.hasRef, match: built.match, durationS: built.plan.durationS,
          }));
        }
      }
      setChats(c => [...c, { role: 'ai', text: reply }]);
    } catch {
      setChats(c => [...c, { role: 'ai', text: 'I could not apply that change — try phrasing it as pacing, punch-ins, captions, colour or length.' }]);
    } finally {
      setChatBusy(false);
    }
  };

  /** Regenerate: same creative direction, fresh cut from a new seed. */
  const regenerate = () => {
    const current = profileRef.current ?? ctxRef.current?.baseProfile;
    if (!current || !ctxRef.current) { void run(); return; }
    setChatBusy(true);
    const built = applyPlan(current, ++seedRef.current);
    if (built) {
      setHeadline(resultHeadline({
        hasReference: ctxRef.current.hasRef, match: built.match, durationS: built.plan.durationS,
      }));
      setChats(c => [...c, { role: 'ai', text: 'Done — I recut it with fresh timing choices.' }]);
    }
    setChatBusy(false);
  };

  /* ─────────── drop phase ─────────── */
  if (phase === 'drop') {
    return (
      <DropScreen
        projectId={projectId} projectName={projectName}
        hasFootage={!!media}
        onFootage={uploadFootage}
        onReference={(f) => { void run(f); }}
        onStart={() => { void run(); }}
        refInputRef={refInput}
        error={error}
      />
    );
  }

  /* ─────────── working phase ─────────── */
  if (phase === 'working') {
    return <WorkingScreen stages={stages} refName={refName} progress={pipelineProgress(stages)} onCancel={() => { cancelRef.current = true; setPhase('drop'); }} />;
  }

  /* ─────────── result phase ─────────── */
  const mm = String(Math.floor(totalS / 60));
  const ss = String(Math.floor(totalS % 60)).padStart(2, '0');

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 54, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', borderBottom: `1px solid ${C.b}` }}>
        <LogoMark size={24} />
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>Modaya</span>
        <span style={{ color: C.dim, fontSize: 13, marginLeft: 4 }}>/ {projectName}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href={`/editor/${projectId}`} style={{ textDecoration: 'none' }}>
            <button style={ghostBtn}><SlidersHorizontal size={13} /> Advanced timeline</button>
          </Link>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '22px 16px', gap: 16, overflowY: 'auto' }}>
        {/* Preview */}
        <div style={{ width: 'min(92vw, 560px)', aspectRatio: '9 / 16', background: '#000', borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.b3}`, boxShadow: '0 24px 70px rgba(0,0,0,0.7)' }}>
          {sequence && sourceUrl ? (
            <PreviewCanvas
              sequence={sequence} sourceUrl={sourceUrl} sourceId={projectId || 'main'}
              playing={playing} playheadS={playhead}
              onTime={setPlayhead} onPaused={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPlayhead(0); }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>Preparing preview…</div>
          )}
          <button onClick={() => setPlaying(p => !p)} style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: `1px solid rgba(255,255,255,0.25)`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
            {playing ? '❚❚' : '▶'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.sec, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <span>{mm}:{ss}</span>
          {match > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.green }}>
            <CheckCircle2 size={14} /> Reference match {match}%
          </span>}
        </div>
        <p style={{ margin: 0, color: C.muted, fontSize: 14, textAlign: 'center' }}>{headline}</p>
        {plan?.summary && <p style={{ margin: 0, color: C.dim, fontSize: 12, textAlign: 'center', maxWidth: 520 }}>{plan.summary}</p>}

        {/* Primary actions */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => setExpOpen(true)} style={primaryBtn}><Download size={15} /> Export video</button>
          <button onClick={regenerate} disabled={chatBusy} style={ghostBtn}>
            {chatBusy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Regenerate
          </button>
        </div>

        {/* Refinement chat */}
        <div style={{ width: 'min(92vw, 560px)', marginTop: 6 }}>
          {chats.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 180, overflowY: 'auto' }}>
              {chats.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '8px 12px', borderRadius: 12, background: m.role === 'user' ? C.accent : C.s3, color: m.role === 'user' ? '#fff' : C.sec, fontSize: 13, lineHeight: 1.45 }}>{m.text}</div>
              ))}
              {chatBusy && <div style={{ color: C.muted, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} className="spin" /> Modaya is adjusting…</div>}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: C.s2, border: `1px solid ${C.b3}`, borderRadius: 12, padding: '8px 10px' }}>
            <Sparkles size={16} color={C.accent} style={{ flexShrink: 0, marginTop: 6 }} />
            <textarea
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRefinement(); } }}
              rows={1} placeholder='Tell Modaya what to change…  e.g. "Make the start faster and use more punch-ins."'
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: C.text, fontFamily: F, fontSize: 14, lineHeight: 1.5, maxHeight: 90 }}
            />
            <button onClick={() => sendRefinement()} disabled={!input.trim() || chatBusy} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: input.trim() && !chatBusy ? C.accent : C.b3, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
              <Send size={15} />
            </button>
          </div>
          <p style={{ textAlign: 'center', color: C.dim, fontSize: 11, margin: '8px 0 0' }}>
            “The intro is too slow.” · “Use the reference’s captions more.” · “Make it more energetic.”
          </p>
        </div>
      </div>

      {sequence && sourceUrl && (
        <ExportModal
          open={expOpen} onClose={() => setExpOpen(false)}
          sequence={sequence} sourceUrl={sourceUrl} sourceId={projectId || 'main'}
          projectName={projectName}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  );
}

/* ─────────── drop screen ─────────── */
function DropScreen({ projectId, projectName, hasFootage, onFootage, onReference, onStart, refInputRef, error }: {
  projectId: string; projectName: string; hasFootage: boolean;
  onFootage: (f: File) => void; onReference: (f: File) => void; onStart: () => void;
  refInputRef: React.RefObject<HTMLInputElement | null>; error: string | null;
}) {
  const footageRef = useRef<HTMLInputElement>(null);
  const [footName, setFootName] = useState<string | null>(null);
  const [refReady, setRefReady] = useState<File | null>(null);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 54, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', borderBottom: `1px solid ${C.b}` }}>
        <Link href="/dashboard" style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13 }}><ArrowLeft size={15} /> Projects</Link>
        <div style={{ marginLeft: 'auto' }}><LogoMark size={24} /></div>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: 'min(92vw, 560px)' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 6px' }}>What are we editing today?</h1>
          <p style={{ color: C.muted, fontSize: 14, margin: '0 0 26px' }}>
            Drop your footage. Add a reference if you want Modaya to copy a style. Then Modaya does the rest.
          </p>

          <DropZone
            label={hasFootage || footName ? (footName ?? 'Footage ready') : 'Your footage'}
            sub={hasFootage || footName ? 'Tap to replace' : 'Upload the video you want edited'}
            icon={<Film size={22} />}
            onClick={() => footageRef.current?.click()}
            filled={!!(hasFootage || footName)}
          />
          <input ref={footageRef} type="file" accept="video/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { setFootName(f.name); void onFootage(f); } e.target.value = ''; }} />

          <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '20px 0 8px' }}>Reference · optional</p>
          <DropZone
            label={refReady ? refReady.name : 'Reference video'}
            sub={refReady ? 'Tap to change' : 'A clip whose style Modaya should copy'}
            icon={<Upload size={20} />}
            onClick={() => refInputRef.current?.click()}
            filled={!!refReady}
          />
          <input ref={refInputRef} type="file" accept="video/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setRefReady(f); e.target.value = ''; }} />

          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '16px 0 0' }}>{error}</p>}

          <button
            onClick={() => { if (refReady) onReference(refReady); else onStart(); }}
            disabled={!hasFootage && !footName}
            style={{ marginTop: 26, width: '100%', padding: '15px', borderRadius: 12, border: 'none', fontFamily: F, fontSize: 15, fontWeight: 600,
              background: (!hasFootage && !footName) ? C.b3 : C.accent, color: (!hasFootage && !footName) ? C.dim : '#fff',
              cursor: (!hasFootage && !footName) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              boxShadow: (!hasFootage && !footName) ? 'none' : `0 6px 24px ${C.accent}44` }}>
            <Wand2 size={17} /> {refReady ? 'Create edit in this style' : 'Create edit'}
          </button>
          <p style={{ textAlign: 'center', color: C.dim, fontSize: 11, margin: '12px 0 0' }}>
            {projectName} · No timeline, no settings — Modaya handles the technical work.
          </p>
        </div>
      </div>
    </div>
  );
}

function DropZone({ label, sub, icon, onClick, filled }: { label: string; sub: string; icon: React.ReactNode; onClick: () => void; filled: boolean }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
      padding: '22px 18px', borderRadius: 14, cursor: 'pointer',
      background: filled ? `${C.accent}0e` : C.s2, border: `1.5px dashed ${filled ? C.accent + '66' : C.b3}`, color: C.text, transition: 'all 140ms' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent + '88'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = filled ? C.accent + '66' : C.b3; }}>
      <span style={{ width: 44, height: 44, borderRadius: 11, background: filled ? `${C.accent}1c` : C.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: filled ? C.accent : C.muted, flexShrink: 0 }}>{icon}</span>
      <span>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>{label}</span>
        <span style={{ display: 'block', color: C.muted, fontSize: 12.5, marginTop: 2 }}>{sub}</span>
      </span>
    </button>
  );
}

/* ─────────── working screen ─────────── */
function WorkingScreen({ stages, refName, progress, onCancel }: { stages: StageState[]; refName: string | null; progress: number; onCancel: () => void }) {
  const pct = Math.round(progress * 100);
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: F, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: 'min(92vw, 460px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Wand2 size={18} color={C.accent} />
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 11, fontWeight: 600, color: C.accent }}>
            {refName ? `Modaya is editing · referencing ${refName}` : 'Modaya is editing'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginBottom: 26 }}>
          {stages.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, opacity: s.status === 'pending' ? 0.4 : s.status === 'skipped' ? 0.25 : 1 }}>
              {s.status === 'done' ? <CheckCircle2 size={17} color={C.green} />
                : s.status === 'active' ? <Loader2 size={17} color={C.accent} className="spin" />
                : s.status === 'skipped' ? <span style={{ width: 17, textAlign: 'center', color: C.dim, fontSize: 13 }}>–</span>
                : <span style={{ width: 17, height: 17, borderRadius: '50%', border: `1.5px solid ${C.b3}` }} />}
              <span style={{ fontSize: 14, fontWeight: s.status === 'active' ? 600 : 400, color: s.status === 'active' ? C.text : C.sec }}>
                {s.label}{s.status === 'skipped' ? ' (no reference)' : ''}
              </span>
            </div>
          ))}
        </div>
        <div style={{ height: 6, borderRadius: 999, background: C.b2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${C.accent}, ${C.accentH})`, transition: 'width 300ms linear' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
          <span style={{ color: C.dim, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }`}</style>
    </div>
  );
}

/* A default punchy short-form profile used when no reference is given: Modaya
   still makes an energetic cut rather than a passive trim. */
function defaultPunchyProfile(durationS: number): StyleProfile {
  return {
    sourceName: 'modaya-default', durationS,
    cuts: [], cutsPerMin: 22, shotMeanS: 2.7, shotMedianS: 2.4, shotVariance: 0.6,
    pace: 'fast',
    grade: { brightness: 0, contrast: 0.06, saturation: 0.08, warmth: 0 },
    punchInRate: 0.35, punchInMax: 0.12,
    captions: { present: true, position: 'lower', emphasis: 0.4 },
    beatSynced: false, bpm: null, energy: 0.7,
  };
}

const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 10,
  background: C.accent, color: '#fff', border: 'none', fontFamily: F, fontSize: 14, fontWeight: 600,
  cursor: 'pointer', boxShadow: `0 4px 18px ${C.accent}44`,
};
const ghostBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 10,
  background: C.s3, color: C.sec, border: `1px solid ${C.b3}`, fontFamily: F, fontSize: 13, fontWeight: 500,
  cursor: 'pointer', textDecoration: 'none',
};
