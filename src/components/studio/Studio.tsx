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
import { ArrowLeft, Film, Upload, Wand2, Download, RefreshCw, Sparkles, Send, SlidersHorizontal, CheckCircle2, Loader2, Plus } from 'lucide-react';
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
import { buildEditMap, explainMarker, markerIcon, fmtTime, referenceMoment, type EditMarker, type RefMoment } from '@/lib/studio/editMap';
import { addVersion, loadVersions, type EditVersion } from '@/lib/studio/versions';
import { parseTimeRange } from '@/lib/referenceLink';
import { GlowButton, GLOW_GRADIENT } from '../ui/theme';
import type { EditorClip } from '../editor/EditorShell';

const F = "'Inter Tight', Inter, system-ui, sans-serif";
/**
 * Light, blue-and-white SaaS theme. `surface`/`s2`/`s3` are the white/near-
 * white panels and wells; `media` stays near-black for the video canvases.
 */
const C = {
  bg: '#F4F7FE', surface: '#FFFFFF', s2: '#F7F9FE', s3: '#EEF2FB',
  b: '#E6EBF5', b2: '#D7DEF0', b3: '#D2DAEC',
  accent: '#3B6FF6', accentH: '#5C8CFF',
  text: '#0F1B33', sec: '#41506B', muted: '#7A869E', dim: '#9AA5BC',
  green: '#16A34A', gold: '#F5B53F',
  danger: '#E5484D', warn: '#D97824', broll: '#F0775B',
  media: '#0B0F1A', mediaBorder: '#232B3D', mediaShade: 'rgba(15,27,51,0.55)',
};

type Phase = 'drop' | 'working' | 'result';

/** The footage bytes Modaya analyses, plus enough metadata to run. */
interface FootageSource {
  blob: Blob;
  filename: string;
  durationS: number;
  mimeType: string;
}

/**
 * Resolve the project's footage bytes from the best available source:
 *   1. the persistent store (IndexedDB hot path, then the durable cloud), and
 *   2. this session's in-memory entry — it holds a `blob:` object URL from
 *      which the bytes can be fetched even when the file was too big for
 *      IndexedDB (600 MB cap / quota / private mode) on a host with no
 *      durable cloud. The footage is genuinely uploaded (it plays), so we use
 *      it rather than wrongly telling the user to re-upload.
 * Returns null only when there is truly no footage anywhere.
 */
async function resolveFootage(projectId: string, entry: MediaEntry | null): Promise<FootageSource | null> {
  const stored = await getProjectMedia(projectId).catch(() => null);
  if (stored?.blob && stored.blob.size > 0) {
    return {
      blob: stored.blob,
      filename: stored.filename || entry?.filename || 'footage.mp4',
      durationS: stored.durationS || entry?.durationS || 0,
      mimeType: stored.mimeType || entry?.mimeType || 'video/mp4',
    };
  }

  const url = entry?.objectUrl;
  if (url && url.startsWith('blob:')) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          return {
            blob,
            filename: entry?.filename || 'footage.mp4',
            durationS: entry?.durationS || 0,
            mimeType: entry?.mimeType || blob.type || 'video/mp4',
          };
        }
      }
    } catch { /* object URL gone — fall through */ }
  }
  return null;
}

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

