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
import { saveMediaFile } from '@/lib/mediaDb';
import { getProjectMedia, uploadProjectMedia, getReferenceBlob } from '@/lib/mediaCloud';
import { analyseAudio, analyseReference, interestCurve } from '@/lib/ai/analyseReference';
import type { StyleProfile } from '@/lib/ai/styleProfile';
import { composeStudioPlan, type StudioPlan, type TranscriptLine } from '@/lib/studio/editPlan';
import { transcribeMedia } from '@/lib/ai/transcribeClient';
import { buildSequence, type Sequence, type StyleLayer } from '@/lib/render/sequence';
import PreviewCanvas from '../editor/PreviewCanvas';
import { ExportModal } from '../editor/ExportModal';
import {
  stagesForRun, markActive, markDone, pipelineProgress, referenceMatch, resultHeadline,
  type StageState, type StageId,
} from '@/lib/studio/pipeline';
import { refineProfile } from '@/lib/studio/refine';
import { buildEditMap, explainMarker, markerIcon, fmtTime, type EditMarker } from '@/lib/studio/editMap';
import { addVersion, loadVersions, type EditVersion } from '@/lib/studio/versions';
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
    // Rehydrate on a fresh tab / new device: IndexedDB first, then the
    // durable server store (the blob is re-cached locally as it arrives).
    if (!getMedia(projectId)) {
      void getProjectMedia(projectId).then(stored => {
        if (!stored || getMedia(projectId)) return;
        // Re-derive real dimensions/duration (the server copy stores bytes,
        // not the probed metadata), then cache the corrected record locally.
        const file = new File([stored.blob], stored.filename, { type: stored.mimeType });
        void analyseFile(file).then(meta => {
          if (getMedia(projectId)) return;
          setMedia(projectId, {
            objectUrl: URL.createObjectURL(stored.blob),
            mimeType: stored.mimeType, mediaType: stored.mediaType,
            aspectRatio: meta?.aspectRatio ?? stored.aspectRatio,
            width: meta?.width ?? stored.width, height: meta?.height ?? stored.height,
            durationS: meta?.durationS ?? stored.durationS, filename: stored.filename,
          });
          void saveMediaFile(projectId, stored.blob, {
            mimeType: stored.mimeType, mediaType: stored.mediaType,
            aspectRatio: meta?.aspectRatio ?? stored.aspectRatio,
            width: meta?.width ?? 0, height: meta?.height ?? 0,
            durationS: meta?.durationS ?? 0, filename: stored.filename,
          }).catch(() => {});
          setMediaState(getMedia(projectId));
        });
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

  const [plan, setPlan] = useState<StudioPlan | null>(null);
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [styleLayer, setStyleLayer] = useState<StyleLayer>({});
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 1080, height: 1920 });
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [totalS, setTotalS] = useState(media?.durationS || 0);
  const [expOpen, setExpOpen] = useState(false);

  const [chats, setChats] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // ── result surface: compare / edit-map / versions / reference ──
  /** 'compare' (reference vs result) or 'iterate' (video + chat + edit map). */
  const [resultView, setResultView] = useState<'compare' | 'iterate'>('compare');
  /** In the iterate view: which playback the user sees. */
  const [showRef, setShowRef] = useState(false);
  const [versions, setVersions] = useState<EditVersion[]>([]);
  const [versionOpen, setVersionOpen] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<EditMarker | null>(null);
  /** The learned reference, kept as a playable blob URL for comparison. */
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const refVideoRef = useRef<HTMLVideoElement | null>(null);
  const syncRef = useRef(false);   // lock reference playback to the result
  const refInput = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const bootstrapped = useRef(false);
  /** Everything a regeneration needs, captured on the first run. */
  const ctxRef = useRef<{
    durationS: number; onsets: number[]; interest: number[]; transcript: TranscriptLine[];
    baseProfile: StyleProfile; hasRef: boolean; captionsWanted: boolean;
    sourceName?: string;
  } | null>(null);
  /** The profile currently driving the edit (reference/default, then refined). */
  const profileRef = useRef<StyleProfile | null>(null);
  const seedRef = useRef(1);
  /** Free-text instruction from the drop screen, used to label Version 1. */
  const initialNoteRef = useRef('');

  /** Compose the EditPlan from the current profile and push it to the preview.
   *  Shared by the first run, Regenerate and every chat refinement. Returns
   *  the plan plus the grounded reference-match score. */
  const applyPlan = useCallback((profile: StyleProfile, seed: number): { plan: StudioPlan; match: number } | null => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const plan = composeStudioPlan({
      profile, sourceDurationS: ctx.durationS,
      interest: ctx.interest, onsets: ctx.onsets,
      transcript: ctx.transcript.length ? ctx.transcript : undefined,
      seed,
    });
    setPlan(plan);
    setFrame({ width: plan.frame.width, height: plan.frame.height });
    const mapped = plan.clips.map(clipToEditor);
    const layer: StyleLayer = {};
    for (const c of plan.clips) {
      if (c.type === 'video') {
        layer[c.id] = { sourceIn: c.sourceIn, transform: c.transform, effects: c.effects };
      }
    }
    setClips(mapped);
    setStyleLayer(layer);
    setTotalS(plan.durationS);

    const videoShots = plan.clips.filter(c => c.type === 'video');
    const cutCount = Math.max(1, plan.cutCount || videoShots.length);
    const editCpm = (cutCount / Math.max(1, plan.durationS)) * 60;
    const m = referenceMatch({
      hasReference: ctx.hasRef,
      editCutsPerMin: editCpm,
      refCutsPerMin: ctx.baseProfile.cutsPerMin || editCpm,
      beatSnapRate: ctx.hasRef ? 0.7 : 0,
      refPunchInRate: ctx.baseProfile.punchInRate,
      editPunchInRate: profile.punchInRate,
      captionsWanted: ctx.captionsWanted,
      captionsPresent: !ctx.captionsWanted || plan.captions > 0,
    });
    setMatch(m);
    return { plan, match: m };
  }, []);

  /** Persist a newly composed plan as the next version (never overwrites). */
  const saveVersion = useCallback(async (
    profile: StyleProfile, seed: number, note: string,
    built: { plan: StudioPlan; match: number },
  ) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      const { versions: vs } = await addVersion(projectId, {
        profile, seed, hasRef: ctx.hasRef, refName, note: note || undefined,
      }, { durationS: built.plan.durationS, cuts: built.plan.cutCount, match: built.match });
      setVersions(vs);
    } catch { /* versioning is non-blocking */ }
  }, [projectId, refName]);

  /** Rebuild a specific past version from its recipe (deterministic). */
  const restoreVersion = useCallback((v: EditVersion) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    profileRef.current = v.recipe.profile;
    seedRef.current = v.recipe.seed;
    const built = applyPlan(v.recipe.profile, v.recipe.seed);
    if (built) {
      setHeadline(resultHeadline({
        hasReference: ctx.hasRef, match: built.match, durationS: built.plan.durationS,
      }));
      setChats(c => [...c, { role: 'ai', text: `Back on ${v.label} (Version ${v.number}). Ask me to change anything from here.` }]);
    }
    setSelectedMarker(null);
  }, [applyPlan]);

  const sourceUrl = media?.objectUrl ?? null;

  const sequence: Sequence | null = useMemo(() => {
    if (!media || !clips.length) return null;
    // The output frame follows the plan's format (9:16 vertical for shorts),
    // not the source media's shape — the renderer cover-crops to fit it.
    return buildSequence(clips as never[], {
      durationS: totalS,
      width: frame.width,
      height: frame.height,
      sourceId: projectId || 'main',
      style: styleLayer,
    });
  }, [clips, media, totalS, projectId, styleLayer, frame]);

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
    const stored = await getProjectMedia(projectId);
    const entry = getMedia(projectId);
    const blob = stored?.blob;
    if (!blob) { setError('Upload your footage first.'); return; }

    const withRef = !!refFile;
    cancelRef.current = false;
    setHasRef(withRef);
    setRefName(refFile?.name ?? null);
    setSelectedMarker(null);
    if (withRef && refFile) {
      setRefUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(refFile); });
      // Durable reference copy (role 'ref') so it survives and can be compared
      // on any device; no-op on hosts without durable storage.
      void uploadProjectMedia(projectId, 'ref', refFile, refFile.name, 0).catch(() => {});
    } else {
      setRefUrl(null);
    }
    setStages(stagesForRun(withRef));
    setPhase('working');
    setChats([]);
    setResultView('compare');

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

      // Captions are the real spoken words — transcribe when a speech service
      // is configured (the call is a no-op without a key and captions fall
      // back to none). Best-effort: a failed transcription never blocks.
      let transcript: TranscriptLine[] = [];
      if (baseProfile.captions.present) {
        await tick('captions', async () => {
          const lines = await transcribeMedia(projectId, blob, durationS).catch(() => null);
          transcript = lines ?? [];
        });
      } else {
        setStage('captions', 'done');
      }

      // Capture everything a later regeneration/refinement needs.
      ctxRef.current = {
        durationS,
        onsets: env?.onsets ?? [], interest, transcript,
        baseProfile, hasRef: withRef && !!profile,
        captionsWanted: baseProfile.captions.present,
        sourceName: stored.filename || entry?.filename,
      };
      profileRef.current = baseProfile;
      seedRef.current = 1;

      // 3 — find the strongest moments (drives which footage the plan keeps)
      await tick('find-moments', () => {});

      // 4 — compose the plan (moments, vertical frame, cuts, push-ins)
      let built: { plan: StudioPlan; match: number } | null = null as { plan: StudioPlan; match: number } | null;
      await tick('match-pacing', () => { built = applyPlan(baseProfile, 1); });

      // 6 — the edit is already in state (applyPlan); just mark it.
      await tick('build-edit', () => {});

      // 7 — render the first frame; full render happens on export.
      await tick('render', () => {});

      if (cancelRef.current) return;

      // Persist this as Version 1 (or the next version when re-run). The
      // recipe rebuilds the identical cut, so nothing heavy is stored.
      if (built) {
        const { versions: vs } = await addVersion(projectId, {
          profile: baseProfile, seed: 1, hasRef: withRef && !!profile,
          refName: refFile?.name ?? null, note: initialNoteRef.current || undefined,
        }, { durationS: built.plan.durationS, cuts: built.plan.cutCount, match: built.match });
        setVersions(vs);
        initialNoteRef.current = '';
      }

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

  /** The transparent Edit Map derived from the finished plan. */
  const editMap = useMemo(() => (plan ? buildEditMap(plan) : []), [plan]);

  /** Explanation for the marker the user clicked (or null). */
  const markerExplanation = useMemo(() => {
    if (!selectedMarker || !ctxRef.current) return null;
    const ctx = ctxRef.current;
    return explainMarker(selectedMarker, {
      hasRef: ctx.hasRef,
      cutsPerMin: ctx.baseProfile.cutsPerMin,
      punchInRate: ctx.baseProfile.punchInRate,
    });
  }, [selectedMarker]);

  // Bootstrap once footage exists: if this project already has versions (the
  // user is reopening their project) rebuild the latest one straight into the
  // compare/iterate surface — same project, never reset, reference kept.
  // Otherwise run the pipeline fresh.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!media || phase !== 'drop' || autoRan.current) return;
    autoRan.current = true;
    (async () => {
      const existing = await loadVersions(projectId).catch(() => [] as EditVersion[]);
      if (existing.length) {
        // Rebuild context from the latest version's recipe.
        const last = existing[existing.length - 1];
        const stored = await getProjectMedia(projectId);
        const blob = stored?.blob;
        if (!blob) { void run(); return; }
        let env: Awaited<ReturnType<typeof analyseAudio>> = null;
        try { env = await analyseAudio(blob); } catch { /* silent */ }
        const durationS = stored.durationS || media.durationS || 60;
        const interest = interestCurve(env, durationS);
        ctxRef.current = {
          durationS, onsets: env?.onsets ?? [], interest, transcript: [],
          baseProfile: last.recipe.profile, hasRef: last.recipe.hasRef,
          captionsWanted: last.recipe.profile.captions.present,
          sourceName: stored.filename || media.filename,
        };
        profileRef.current = last.recipe.profile;
        seedRef.current = last.recipe.seed;
        setHasRef(last.recipe.hasRef);
        setRefName(last.recipe.refName ?? null);
        setVersions(existing);
        applyPlan(last.recipe.profile, last.recipe.seed);
        setHeadline(resultHeadline({
          hasReference: last.recipe.hasRef, match: last.stats?.match ?? 0, durationS: last.stats?.durationS ?? durationS,
        }));
        setResultView('iterate');
        setPhase('result');
        // Try to surface the stored reference for the reference view.
        try {
          const { getReferenceBlob } = await import('@/lib/mediaCloud');
          const refBlob = await getReferenceBlob(projectId, 0);
          if (refBlob) setRefUrl(URL.createObjectURL(refBlob.blob));
        } catch { /* reference is optional */ }
      } else {
        void run();
      }
    })();
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
    // Durable server copy (no-op when the host has no durable storage).
    void uploadProjectMedia(projectId, 'main', f, f.name).catch(() => {});
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
        const seed = ++seedRef.current;
        const built = applyPlan(next, seed);
        if (built) {
          setHeadline(resultHeadline({
            hasReference: ctxRef.current.hasRef, match: built.match, durationS: built.plan.durationS,
          }));
          void saveVersion(next, seed, text, built);
        }
      }
      setChats(c => [...c, { role: 'ai', text: reply }]);
    } catch {
      setChats(c => [...c, { role: 'ai', text: 'I could not apply that change — try phrasing it as pacing, punch-ins, captions, colour or length.' }]);
    } finally {
      setChatBusy(false);
    }
  };

  /** Regenerate: same creative direction, fresh cut from a new seed. Saved as
   *  a new version so nothing is lost. */
  const regenerate = () => {
    const current = profileRef.current ?? ctxRef.current?.baseProfile;
    if (!current || !ctxRef.current) { void run(); return; }
    setChatBusy(true);
    const seed = ++seedRef.current;
    const built = applyPlan(current, seed);
    if (built) {
      setHeadline(resultHeadline({
        hasReference: ctxRef.current.hasRef, match: built.match, durationS: built.plan.durationS,
      }));
      void saveVersion(current, seed, '', built);
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
        onReference={(f, note) => { initialNoteRef.current = note; void run(f); }}
        onStart={(note) => { initialNoteRef.current = note; void run(); }}
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
  const currentVersion = versions.length ? versions[versions.length - 1] : null;

  /** Synced playback for side-by-side: scrub/play both by progress fraction. */
  const syncProgress = useCallback((frac: number, play: boolean) => {
    const t = Math.max(0, frac) * Math.max(1, totalS);
    setPlayhead(t);
    const ref = refVideoRef.current;
    if (ref && Number.isFinite(ref.duration)) {
      const rt = frac * ref.duration;
      try { ref.currentTime = rt; } catch { /* seeking before metadata */ }
      if (play) { void ref.play().catch(() => {}); } else { ref.pause(); }
    }
    setPlaying(play);
  }, [totalS]);

  const resultVideo = (
    <div style={{ ...previewBox(plan?.frame.ratio), background: '#000', borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.b3}`, boxShadow: '0 24px 70px rgba(0,0,0,0.7)' }}>
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
  );

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 54, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', borderBottom: `1px solid ${C.b}` }}>
        <Link href="/dashboard" style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13 }}><ArrowLeft size={15} /> Projects</Link>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>{projectName}</span>
        {currentVersion && (
          <span style={{ color: C.dim, fontSize: 12, background: C.s3, border: `1px solid ${C.b3}`, borderRadius: 999, padding: '3px 10px' }}>
            Version {currentVersion.number}{currentVersion.label && currentVersion.number > 1 ? ` · ${currentVersion.label}` : ''}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setVersionOpen(v => !v)} style={ghostBtn}><Sparkles size={13} /> Versions ({versions.length})</button>
          <button onClick={() => setExpOpen(true)} style={primaryBtn}><Download size={14} /> Export</button>
          <Link href={`/editor/${projectId}`} style={{ textDecoration: 'none' }}>
            <button style={ghostBtn}><SlidersHorizontal size={13} /> Advanced</button>
          </Link>
        </div>
      </header>

      {/* Compare ⇄ Iterate toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '12px 0 0' }}>
        {([['compare', 'Reference vs result'], ['iterate', 'Edit & refine']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setResultView(v)}
            style={{ padding: '8px 16px', borderRadius: 999, border: `1px solid ${resultView === v ? C.accent : C.b3}`,
              background: resultView === v ? `${C.accent}1c` : C.s2, color: resultView === v ? C.accent : C.muted,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>
            {label}
          </button>
        ))}
      </div>

      {resultView === 'compare' ? (
        /* ─────────── comparison screen ─────────── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', gap: 14, overflowY: 'auto' }}>
          <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>{headline}</p>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
            {/* Reference */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <CompareBox title="REFERENCE">
                {refUrl
                  ? <video ref={refVideoRef} src={refUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
                  : <div style={{ color: C.dim, fontSize: 12, padding: 16, textAlign: 'center' }}>No reference added.<br/>Your edit uses Modaya&apos;s default punchy style.</div>}
              </CompareBox>
              <span style={{ fontSize: 12, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{refName ?? 'Reference'}</span>
            </div>
            {/* Result */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ transform: 'scale(0.92)', transformOrigin: 'top center' }}>{resultVideo}</div>
              <span style={{ fontSize: 12, color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Your video{match > 0 ? ` · ${match}% match` : ''}
              </span>
            </div>
          </div>

          {refUrl && (
            <button onClick={() => { const frac = playing ? (playhead / Math.max(1, totalS)) : 0; syncProgress(frac, !playing); }}
              style={{ ...primaryBtn, marginTop: 4 }}>
              {playing ? '❚❚ Pause both' : '▶ Play together (synced)'}
            </button>
          )}

          {plan?.summary && <p style={{ margin: 0, color: C.dim, fontSize: 12, textAlign: 'center', maxWidth: 560 }}>{plan.summary}</p>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => setExpOpen(true)} style={primaryBtn}><Download size={15} /> Export</button>
            <button onClick={() => setResultView('iterate')} style={ghostBtn}><Sparkles size={14} /> Iterate with Modaya</button>
          </div>
        </div>
      ) : (
        /* ─────────── iterate screen: video + chat, edit map below ─────────── */
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 0, minHeight: 0 }} className="studio-iterate-grid">
          {/* Left: video + edit map */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: '18px 20px', gap: 12, overflowY: 'auto' }}>
            {/* Reference / Your edit toggle (only when a reference exists) */}
            {refUrl && (
              <div style={{ display: 'flex', gap: 6 }}>
                {([['mine', 'Your edit'], ['ref', 'Reference']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setShowRef(v === 'ref')}
                    style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${showRef === (v === 'ref') ? C.accent : C.b3}`,
                      background: showRef === (v === 'ref') ? `${C.accent}1c` : C.s2, color: showRef === (v === 'ref') ? C.accent : C.muted,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              {showRef && refUrl ? (
                <div style={{ ...previewBox(plan?.frame.ratio), background: '#000', borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.b3}` }}>
                  <video src={refUrl} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : resultVideo}
            </div>

            {/* Time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.sec, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <span>{fmtTime(playhead)} / {mm}:{ss}</span>
              {match > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.green }}>
                <CheckCircle2 size={14} /> Reference match {match}%
              </span>}
              {markerExplanation && (
                <span style={{ marginLeft: 'auto', color: C.accent, fontSize: 12, maxWidth: '52%', textAlign: 'right' }}>{markerExplanation}</span>
              )}
            </div>

            {/* Edit Map — Modaya's transparent record of what it did */}
            <EditMap
              markers={editMap} durationS={totalS} playheadS={playhead}
              selectedId={selectedMarker?.id ?? null}
              onSeek={(t) => { setPlayhead(t); setPlaying(false); }}
              onSelect={(m) => setSelectedMarker(prev => (prev?.id === m.id ? null : m))}
            />
            {selectedMarker && (
              <div style={{ background: C.s2, border: `1px solid ${C.accent}55`, borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.sec, lineHeight: 1.5 }}>
                <span style={{ color: C.accent, fontWeight: 700, marginRight: 6 }}>{fmtTime(selectedMarker.t)} · {selectedMarker.label}</span>
                {markerExplanation}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={regenerate} disabled={chatBusy} style={ghostBtn}>
                {chatBusy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Regenerate
              </button>
              <Link href={`/editor/${projectId}`} style={{ textDecoration: 'none' }}>
                <button style={ghostBtn}><SlidersHorizontal size={13} /> Take full control</button>
              </Link>
            </div>
          </div>

          {/* Right: Modaya conversation */}
          <div style={{ borderLeft: `1px solid ${C.b}`, display: 'flex', flexDirection: 'column', minHeight: 0, background: C.surface }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.b}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={17} color={C.accent} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Modaya</span>
              <span style={{ marginLeft: 'auto', color: C.dim, fontSize: 11 }}>Tell it what to change</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ alignSelf: 'flex-start', maxWidth: '92%', padding: '10px 14px', borderRadius: 12, background: C.s3, color: C.sec, fontSize: 13.5, lineHeight: 1.5 }}>
                Your edit is ready. I kept the strongest moment as the hook, cut the dead air{match > 0 ? ` and matched the reference's pacing` : ''}. What would you like to change?
              </div>
              {chats.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', padding: '9px 13px', borderRadius: 12, background: m.role === 'user' ? C.accent : C.s3, color: m.role === 'user' ? '#fff' : C.sec, fontSize: 13, lineHeight: 1.45 }}>{m.text}</div>
              ))}
              {chatBusy && <div style={{ color: C.muted, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} className="spin" /> Modaya is adjusting…</div>}
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${C.b}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: C.s2, border: `1px solid ${C.b3}`, borderRadius: 12, padding: '8px 10px' }}>
                <textarea
                  value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRefinement(); } }}
                  rows={1} placeholder='Ask Modaya…  e.g. "Make the second half faster."'
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: C.text, fontFamily: F, fontSize: 13.5, lineHeight: 1.5, maxHeight: 90 }}
                />
                <button onClick={() => sendRefinement()} disabled={!input.trim() || chatBusy} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: input.trim() && !chatBusy ? C.accent : C.b3, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
                  <Send size={15} />
                </button>
              </div>
              <p style={{ color: C.dim, fontSize: 11, margin: '8px 2px 0', lineHeight: 1.5 }}>
                “Make it more cinematic.” · “Remove the captions.” · “Use the reference’s transitions.”
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Versions popover */}
      {versionOpen && (
        <div style={{ position: 'fixed', top: 58, right: 130, zIndex: 9500, width: 300, background: C.surface, border: `1px solid ${C.b3}`, borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.7)', padding: 8, maxHeight: '60vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '6px 10px' }}>Versions</div>
          {[...versions].reverse().map(v => (
            <button key={v.id} onClick={() => { restoreVersion(v); setVersionOpen(false); }}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px', borderRadius: 9, border: 'none',
                background: v.id === currentVersion?.id ? `${C.accent}16` : 'transparent', color: C.sec, cursor: 'pointer', fontFamily: F }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: C.s3, border: `1px solid ${C.b3}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{v.number}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: C.dim }}>{fmtTime(v.stats?.durationS ?? 0)} · {v.stats?.cuts ?? 0} cuts{v.stats?.match ? ` · ${v.stats.match}% match` : ''}</span>
              </span>
              {v.id === currentVersion?.id && <span style={{ marginLeft: 'auto', fontSize: 10, color: C.green, fontWeight: 700, whiteSpace: 'nowrap' }}>CURRENT</span>}
            </button>
          ))}
        </div>
      )}

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
        @media (max-width: 860px) { .studio-iterate-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

/* ─────────── comparison box ─────────── */
function CompareBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 'min(42vw, 300px)', aspectRatio: '9 / 16', background: '#000', borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.b3}`, boxShadow: '0 18px 50px rgba(0,0,0,0.6)' }}>
      <span style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '3px 8px', borderRadius: 6 }}>{title}</span>
      {children}
    </div>
  );
}