export default function Studio({ projectId, projectName, mode: initialMode = 'edit' }: {
  projectId: string; projectName: string; mode?: 'edit' | 'reference';
}) {
  // The door (/new) suggests a mode, but the user can switch modes right here
  // in the app before creating the edit.
  const [mode, setMode] = useState<'edit' | 'reference'>(initialMode);
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
  /** In the iterate view: playback mode — just the edit, just the reference,
   *  or both side by side. */
  const [iterView, setIterView] = useState<'mine' | 'ref' | 'side'>('mine');
  const [versions, setVersions] = useState<EditVersion[]>([]);
  const [versionOpen, setVersionOpen] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<EditMarker | null>(null);
  /** The learned reference, kept as a playable blob URL for comparison. */
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const refVideoRef = useRef<HTMLVideoElement | null>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
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
  // Remember the reference + section from the most recent explicit run so that
  // regenerate / iterate re-runs reuse them instead of dropping the style.
  const lastRefRef = useRef<{ file: File | null; range: { startS: number; endS: number } | null }>({ file: null, range: null });

  const run = useCallback(async (opts?: { ref?: File | null; range?: { startS: number; endS: number } | null }) => {
    // Explicit opts win; a no-arg re-run reuses the previous reference/range.
    const hasOpts = opts !== undefined;
    const refFile = hasOpts ? (opts?.ref ?? null) : (lastRefRef.current.file ?? null);
    const range = hasOpts ? (opts?.range ?? null) : (lastRefRef.current.range ?? null);
    lastRefRef.current = { file: refFile, range };
    if (!projectId) return;
    setError(null);
    const entry = getMedia(projectId);
    const footage = await resolveFootage(projectId, entry);
    if (!footage) { setError('Upload your footage first.'); setPhase('drop'); return; }
    const blob = footage.blob;

    const withRef = !!refFile;
    cancelRef.current = false;
    setHasRef(withRef);
    const rangeLabel = range ? ` · ${fmtTime(range.startS)}–${fmtTime(range.endS)}` : '';
    setRefName(refFile ? `${refFile.name}${rangeLabel}` : null);
    setSelectedMarker(null);
    setIterView('mine');
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

      // 2 — learn the reference (or just the chosen section), if provided
      if (withRef && refFile) {
        await tick('learn-reference', async () => {
          const meta = await analyseFile(refFile).catch(() => null);
          const fullDur = meta?.durationS ?? refFile.size / 90000;
          // Clamp a requested section to the real media length.
          const win = range
            ? { startS: Math.max(0, Math.min(range.startS, fullDur)),
                endS:   Math.max(0, Math.min(range.endS, fullDur)) }
            : undefined;
          const res = await analyseReference(refFile, { name: refFile.name, durationS: fullDur },
            () => {}, win && win.endS > win.startS + 0.5 ? win : undefined).catch(() => null);
          profile = res?.profile ?? null;
        });
      }

      const durationS = footage.durationS || entry?.durationS || 60;
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
        sourceName: footage.filename || entry?.filename,
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
          refName: refFile ? `${refFile.name}${rangeLabel}` : null, note: initialNoteRef.current || undefined,
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

  /** Where the same editing decision appears in the reference (if it exists). */
  const refMoment = useMemo<RefMoment | null>(() => {
    if (!selectedMarker || !ctxRef.current || !refUrl) return null;
    const ctx = ctxRef.current;
    const cutMarkers = editMap.filter(m => m.type === 'cut').length;
    return referenceMoment(selectedMarker, {
      hasRef: ctx.hasRef && !!refUrl,
      refCuts: ctx.baseProfile.cuts ?? [],
      refDurationS: ctx.baseProfile.durationS || 0,
      editDurationS: totalS,
      editCutCount: Math.max(1, cutMarkers),
    });
  }, [selectedMarker, editMap, totalS, refUrl]);

  // Selecting an edit that has a reference moment seeks the reference player
  // to it and flips to side-by-side so the link is obvious.
  useEffect(() => {
    if (!refMoment || !refUrl) return;
    const v = refVideoRef.current;
    if (v) { try { v.pause(); v.currentTime = refMoment.t; } catch { /* metadata not ready */ } }
    if (iterView === 'mine') setIterView('side');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refMoment]);

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
        const footage = await resolveFootage(projectId, media);
        if (!footage) { void run(); return; }
        let env: Awaited<ReturnType<typeof analyseAudio>> = null;
        try { env = await analyseAudio(footage.blob); } catch { /* silent */ }
        const durationS = footage.durationS || media.durationS || 60;
        const interest = interestCurve(env, durationS);
        ctxRef.current = {
          durationS, onsets: env?.onsets ?? [], interest, transcript: [],
          baseProfile: last.recipe.profile, hasRef: last.recipe.hasRef,
          captionsWanted: last.recipe.profile.captions.present,
          sourceName: footage.filename || media.filename,
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
    // Keep the (possibly draft) server record in sync so the project lists its
    // real footage/title/status on the dashboard.
    void fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: meta?.filename ?? f.name.replace(/\.[^.]+$/, ''),
        filename: f.name,
        durationS: meta?.durationS ?? 0,
        width: meta?.width ?? 0, height: meta?.height ?? 0,
        aspectRatio: meta?.aspectRatio ?? '16:9',
        status: 'ready',
      }),
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
        projectId={projectId} projectName={projectName} mode={mode} onModeChange={setMode}
        hasFootage={!!media}
        onFootage={uploadFootage}
        onReference={(ref, range, note) => { initialNoteRef.current = note; void run({ ref, range }); }}
        onStart={(note) => { initialNoteRef.current = note; void run({ ref: null }); }}
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
    <div style={{ ...previewBox(plan?.frame.ratio), background: C.media, borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.b3}`, boxShadow: '0 24px 70px rgba(31,54,110,0.18)' }}>
      {sequence && sourceUrl ? (
        <PreviewCanvas
          sequence={sequence} sourceUrl={sourceUrl} sourceId={projectId || 'main'}
          playing={playing} playheadS={playhead}
          onTime={setPlayhead} onPaused={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPlayhead(0); }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>Preparing preview…</div>
      )}
      <button onClick={() => setPlaying(p => !p)} style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', width: 44, height: 44, borderRadius: '50%', background: 'rgba(15,27,51,0.55)', border: `1px solid rgba(255,255,255,0.25)`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
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
            {/* Your edit / Reference / Side by side toggle (reference only) */}
            {refUrl && (
              <div style={{ display: 'flex', gap: 6 }}>
                {([['mine', 'Your edit'], ['ref', 'Reference'], ['side', 'Side by side']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setIterView(v)}
                    style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${iterView === v ? C.accent : C.b3}`,
                      background: iterView === v ? `${C.accent}1c` : C.s2, color: iterView === v ? C.accent : C.muted,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {iterView === 'side' && refUrl ? (
              /* Side by side: reference left, your edit right — linked by the
                 selected edit's reference moment. */
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <SideBox highlight={!!refMoment} label="REFERENCE">
                    <video ref={refVideoRef} src={refUrl} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
                  </SideBox>
                  <span style={{ fontSize: 11, color: refMoment ? C.accent : C.dim, fontWeight: refMoment ? 700 : 400 }}>
                    {refMoment ? `Reference ${fmtTime(refMoment.t)}` : (refName ?? 'Reference')}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <SideBox highlight={!!selectedMarker} label="YOUR EDIT">
                    {sequence && sourceUrl ? (
                      <PreviewCanvas
                        sequence={sequence} sourceUrl={sourceUrl} sourceId={projectId || 'main'}
                        playing={playing} playheadS={playhead}
                        onTime={setPlayhead} onPaused={() => setPlaying(false)}
                        onEnded={() => { setPlaying(false); setPlayhead(0); }}
                      />
                    ) : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>Preparing…</div>}
                  </SideBox>
                  <span style={{ fontSize: 11, color: selectedMarker ? C.green : C.dim, fontWeight: selectedMarker ? 700 : 400 }}>
                    {selectedMarker ? `Your edit ${fmtTime(selectedMarker.t)}` : `Your video${match > 0 ? ` · ${match}% match` : ''}`}
                  </span>
                </div>
              </div>
            ) : iterView === 'ref' && refUrl ? (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ ...previewBox(plan?.frame.ratio), background: C.media, borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.b3}` }}>
                  <video ref={refVideoRef} src={refUrl} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center' }}>{resultVideo}</div>
            )}

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
                {refMoment && (
                  <span style={{ display: 'block', marginTop: 6, color: C.green, fontSize: 12.5 }}>
                    In the reference, this happens at <b>{fmtTime(refMoment.t)}</b>{iterView !== 'side' && refUrl ? ' — showing side by side.' : ''} {refMoment.note}
                  </span>
                )}
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
        <div style={{ position: 'fixed', top: 58, right: 130, zIndex: 9500, width: 300, background: C.surface, border: `1px solid ${C.b3}`, borderRadius: 12, boxShadow: '0 24px 60px rgba(31,54,110,0.18)', padding: 8, maxHeight: '60vh', overflowY: 'auto' }}>
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
    <div style={{ width: 'min(42vw, 300px)', aspectRatio: '9 / 16', background: C.media, borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.b3}`, boxShadow: '0 18px 50px rgba(31,54,110,0.16)' }}>
      <span style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#fff', background: 'rgba(15,27,51,0.55)', padding: '3px 8px', borderRadius: 6 }}>{title}</span>
      {children}
    </div>
  );
}

/* ─────────── side-by-side box (iterate view) ─────────── */
function SideBox({ label, highlight, children }: { label: string; highlight: boolean; children: React.ReactNode }) {
  return (
    <div style={{ width: 'min(38vw, 240px)', aspectRatio: '9 / 16', background: C.media, borderRadius: 12, overflow: 'hidden',
      position: 'relative', border: `2px solid ${highlight ? C.accent : C.b3}`,
      boxShadow: highlight ? `0 0 0 3px ${C.accent}33` : 'none', transition: 'border 160ms' }}>
      <span style={{ position: 'absolute', top: 7, left: 7, zIndex: 3, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
        color: '#fff', background: 'rgba(15,27,51,0.55)', padding: '3px 7px', borderRadius: 6 }}>{label}</span>
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
        <div style={{ position: 'absolute', top: -6, bottom: -6, width: 2.5, background: C.accent, borderRadius: 2, boxShadow: `0 0 8px ${C.accent}88`, left: `${(playheadS / dur) * 100}%`, pointerEvents: 'none' }} />
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
                fontSize: m.type === 'cut' ? 13 : m.type === 'caption' ? 11 : 13, fontWeight: 800, color: '#0B0F1A',
                background: color, boxShadow: active ? `0 0 0 3px ${color}44` : 'none', border: active ? '2px solid #FFFFFF' : 'none', lineHeight: 1 }}>
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
type RefState =
  | { kind: 'none' }
  | { kind: 'file'; file: File }
  | { kind: 'link'; url: string; file: File };