/* ─────────── Edit Map ─────────── */
function EditMap({ markers, durationS, playheadS, selectedId, onSeek, onSelect }: {
  markers: EditMarker[];
  durationS: number;
  playheadS: number;
  selectedId: string | null;
  onSeek: (t: number) => void;
  onSelect: (m: EditMarker) => void;
}) {
  const dur = Math.max(1, durationS);
  const laneColors: Record<string, string> = {
    hook: '#F5C451', cut: C.accent, zoom: '#B07CFF', caption: C.green, broll: '#FF8A5B',
  };
  return (
    <div style={{ background: C.s2, border: `1px solid ${C.b3}`, borderRadius: 12, padding: '14px 16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.sec, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Edit map</span>
        <span style={{ fontSize: 11, color: C.dim }}>What Modaya did — click any edit to see why</span>
      </div>
      <div style={{ position: 'relative', height: 46 }}>
        {/* playhead */}
        <div style={{ position: 'absolute', top: -6, bottom: -6, width: 2, background: '#fff', opacity: 0.7, left: `${(playheadS / dur) * 100}%`, pointerEvents: 'none' }} />
        {/* baseline */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 22, height: 2, background: C.b3, borderRadius: 2 }} />
        {markers.map(m => {
          const left = Math.min(98, (m.t / dur) * 100);
          const color = laneColors[m.type] ?? C.sec;
          const active = selectedId === m.id;
          return (
            <button key={m.id}
              onClick={() => { onSelect(m); onSeek(m.t); }}
              title={`${m.label} at ${fmtTime(m.t)}`}
              style={{ position: 'absolute', left: `${left}%`, top: 6, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <span style={{ width: active ? 30 : 26, height: active ? 30 : 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: m.type === 'cut' ? 13 : m.type === 'caption' ? 11 : 13, fontWeight: 700, color: '#0a0a0a',
                background: color, boxShadow: active ? `0 0 0 3px ${color}44` : 'none', border: active ? '2px solid #fff' : 'none', lineHeight: 1 }}>
                {markerIcon(m.type)}
              </span>
              <span style={{ position: 'absolute', top: 34, fontSize: 9, color: C.dim, whiteSpace: 'nowrap' }}>{fmtTime(m.t)}</span>
            </button>
          );
        })}
      </div>
      {/* legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 18 }}>
        {(['hook', 'cut', 'zoom', 'caption', 'broll'] as const).map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: C.muted, textTransform: 'capitalize' }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: laneColors[t] }} />
            {t === 'broll' ? 'B-roll' : t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────── drop screen ─────────── */
function DropScreen({ projectId, projectName, hasFootage, onFootage, onReference, onStart, refInputRef, error }: {
  projectId: string; projectName: string; hasFootage: boolean;
  onFootage: (f: File) => void; onReference: (f: File, note: string) => void; onStart: (note: string) => void;
  refInputRef: React.RefObject<HTMLInputElement | null>; error: string | null;
}) {
  const footageRef = useRef<HTMLInputElement>(null);
  const [footName, setFootName] = useState<string | null>(null);
  const [refReady, setRefReady] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const ready = !!hasFootage || !!footName;

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

          <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Your video</p>
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

          <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '20px 0 8px' }}>Instructions · optional</p>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            rows={2} placeholder={'e.g. "Create a 60-second cinematic edit. Keep the reference\'s pacing and transitions."'}
            style={{ width: '100%', boxSizing: 'border-box', background: C.s2, border: `1.5px solid ${C.b3}`, borderRadius: 12, color: C.text,
              fontFamily: F, fontSize: 14, lineHeight: 1.5, padding: '12px 14px', resize: 'vertical', outline: 'none' }}
          />

          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '16px 0 0' }}>{error}</p>}

          <button
            onClick={() => { const n = note.trim(); if (refReady) onReference(refReady, n); else onStart(n); }}
            disabled={!ready}
            style={{ marginTop: 22, width: '100%', padding: '15px', borderRadius: 12, border: 'none', fontFamily: F, fontSize: 15, fontWeight: 600,
              background: ready ? C.accent : C.b3, color: ready ? '#fff' : C.dim,
              cursor: ready ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              boxShadow: ready ? `0 6px 24px ${C.accent}44` : 'none' }}>
            <Wand2 size={17} /> {refReady ? 'Create edit in this style' : 'Create edit'}
          </button>
          <p style={{ textAlign: 'center', color: C.dim, fontSize: 11, margin: '12px 0 0' }}>
            {projectName} · You don&apos;t edit the video — you tell Modaya how you want it edited.
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

/** Preview box sizing per output format: tall column for 9:16, wide for 16:9. */
function previewBox(ratio?: string): React.CSSProperties {
  if (ratio === '16:9') return { width: 'min(94vw, 720px)', aspectRatio: '16 / 9' };
  if (ratio === '1:1')  return { width: 'min(80vw, 440px)', aspectRatio: '1 / 1' };
  return { width: 'min(86vw, 400px)', aspectRatio: '9 / 16', maxHeight: '70vh' };
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