function DropScreen({ projectId, projectName, mode, onModeChange, hasFootage, onFootage, onReference, onStart, refInputRef, error }: {
  projectId: string; projectName: string; mode: 'edit' | 'reference'; onModeChange: (m: 'edit' | 'reference') => void;
  hasFootage: boolean;
  onFootage: (f: File) => void;
  onReference: (ref: File | null, range: { startS: number; endS: number } | null, note: string) => void;
  onStart: (note: string) => void;
  refInputRef: React.RefObject<HTMLInputElement | null>; error: string | null;
}) {
  const footageRef = useRef<HTMLInputElement>(null);
  const [footName, setFootName] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  /** In plain Edit mode the optional reference block starts collapsed. */
  const [refOpen, setRefOpen] = useState<boolean>(mode === 'reference');
  const [ref, setRef] = useState<RefState>({ kind: 'none' });

  /** Switching mode inside the app also opens/closes the reference block. */
  const switchMode = (m: 'edit' | 'reference') => {
    if (m === mode) return;
    onModeChange(m);
    setShowLink(false);
    if (m === 'reference') setRefOpen(true);
    else if (ref.kind === 'none') setRefOpen(false);
  };
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [rangeText, setRangeText] = useState('');
  const [note, setNote] = useState('');
  const ready = !!hasFootage || !!footName;
  const refReady = ref.kind !== 'none';

  const useLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setLinkBusy(true); setLinkError(null);
    try {
      const { fetchReferenceLink } = await import('@/lib/referenceLink');
      const res = await fetchReferenceLink(url);
      if (res.ok && res.file) {
        setRef({ kind: 'link', url, file: res.file });
        setLinkError(null);
      } else if (res.kind === 'platform') {
        setLinkError(res.error ?? `I can't download a ${res.platform} page. Use a direct video link or upload the file.`);
      } else {
        setLinkError(res.error ?? 'Could not fetch that link.');
      }
    } catch {
      setLinkError('Could not fetch that link.');
    } finally {
      setLinkBusy(false);
    }
  };

  const parseRange = (): { startS: number; endS: number } | null => parseTimeRange(rangeText);

  const rangeValid = !rangeText.trim() || !!parseRange();

  const create = () => {
    if (!ready || !rangeValid || linkBusy) return;
    const n = note.trim();
    if (ref.kind === 'none') { onStart(n); return; }
    onReference(ref.file, parseRange(), n);
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 54, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', borderBottom: `1px solid ${C.b}` }}>
        <Link href="/dashboard" style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13 }}><ArrowLeft size={15} /> Projects</Link>
        <div style={{ marginLeft: 'auto' }}><LogoMark size={24} /></div>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: 'min(92vw, 560px)' }}>
          {/* In-app mode switcher — the two doors, available right here. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 22 }}>
            <ModePill
              active={mode === 'edit'} hero={false}
              icon={<Film size={15} />} title="Edit"
              hint="Footage + instructions"
              onClick={() => switchMode('edit')}
            />
            <ModePill
              active={mode === 'reference'} hero
              icon={<Sparkles size={15} />} title="Reference edit"
              hint="Match a video's style"
              onClick={() => switchMode('reference')}
            />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 6px' }}>
            {mode === 'reference' ? 'Edit your footage like a video you love' : 'What are we editing today?'}
          </h1>
          <p style={{ color: C.muted, fontSize: 14, margin: '0 0 26px' }}>
            {mode === 'reference'
              ? <>Add your footage and a reference — upload it or paste a link. Modaya extracts its editing DNA and applies it to your video.</>
              : <>Drop your footage and tell Modaya what you want. Add a reference anytime if you want to match a specific style.</>}
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

          {/* Reference block — front-and-centre in reference mode, collapsed by
              default in plain Edit mode. The reference is STYLE material, never
              footage Modaya copies. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 8px' }}>
            <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              Reference {mode === 'reference' ? '' : '· optional'}
            </p>
            {mode === 'reference' && (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: C.accent, background: `${C.accent}14`, borderRadius: 999, padding: '2px 8px' }}>Style DNA</span>
            )}
          </div>

          {/* Collapsed add-reference row (plain Edit mode, nothing chosen yet) */}
          {!refOpen && !refReady ? (
            <button
              onClick={() => setRefOpen(true)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                padding: '16px 18px', borderRadius: 14, cursor: 'pointer',
                background: C.s2, border: `1.5px dashed ${C.b3}`, color: C.text, fontFamily: F }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: C.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, flexShrink: 0 }}>
                <Sparkles size={17} />
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>Add a reference to match a style</span>
                <span style={{ display: 'block', color: C.dim, fontSize: 12, marginTop: 1 }}>Upload a video or paste a link — Modaya copies its pacing and feel</span>
              </span>
              <Plus size={16} color={C.muted} />
            </button>
          ) : (
          /* One reference card: drop a file, or pick either action — upload or
              paste a link. */
          <div
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && f.type.startsWith('video/')) { setRef({ kind: 'file', file: f }); setShowLink(false); } }}
            style={{ background: refReady ? `${C.accent}0e` : (mode === 'reference' ? `linear-gradient(180deg, ${C.accent}0d, ${C.s2} 70%)` : C.s2),
              border: `1.5px ${refReady || mode === 'reference' ? 'solid' : 'dashed'} ${refReady ? C.accent + '66' : mode === 'reference' ? C.accent + '44' : C.b3}`,
              borderRadius: 14, padding: refReady ? 16 : 22, position: 'relative' }}>
            {mode === 'edit' && (
              <button onClick={() => { setRefOpen(false); setShowLink(false); }}
                style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 12, fontFamily: F }}>
                Collapse
              </button>
            )}
            <input ref={refInputRef} type="file" accept="video/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) { setRef({ kind: 'file', file: f }); setShowLink(false); } e.target.value = ''; }} />

            {refReady ? (
              /* Filled state — reference chosen (file or fetched link) */
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: `${C.accent}1c`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, flexShrink: 0 }}>
                  {ref.kind === 'link' ? <LinkIcon size={18} /> : <Upload size={17} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref.file.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.dim, marginTop: 1 }}>
                    {ref.kind === 'link' ? 'From a link · style reference' : 'Uploaded · style reference'}
                  </span>
                </span>
                <button onClick={() => { setRef({ kind: 'none' }); setLinkUrl(''); setLinkError(null); setShowLink(false); }}
                  style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12.5, fontFamily: F, flexShrink: 0 }}>
                  Change
                </button>
              </div>
            ) : showLink ? (
              /* Paste-a-link action */
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <LinkIcon size={17} color={C.accent} style={{ flexShrink: 0 }} />
                  <input
                    autoFocus value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void useLink(); if (e.key === 'Escape') setShowLink(false); }}
                    placeholder="Paste a video link…  https://…/clip.mp4"
                    style={{ flex: 1, minWidth: 0, background: C.s3, border: `1px solid ${C.b3}`, borderRadius: 9, color: C.text,
                      fontFamily: F, fontSize: 13, padding: '10px 12px', outline: 'none' }} />
                  <button onClick={useLink} disabled={linkBusy || !linkUrl.trim()}
                    style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: linkUrl.trim() && !linkBusy ? C.accent : C.b3,
                      color: '#fff', fontSize: 13, fontWeight: 600, cursor: linkUrl.trim() && !linkBusy ? 'pointer' : 'default', fontFamily: F, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {linkBusy ? <Loader2 size={14} className="spin" /> : null} Fetch
                  </button>
                </div>
                {linkError ? (
                  <p style={{ color: C.warn, fontSize: 12, margin: '10px 2px 0', lineHeight: 1.5 }}>{linkError}</p>
                ) : (
                  <p style={{ color: C.dim, fontSize: 11, margin: '10px 2px 0', lineHeight: 1.5 }}>
                    Works with a direct video link (.mp4/.webm/…). YouTube, TikTok and Instagram page links can&apos;t be downloaded — use the Upload button for those. The link is style reference, never footage Modaya copies.
                  </p>
                )}
                <button onClick={() => { setShowLink(false); setLinkError(null); }}
                  style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, fontFamily: F, marginTop: 8, padding: 0 }}>
                  ← Upload a file instead
                </button>
              </>
            ) : (
              /* Empty state — the two actions both visible, matching the mock */
              <>
                <div onClick={() => refInputRef.current?.click()}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '6px 0 4px' }}>
                  <span style={{ color: C.sec, fontSize: 14, fontWeight: 600 }}>Drop a reference video here</span>
                  <span style={{ color: C.dim, fontSize: 12 }}>or</span>
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
                  <button onClick={() => refInputRef.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, border: `1px solid ${C.accent}55`,
                      background: `${C.accent}14`, color: C.accent, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>
                    <Upload size={15} /> Upload video
                  </button>
                  <button onClick={() => setShowLink(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, border: `1px solid ${C.b3}`,
                      background: C.s3, color: C.sec, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: F }}>
                    <LinkIcon size={15} /> Paste video link
                  </button>
                </div>
                <p style={{ textAlign: 'center', color: C.dim, fontSize: 11, margin: '12px 0 0', lineHeight: 1.5 }}>
                  Modaya learns its editing style — pacing, cuts, transitions, captions — and applies it to your footage.
                </p>
              </>
            )}
          </div>
          )}

          {/* Optional time range — learn the style from just one section */}
          {refReady && (
            <>
              <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '16px 0 8px' }}>Use a section · optional</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.sec, fontSize: 13, fontWeight: 600, flexShrink: 0 }}>Use:</span>
                <input
                  value={rangeText} onChange={e => setRangeText(e.target.value)}
                  placeholder="00:12 – 01:04"
                  style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', background: C.s2, border: `1.5px solid ${rangeValid ? C.b3 : C.danger}`, borderRadius: 10,
                    color: C.text, fontFamily: F, fontSize: 14, padding: '10px 12px', outline: 'none' }} />
              </div>
              {!rangeValid
                ? <p style={{ color: C.danger, fontSize: 11, margin: '6px 2px 0' }}>Use a range like 00:12 – 01:04.</p>
                : <p style={{ color: C.dim, fontSize: 11, margin: '6px 2px 0' }}>Only learn the style from this part of a long reference.</p>}
            </>
          )}

          <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '20px 0 8px' }}>Instructions · optional</p>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            rows={2} placeholder={'e.g. "Create a 60-second cinematic edit. Keep the reference\'s pacing and transitions."'}
            style={{ width: '100%', boxSizing: 'border-box', background: C.s2, border: `1.5px solid ${C.b3}`, borderRadius: 12, color: C.text,
              fontFamily: F, fontSize: 14, lineHeight: 1.5, padding: '12px 14px', resize: 'vertical', outline: 'none' }}
          />

          {error && <p style={{ color: C.danger, fontSize: 13, margin: '16px 0 0' }}>{error}</p>}

          <div style={{ marginTop: 26 }}>
            <GlowButton size="lg" fullWidth onClick={create} disabled={!ready || !rangeValid || linkBusy}
              icon={<Wand2 size={18} />}>
              {linkBusy ? 'Fetching reference…' : refReady ? 'Generate edit in this style' : 'Generate my edit'}
            </GlowButton>
          </div>
          <p style={{ textAlign: 'center', color: C.dim, fontSize: 11, margin: '12px 0 0' }}>
            {projectName} · You don&apos;t edit the video — you tell Modaya how you want it edited.
          </p>
        </div>
      </div>
    </div>
  );
}

/** One option in the in-app Edit / Reference Edit switcher. */
function ModePill({ active, hero, icon, title, hint, onClick }: {
  active: boolean; hero: boolean; icon: React.ReactNode; title: string; hint: string; onClick: () => void;
}) {
  // Reference is the hero (accent glow); Edit uses a neutral active state.
  const edge = active ? (hero ? C.accent : C.muted) : C.b3;
  const fg = active ? (hero ? C.accent : C.text) : C.muted;
  return (
    <button onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left',
        padding: '12px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: F,
        border: `1.5px solid ${edge}`,
        background: active
          ? (hero ? `linear-gradient(135deg, ${C.accent}1c, ${C.s2})` : C.s3)
          : C.s2,
        boxShadow: active && hero ? `0 6px 22px ${C.accent}22` : 'none',
        color: C.text, transition: 'all 140ms',
      }}>
      <span style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? (hero ? `${C.accent}22` : C.b3) : C.s3,
        border: `1px solid ${active ? (hero ? `${C.accent}55` : C.b3) : C.b3}`,
        color: fg,
      }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {title}
          {hero && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: '#1a1405', background: C.gold ?? '#F5C451', borderRadius: 999, padding: '2px 6px' }}>Hero</span>}
        </span>
        <span style={{ display: 'block', fontSize: 11.5, color: active ? C.sec : C.dim, marginTop: 1 }}>{hint}</span>
      </span>
    </button>
  );
}

function LinkIcon({ size = 16, color, style }: { size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
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
  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 999,
  background: GLOW_GRADIENT, color: '#fff', border: 'none', fontFamily: F, fontSize: 14, fontWeight: 700,
  cursor: 'pointer', boxShadow: '0 8px 24px rgba(90,110,255,0.40)',
};
const ghostBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 10,
  background: C.s3, color: C.sec, border: `1px solid ${C.b3}`, fontFamily: F, fontSize: 13, fontWeight: 500,
  cursor: 'pointer', textDecoration: 'none',
};
