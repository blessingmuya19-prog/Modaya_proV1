'use client';
/**
 * Studio — the default Modaya experience.
 *
 * The product rule: the user drops footage (and, optionally, a reference
 * video) and Modaya does the editing. There is no timeline, no codec, no
 * parameters. The user watches named creative stages complete, then gets a
 * preview they can Export, Regenerate, or adjust by typing what they want
 * changed.
 *
 * There is ONE AI: every user instruction (drop-screen brief + chat
 * refinements) goes to /api/projects/[id]/ai, and its answer is what lands
 * on the timeline. The deterministic composer only builds the default cut
 * when no instruction was given, or covers for an unreachable AI.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Film, Upload, Wand2, Download, RefreshCw, Sparkles, Send,
  CheckCircle2, Loader2, Plus, Copy, Check, User, Bot, RotateCcw,
  Layers, Play, Pause, Palette, Scissors, SunMedium, Type, Zap, X, ZoomIn,
  ChevronDown
} from 'lucide-react';
import { LogoMark } from '../ui/Logo';
import { getMedia, setMedia, subscribeMedia, analyseFile, type MediaEntry } from '@/lib/videoStore';
import { saveMediaFile, saveBrollLibrary, saveBrollFile, loadBrollLibrary, deleteBrollFiles, type BrollMeta } from '@/lib/mediaDb';
import { getProjectMedia, uploadProjectMedia, getReferenceBlob, getBrollLibrary, backupBrollToCloud, trimCloudBroll } from '@/lib/mediaCloud';
import { analyseAudio, analyseReference, interestCurve } from '@/lib/ai/analyseReference';
import type { StyleProfile } from '@/lib/ai/styleProfile';
import { composeStudioPlan, type StudioPlan, type PlannedShot, type TranscriptLine } from '@/lib/studio/editPlan';
import {
  toAiView, applyAiResult, syncProfileAfterAi, transcriptPayload,
  applyAiLook, uncutStudioPlan, styleForAi, needsVision, needsTranscript, wantsClips,
  type AiClip,
} from '@/lib/studio/aiBridge';
import { detectSilences } from '@/lib/ai/operations';
import { transcribeMedia } from '@/lib/ai/transcribeClient';
import { scanVideo, compactScan, type VisualScan, type Keyframe } from '@/lib/ai/visualScan';
import type { ClipSuggestion } from '@/lib/ai/clips';
import { DEFAULT_EFFECTS } from '@/lib/render/sequence';
import { buildSequence, type Sequence, type StyleLayer } from '@/lib/render/sequence';
import PreviewCanvas from './PreviewCanvas';
import { ExportModal } from './ExportModal';
import {
  stagesForRun, markActive, markDone, pipelineProgress, referenceMatch, resultHeadline,
  type StageState, type StageId,
} from '@/lib/studio/pipeline';
import { buildEditMap, explainMarker, markerIcon, fmtTime, referenceMoment, type EditMarker, type RefMoment } from '@/lib/studio/editMap';
import { addVersion, loadVersions, type EditVersion } from '@/lib/studio/versions';
import { parseTimeRange } from '@/lib/referenceLink';
import { GlowButton, GLOW_GRADIENT } from '../ui/theme';
import type { EditorClip } from '@/lib/studio/editorTypes';

const F = "'Inter',system-ui,-apple-system,sans-serif";
/**
 * Dark, premium SaaS theme. `surface`/`s2`/`s3` are the charcoal raised
 * panels and wells; `media` is the near-black video canvas (darkest of all).
 */
const C = {
  bg: '#000000', surface: '#0A0A0B', s2: '#131316', s3: '#1C1C21',
  b: '#27272A', b2: '#3F3F46', b3: '#3F3F46',
  accent: '#FAFAFA', accentH: '#D4D4D8',
  text: '#FAFAFA', sec: '#D4D4D8', muted: '#A1A1AA', dim: '#71717A',
  green: '#34D399', gold: '#F4F4F5',
  danger: '#F87171', warn: '#A1A1AA', broll: '#71717A',
  media: '#000000', mediaBorder: '#27272A', mediaShade: 'rgba(0,0,0,0.55)',
};

type Phase = 'drop' | 'working' | 'result';

/** One clip in the project's B-roll library — extra footage dropped purely as
 *  cutaway material. The plan reads silent windows from these instead of
 *  recycling parts of the main footage. */
interface BrollItem {
  blob:      Blob;
  /** Object URL for the renderer (one per clip, revoked on removal). */
  url:       string;
  name:      string;
  mimeType:  string;
  /** Probed from the bytes; 0 until the probe settles. */
  durationS: number;
}

/** The source id the renderer knows a library clip by (registered via
 *  engine.setSource alongside the main footage). */
const brollSourceId = (index: number) => `broll-${index}`;

/** Probe a video blob's duration without keeping a player around. */
function probeVideoDuration(blob: Blob): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    const done = (d: number) => { URL.revokeObjectURL(url); resolve(d); };
    el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    setTimeout(() => done(isFinite(el.duration) ? el.duration : 0), 4000);
    el.src = url;
  });
}

/** In-memory fast cache for uploaded footage within the current session. */
const sessionFootageCache = new Map<string, FootageSource>();

/** The footage bytes Modaya analyses, plus enough metadata to run. */
interface FootageSource {
  blob: Blob;
  filename: string;
  durationS: number;
  mimeType: string;
}

/**
 * Resolve the project's footage bytes from the best available source:
 *   1. the in-memory fast session cache,
 *   2. the persistent store (IndexedDB hot path, then the durable cloud), and
 *   3. this session's in-memory entry — it holds a `blob:` object URL from
 *      which the bytes can be fetched even when the file was too big for
 *      IndexedDB (600 MB cap / quota / private mode) on a host with no
 *      durable cloud.
 * Returns null only when there is truly no footage anywhere.
 */
async function resolveFootage(projectId: string, entry: MediaEntry | null): Promise<FootageSource | null> {
  const inMem = sessionFootageCache.get(projectId);
  if (inMem && inMem.blob && inMem.blob.size > 0) {
    return inMem;
  }

  const stored = await getProjectMedia(projectId).catch(() => null);
  if (stored?.blob && stored.blob.size > 0) {
    const src: FootageSource = {
      blob: stored.blob,
      filename: stored.filename || entry?.filename || 'footage.mp4',
      durationS: stored.durationS || entry?.durationS || 0,
      mimeType: stored.mimeType || entry?.mimeType || 'video/mp4',
    };
    sessionFootageCache.set(projectId, src);
    return src;
  }

  const url = entry?.objectUrl;
  if (url && url.startsWith('blob:')) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          const src: FootageSource = {
            blob,
            filename: entry?.filename || 'footage.mp4',
            durationS: entry?.durationS || 0,
            mimeType: entry?.mimeType || blob.type || 'video/mp4',
          };
          sessionFootageCache.set(projectId, src);
          return src;
        }
      }
    } catch { /* object URL gone — fall through */ }
  }
  return null;
}

function clipToEditor(c: {
  id: string;
  trackId?: string;
  label: string;
  startS: number;
  endS: number;
  type?: string;
  textPosition?: string;
  textAlign?: string;
  textStyle?: unknown;
}): EditorClip {
  return {
    id: c.id,
    trackId: c.trackId ?? (c.type === 'text' ? 'text' : 'video'),
    label: c.label,
    startS: c.startS,
    endS: c.endS,
    type: (c.type ?? 'video') as EditorClip['type'],
    textPosition: c.textPosition as EditorClip['textPosition'] | undefined,
    textAlign: c.textAlign as EditorClip['textAlign'] | undefined,
    textStyle: c.textStyle as EditorClip['textStyle'] | undefined,
  };
}

interface StudioChatMsg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: string;
  version?: {
    number: number;
    label: string;
    stats?: { durationS: number; cuts: number; match?: number };
    versionId?: string;
  };
  diffs?: { label: string; value: string }[];
  suggestions?: string[];
  /** One-line edit summary shown as a chip (what actually happened). */
  summary?: string;
  savedS?: number;
  /** Standalone short clips the AI suggested — one tap cuts to it. */
  clips?: ClipSuggestion[];
}

function getDiffBadges(prev: StyleProfile, next: StyleProfile): { label: string; value: string }[] {
  const diffs: { label: string; value: string }[] = [];
  if (prev.uncut !== next.uncut) {
    diffs.push({ label: 'Footage', value: next.uncut ? 'Uncut (100% full)' : 'Trimmed' });
  }
  if (prev.grade.saturation !== next.grade.saturation || prev.grade.contrast !== next.grade.contrast || prev.grade.warmth !== next.grade.warmth) {
    const isVibrant = next.grade.saturation > 1.25;
    const isWarm = next.grade.warmth > 0.08;
    diffs.push({ label: 'Color Grade', value: isVibrant ? (isWarm ? 'Vibrant Warm' : 'Vibrant') : 'Custom' });
  }
  if (prev.pace !== next.pace) {
    diffs.push({ label: 'Pacing', value: next.pace.toUpperCase() });
  }
  if (prev.captions.present !== next.captions.present || prev.captions.position !== next.captions.position) {
    diffs.push({ label: 'Captions', value: next.captions.present ? `Active (${next.captions.position})` : 'Disabled' });
  }
  if (prev.punchInRate !== next.punchInRate) {
    diffs.push({ label: 'Punch-ins', value: next.punchInRate > 0 ? `${Math.round(next.punchInRate * 100)}%` : 'Off' });
  }
  if (prev.targetRatio !== next.targetRatio) {
    diffs.push({ label: 'Aspect Ratio', value: next.targetRatio ?? 'Original' });
  }
  return diffs;
}

function getSmartSuggestions(profile: StyleProfile, hasRef: boolean): string[] {
  const suggestions: string[] = [];
  suggestions.push('Find me 3 viral clips');
  if (hasRef) {
    suggestions.push('Color grade like reference');
  }
  if (!profile.uncut) {
    suggestions.push("Don't cut anything");
  } else {
    suggestions.push('Make pacing fast');
  }
  if (!profile.captions.present) {
    suggestions.push('Add bold captions');
  } else {
    suggestions.push('Center captions');
  }
  if (profile.grade.saturation < 1.3) {
    suggestions.push('Make it vibrant and bright');
  } else {
    suggestions.push('Reset color grade');
  }
  return suggestions.slice(0, 4);
}

function formatMessageText(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} style={{ color: '#fff', fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function getSuggestionIcon(suggestion: string) {
  const lower = suggestion.toLowerCase();
  if (lower.includes('color') || lower.includes('grade') || lower.includes('warmth')) return Palette;
  if (lower.includes('vibrant') || lower.includes('bright') || lower.includes('glow')) return SunMedium;
  if (lower.includes('cut') || lower.includes('trim') || lower.includes('uncut')) return Scissors;
  if (lower.includes('caption') || lower.includes('subtitle') || lower.includes('text')) return Type;
  if (lower.includes('pace') || lower.includes('fast') || lower.includes('speed') || lower.includes('rhythm')) return Zap;
  if (lower.includes('zoom') || lower.includes('punch')) return ZoomIn;
  if (lower.includes('reset') || lower.includes('revert')) return RotateCcw;
  return Sparkles;
}

function renderMarkerIcon(type: EditMarker['type']) {
  switch (type) {
    case 'hook': return <Sparkles size={11} color="#000000" />;
    case 'cut': return <Scissors size={11} color="#000000" />;
    case 'zoom': return <ZoomIn size={11} color="#000000" />;
    case 'caption': return <Type size={11} color="#000000" />;
    case 'broll': return <Film size={11} color="#000000" />;
    default: return <Sparkles size={11} color="#000000" />;
  }
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

  const [chats, setChats] = useState<StudioChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* ── Chat scrolling ──
     The message list is its own scroll region; the page never scrolls for it.
     `chatStickRef` tracks whether the user is looking at the newest messages,
     so auto-scroll only runs while pinned — reading old history is never
     interrupted by a new reply. A "Jump to latest" pill appears otherwise. */
  const chatStickRef = useRef(true);
  const [showJumpLatest, setShowJumpLatest] = useState(false);

  const scrollChatToBottom = useCallback((smooth: boolean) => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const onChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    chatStickRef.current = nearBottom;
    setShowJumpLatest(prev => (prev === !nearBottom ? prev : !nearBottom));
  }, []);

  /* A new message (or the thinking indicator) arrived → stay pinned to the
     newest message when the user is at the bottom. */
  useEffect(() => {
    if (!chatStickRef.current) return;
    scrollChatToBottom(true);
  }, [chats, chatBusy, scrollChatToBottom]);

  // ── result surface: compare / edit-map / versions / reference ──
  /** 'compare' (reference vs result) or 'iterate' (video + chat + edit map). */
  const [resultView, setResultView] = useState<'compare' | 'iterate'>('iterate');

  /* Returning to the iterate view re-mounts the chat column — snap to the
     newest message instead of leaving the user stranded at the top. */
  useEffect(() => {
    if (resultView !== 'iterate') return;
    chatStickRef.current = true;
    setShowJumpLatest(false);
    scrollChatToBottom(false);
  }, [resultView, scrollChatToBottom]);
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
    /** Grounding for the AI route: measured pauses + audio state. */
    silences: [number, number][];
    audio: 'pending' | 'ready' | 'failed';
  } | null>(null);
  /** What the browser measured from the pixels + frames a model can see.
   *  Stored separately from ctx so the background scan can finish after the
   *  first-pass context was already captured. */
  const visualRef = useRef<VisualScan | null>(null);
  const framesRef = useRef<Keyframe[]>([]);
  /** Undo stack: an AI edit is reversible, exactly as the editor was. */
  const undoRef = useRef<{
    plan: StudioPlan; styleLayer: StyleLayer; profile: StyleProfile; seed: number;
  }[]>([]);
  const [undoable, setUndoable] = useState(false);
  /** Whether a provider is configured — discovered once, gates auto-
   *  transcription for clip hunting (measurement clips never need it). */
  const aiReadyRef = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/ai')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) aiReadyRef.current = !!d?.configured; })
      .catch(() => { if (!cancelled) aiReadyRef.current = false; });
    return () => { cancelled = true; };
  }, []);
  /** The profile currently driving the edit (reference/default, then refined). */
  const profileRef = useRef<StyleProfile | null>(null);
  const seedRef = useRef(1);
  /** Free-text instruction from the drop screen, used to label Version 1. */
  const initialNoteRef = useRef('');

  // ── B-roll library: optional extra clips used purely as cutaways ──
  const [brollItems, setBrollItems] = useState<BrollItem[]>([]);
  /** Mirror for callbacks (run/applyPlan) so they never see stale items. */
  const brollRef = useRef<BrollItem[]>([]);
  brollRef.current = brollItems;
  /** Highest count ever persisted locally, so a shrink can delete the extras. */
  const brollPersistedCountRef = useRef(0);

  /** Rewrite the local IndexedDB copy of the library (blobs by index). */
  const persistBrollLocal = useCallback(async (items: BrollItem[]) => {
    if (!projectId) return;
    const prevCount = brollPersistedCountRef.current;
    const meta: BrollMeta[] = items.map(it => ({
      filename: it.name, mimeType: it.mimeType,
      durationS: it.durationS, width: 0, height: 0,
    }));
    await saveBrollLibrary(projectId, meta).catch(() => {});
    for (let i = 0; i < items.length; i++) {
      await saveBrollFile(projectId, i, items[i].blob, meta[i]).catch(() => {});
    }
    if (prevCount > items.length) {
      await deleteBrollFiles(projectId, prevCount).catch(() => {});
    }
    brollPersistedCountRef.current = items.length;
  }, [projectId]);

  /** Drop-screen: files added to the B-roll library. Durations are probed
   *  from the bytes (the plan needs them to bound its cutaway windows). */
  const addBrollFiles = useCallback((files: File[]) => {
    const vids = files.filter(f => f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name));
    if (!vids.length) return;
    const added: BrollItem[] = vids.map(f => ({
      blob: f, url: URL.createObjectURL(f), name: f.name,
      mimeType: f.type || 'video/mp4', durationS: 0,
    }));
    const next = [...brollRef.current, ...added];
    brollRef.current = next;                 // visible to a second drop in the same tick
    setBrollItems(next);
    void persistBrollLocal(next);
    // Probe the new clips, then persist the corrected durations.
    void Promise.all(added.map(a => probeVideoDuration(a.blob))).then(durs => {
      const updated = brollRef.current.map(it => {
        const k = added.findIndex(a => a.blob === it.blob && it.durationS === 0);
        return k >= 0 && durs[k] > 0 ? { ...it, durationS: durs[k] } : it;
      });
      brollRef.current = updated;
      setBrollItems(updated);
      void persistBrollLocal(updated);
    });
  }, [persistBrollLocal]);

  /** Drop-screen: remove one library clip (indexes shift down). */
  const removeBroll = useCallback((index: number) => {
    const prev = brollRef.current;
    if (index < 0 || index >= prev.length) return;
    URL.revokeObjectURL(prev[index].url);
    const next = prev.filter((_, i) => i !== index);
    brollRef.current = next;
    setBrollItems(next);
    void persistBrollLocal(next);
    void trimCloudBroll(projectId, next.length);
  }, [persistBrollLocal, projectId]);

  /** Sources the renderer must know about, id → object URL. */
  const brollSources = useMemo(() => {
    const map: Record<string, string> = {};
    brollItems.forEach((it, i) => { map[brollSourceId(i)] = it.url; });
    return map;
  }, [brollItems]);

  // Rehydrate the library on reopen: IndexedDB first, then the durable store.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void (async () => {
      const stored = await getBrollLibrary(projectId).catch(() => [] as Awaited<ReturnType<typeof getBrollLibrary>>);
      if (!alive || !stored.length) return;
      brollPersistedCountRef.current = stored.length;
      const items: BrollItem[] = stored.map(it => ({
        blob: it.blob, url: URL.createObjectURL(it.blob),
        name: it.filename, mimeType: it.mimeType, durationS: it.durationS,
      }));
      setBrollItems(items);
      if (items.some(it => !it.durationS)) {
        const durs = await Promise.all(items.map(it => it.durationS || probeVideoDuration(it.blob)));
        if (!alive) return;
        setBrollItems(items.map((it, i) => ({ ...it, durationS: durs[i] || it.durationS })));
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  /** When the library (re)hydrates into an already-finished project, rebuild
   *  the current version's plan so its cutaways read from the library instead
   *  of silently falling back to source windows. Deterministic: the same
   *  profile + seed + library always produces the same plan. */
  useEffect(() => {
    if (phase !== 'result' || !ctxRef.current || !profileRef.current) return;
    if (!brollItems.length) return;
    if (brollItems.some(it => !it.durationS)) return;   // probe still pending
    applyPlan(profileRef.current, seedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brollItems, phase]);

  /** Compose the EditPlan from the current profile and push it to the preview.
   *  Shared by the first run, Regenerate and every chat refinement. Returns
   *  the plan plus the grounded reference-match score. */
  const applyPlan = useCallback((profile: StyleProfile, seed: number): { plan: StudioPlan; match: number } | null => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const curMedia = projectId ? getMedia(projectId) : null;
    const sourceRatio: '16:9' | '9:16' | '1:1' = curMedia && curMedia.width && curMedia.height
      ? (curMedia.width >= curMedia.height * 1.25 ? '16:9' : curMedia.height >= curMedia.width * 1.25 ? '9:16' : '1:1')
      : '16:9';

    if (!profile.sourceName && (ctx.sourceName || projectName)) {
      profile.sourceName = ctx.sourceName || projectName;
    }

    const plan = composeStudioPlan({
      profile, sourceDurationS: ctx.durationS,
      interest: ctx.interest, onsets: ctx.onsets,
      transcript: ctx.transcript.length ? ctx.transcript : undefined,
      // Uploaded cutaway library, when one exists — the plan then reads its
      // B-roll windows from these clips instead of the main footage.
      brollLibrary: brollRef.current.map((it, i) => ({ id: brollSourceId(i), durationS: it.durationS })),
      seed,
      sourceRatio,
    });
    setPlan(plan);
    setFrame({ width: plan.frame.width, height: plan.frame.height });
    const mapped = plan.clips.map(clipToEditor);
    const layer: StyleLayer = {};
    for (const c of plan.clips) {
      if (c.type === 'video') {
        layer[c.id] = {
          sourceIn: c.sourceIn,
          // A library cutaway reads from its own media object.
          ...(c.sourceId ? { sourceId: c.sourceId } : {}),
          transform: c.transform, effects: c.effects,
        };
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
  }, [projectId]);

  /** Persist a newly composed plan as the next version (never overwrites). */
  const saveVersion = useCallback(async (
    profile: StyleProfile, seed: number, note: string,
    built: { plan: StudioPlan; match: number },
    snapshot?: { clips: PlannedShot[]; durationS: number; frame: StudioPlan['frame'] },
  ) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      const { versions: vs } = await addVersion(projectId, {
        profile, seed, hasRef: ctx.hasRef, refName, note: note || undefined,
      }, { durationS: built.plan.durationS, cuts: built.plan.cutCount, match: built.match },
        snapshot);
      setVersions(vs);
    } catch { /* versioning is non-blocking */ }
  }, [projectId, refName]);

  /** Rebuild a specific past version from its recipe (deterministic). */
  const restoreVersion = useCallback((v: EditVersion) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    profileRef.current = v.recipe.profile;
    seedRef.current = v.recipe.seed;
    /* Versions produced by the Pro AI carry a timeline snapshot, since its
       edits do not replay through composeStudioPlan. */
    const built = v.snapshot
      ? (() => {
          const restored: StudioPlan = {
            clips: v.snapshot!.clips,
            durationS: v.snapshot!.durationS,
            removedS: Math.max(0, ctx.durationS - v.snapshot!.durationS),
            cutCount: v.snapshot!.clips.filter(c => c.type === 'video' && c.trackId === 'video').length,
            summary: `Version ${v.number} restored`,
            profileName: v.recipe.profile.sourceName,
            frame: v.snapshot!.frame,
            captions: v.snapshot!.clips.filter(c => c.type === 'text').length,
            broll: v.snapshot!.clips.filter(c => c.type === 'video' && c.trackId !== 'video').length,
            brollFromLibrary: false,
            hookFirst: false,
          };
          const layer: StyleLayer = {};
          for (const c of restored.clips) {
            if (c.type === 'video') layer[c.id] = { sourceIn: c.sourceIn, transform: c.transform, effects: c.effects };
          }
          setPlan(restored);
          setClips(restored.clips.map(clipToEditor));
          setStyleLayer(layer);
          setTotalS(restored.durationS);
          return { plan: restored, match: v.stats?.match ?? 0 } as { plan: StudioPlan; match: number };
        })()
      : applyPlan(v.recipe.profile, v.recipe.seed);
    if (built) {
      setHeadline(resultHeadline({
        hasReference: ctx.hasRef, match: built.match, durationS: built.plan.durationS,
      }));
      setChats(c => [...c, {
        id: `restore-${Date.now()}`,
        role: 'ai',
        text: `Switched back to **${v.label}** (Version ${v.number}). Any new request will branch from this version.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        version: {
          number: v.number,
          label: v.label,
          stats: v.stats,
          versionId: v.id,
        },
        suggestions: getSmartSuggestions(v.recipe.profile, ctx.hasRef),
      }]);
    }
    setSelectedMarker(null);
  }, [applyPlan]);

  const sourceUrl = media?.objectUrl ?? null;

  const sequence: Sequence | null = useMemo(() => {
    if (!media || !clips.length) return null;
    // The output frame follows the plan's format (9:16 vertical for shorts),
    // not the source media's shape — the renderer cover-crops to fit it.
    return buildSequence(clips as never[], {
      durationS: totalS || 1,
      width: frame.width || 1080,
      height: frame.height || 1920,
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

    // Durable backup of the B-roll library (fire-and-forget): the plan reads
    // these clips, so a reopened project needs them on any device.
    const library = brollRef.current;
    if (library.length) {
      library.forEach((it, i) => backupBrollToCloud(projectId, i, it.blob, { filename: it.name }));
      void trimCloudBroll(projectId, library.length);
    }

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
    setResultView(withRef ? 'compare' : 'iterate');

    const tick = async (id: StageId, work: () => Promise<void> | void) => {
      if (cancelRef.current) return;
      setStage(id, 'active');
      await Promise.race([
        Promise.resolve(work()),
        new Promise(r => setTimeout(r, 4500)), // 4.5s stage safety guard
      ]).catch(() => {});
      setStage(id, 'done');
    };

    try {
      let profile: StyleProfile | null = null as StyleProfile | null;

      // 1 — understand the source footage (audio / energy)
      let env: Awaited<ReturnType<typeof analyseAudio>> = null as Awaited<ReturnType<typeof analyseAudio>>;
      await tick('understand-source', async () => {
        env = await analyseAudio(blob).catch(() => null);
      });

      const durationS = footage.durationS || entry?.durationS || 60;

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
          const res = await analyseReference(
            refFile,
            { name: refFile.name, durationS: fullDur },
            () => {},
            win && win.endS > win.startS + 0.5 ? win : undefined,
            blob,
            durationS,
          ).catch(() => null);
          profile = res?.profile ?? null;
        });
      }

      const interest = interestCurve(env, durationS);
      const defaultRefGrade = withRef
        ? { brightness: 0.08, contrast: 0.38, saturation: 0.45, warmth: 0.24 }
        : { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
      let baseProfile: StyleProfile = profile ?? {
        ...defaultPunchyProfile(durationS),
        grade: defaultRefGrade,
      };
      /* The instruction typed on the drop screen is a real editing brief.
         The ONE AI interprets it (generate mode) — Version 1 is made by the
         same brain as every chat refinement. */
      const brief = initialNoteRef.current.trim();
      if (/caption|subtitle|transcri/i.test(brief)) {
        baseProfile = { ...baseProfile, captions: { ...baseProfile.captions, present: true } };
      }

      // Captions are the real spoken words — transcribe when a speech service
      // is configured (the call is a no-op without a key and captions fall
      // back to highlight cards). Best-effort: a failed transcription never
      // blocks; the plan still shows spread caption cards.
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
        /* Grounding for the Pro AI route. */
        silences: env ? detectSilences(env.rms, env.hopS) : [],
        audio: env ? 'ready' : 'failed',
      };
      profileRef.current = baseProfile;
      seedRef.current = 1;

      // 3 — find the strongest moments (drives which footage the plan keeps)
      await tick('find-moments', () => {});

      // 4 — the AI makes Version 1 (or the deterministic composer when the
      // brief is empty or the AI cannot be reached).
      let built: { plan: StudioPlan; match: number } | null = null as { plan: StudioPlan; match: number } | null;
      let v1FromAi = false;
      let briefAiNote = '';
      const firstCutFromAi = async (profile: StyleProfile, briefText: string): Promise<{
        built: { plan: StudioPlan; match: number }; profile: StyleProfile;
      } | null> => {
        const curMedia = projectId ? getMedia(projectId) : null;
        const ratio: StudioPlan['frame']['ratio'] = curMedia && curMedia.width && curMedia.height
          ? (curMedia.width >= curMedia.height * 1.25 ? '16:9'
            : curMedia.height >= curMedia.width * 1.25 ? '9:16' : '1:1')
          : '16:9';
        const base = uncutStudioPlan(profile, durationS, ratio);
        const baseLayer: StyleLayer = {};
        for (const c of base.clips) {
          if (c.type === 'video') baseLayer[c.id] = { sourceIn: c.sourceIn, transform: c.transform, effects: c.effects };
        }
        try {
          const res = await fetch(`/api/projects/${projectId}/ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'generate',
              message: briefText,
              durationS,
              clips: [{ id: 'src-v', trackId: 'video', label: 'Footage', startS: 0, endS: durationS, type: 'video' }],
              silences: ctxRef.current!.silences,
              energy: interest,
              audio: ctxRef.current!.audio,
              transcript: transcript.length ? transcriptPayload(transcript) : undefined,
              visual: visualRef.current ?? undefined,
              frames: needsVision(briefText)
                ? framesRef.current.slice(0, 6).map(f => f.dataUrl)
                : undefined,
              style: withRef && profile ? styleForAi(profile) : undefined,
            }),
          });
          if (!res.ok) return null;
          const data = await res.json().catch(() => null);
          const edit = data?.edit;
          if (!edit || !Array.isArray(edit.newClips)) return null;
          const out = applyAiResult(base, baseLayer, profile, durationS, edit.newClips as AiClip[]);
          if (!out?.applied) {
            briefAiNote = String(data?.aiMessage?.text ?? '');
            return null;
          }
          const look = applyAiLook(out.styleLayer, profile, edit.applied ?? []);
          const synced = syncProfileAfterAi(look.profile, out.plan);
          profileRef.current = synced;
          setPlan(out.plan);
          setFrame({ width: out.plan.frame.width, height: out.plan.frame.height });
          setClips(out.plan.clips.map(clipToEditor));
          setStyleLayer(look.layer);
          setTotalS(out.plan.durationS);

          const videoShots = out.plan.clips.filter(c => c.type === 'video' && c.trackId === 'video');
          const cutCount = Math.max(1, out.plan.cutCount || videoShots.length);
          const editCpm = (cutCount / Math.max(1, out.plan.durationS)) * 60;
          const m = referenceMatch({
            hasReference: ctxRef.current!.hasRef,
            editCutsPerMin: editCpm,
            refCutsPerMin: profile.cutsPerMin || editCpm,
            beatSnapRate: ctxRef.current!.hasRef ? 0.7 : 0,
            refPunchInRate: profile.punchInRate,
            editPunchInRate: synced.punchInRate,
            captionsWanted: ctxRef.current!.captionsWanted || (synced.captions?.present ?? false),
            captionsPresent: out.plan.captions > 0,
          });
          setMatch(m);
          return { built: { plan: out.plan, match: m }, profile: synced };
        } catch {
          return null;
        }
      };
      await tick('match-pacing', async () => {
        if (brief) {
          const aiCut = await firstCutFromAi(baseProfile, brief);
          if (aiCut) {
            built = aiCut.built;
            baseProfile = aiCut.profile;
            ctxRef.current!.baseProfile = aiCut.profile;
            v1FromAi = true;
            return;
          }
        }
        built = applyPlan(baseProfile, 1);
      });

      // 6 — the edit is already in state (applyPlan); just mark it.
      await tick('build-edit', () => {});

      // 7 — render the first frame; full render happens on export.
      await tick('render', () => {});

      if (cancelRef.current) return;

      // Persist this as Version 1 (or the next version when re-run). AI-made
      // versions carry a timeline snapshot (their edits do not replay through
      // the composer); recipe versions rebuild the identical cut.
      if (built) {
        const { versions: vs } = await addVersion(projectId, {
          profile: baseProfile, seed: 1, hasRef: withRef && !!profile,
          refName: refFile ? `${refFile.name}${rangeLabel}` : null, note: initialNoteRef.current || undefined,
        }, { durationS: built.plan.durationS, cuts: built.plan.cutCount, match: built.match },
          v1FromAi
            ? { clips: built.plan.clips, durationS: built.plan.durationS, frame: built.plan.frame }
            : undefined);
        setVersions(vs);
        initialNoteRef.current = '';
      }

      setHeadline(resultHeadline({
        hasReference: ctxRef.current?.hasRef ?? false,
        match: built?.match ?? 0,
        durationS: built?.plan.durationS ?? durationS,
      }));

      const firstDiffs: { label: string; value: string }[] = [
        { label: 'Cuts', value: baseProfile.uncut ? '0 (Uncut)' : `${built?.plan.cutCount ?? 0} cuts` },
        { label: 'Color Grade', value: withRef ? 'Adaptive Ref' : (baseProfile.grade.saturation > 1.25 ? 'Vibrant' : 'Balanced') },
        { label: 'Pacing', value: baseProfile.pace.toUpperCase() },
        { label: 'Captions', value: baseProfile.captions.present ? 'Enabled' : 'Disabled' },
      ];

      setChats([{
        id: `init-${Date.now()}`,
        role: 'ai',
        text: (withRef
          ? `Your edit is ready! I matched your reference's color grading DNA, pacing cadence, and hook timing on your footage. How would you like to refine it?`
          : `Your edit is ready! I balanced speech audio, set the opening hook, and calibrated timeline pacing. Tell me what to adjust in your own words.`)
          + (briefAiNote ? `\n\nNote: ${briefAiNote}` : ''),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        version: {
          number: 1,
          label: 'Initial Edit',
          stats: { durationS: built?.plan.durationS ?? 0, cuts: built?.plan.cutCount ?? 0, match: built?.match ?? 0 },
        },
        diffs: firstDiffs,
        suggestions: [
          withRef ? 'Color grade like reference' : 'Make it vibrant & bright',
          "Don't cut anything",
          'Add bold captions',
          'Make pacing fast',
        ],
      }]);

      setPhase('result');
      // The real pipeline produced an edit — only now is the project 'ready'.
      void fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready' }),
      }).catch(() => {});
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

  /** Measure the picture once, in the background — shot changes, motion,
   *  brightness + a few frames a vision model can actually look at. Never
   *  blocks anything: without it the AI simply says it has not seen the video.
   *  Waits until footage is actually in the store (first upload or rehydrate),
   *  then scans that project once. */
  const visualScannedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || visualScannedRef.current === projectId) return;
    const stop = new AbortController();
    (async () => {
      const footage = await resolveFootage(projectId, getMedia(projectId)).catch(() => null);
      if (!footage || stop.signal.aborted) return;
      const seen = await scanVideo(footage.blob, { signal: stop.signal }).catch(() => null);
      if (!seen || stop.signal.aborted) return;
      visualScannedRef.current = projectId;
      visualRef.current = compactScan(seen.scan);
      framesRef.current = seen.keyframes;
    })();
    return () => stop.abort();
  }, [projectId, media?.objectUrl, media?.durationS]);

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
        if (!footage) return;
        let env: Awaited<ReturnType<typeof analyseAudio>> = null;
        try { env = await analyseAudio(footage.blob); } catch { /* silent */ }
        const durationS = footage.durationS || media.durationS || 60;
        const interest = interestCurve(env, durationS);
        ctxRef.current = {
          durationS, onsets: env?.onsets ?? [], interest, transcript: [],
          baseProfile: last.recipe.profile, hasRef: last.recipe.hasRef,
          captionsWanted: last.recipe.profile.captions.present,
          sourceName: footage.filename || media.filename,
          silences: env ? detectSilences(env.rms, env.hopS) : [],
          audio: env ? 'ready' : 'failed',
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
        setChats([{
          id: `loaded-${Date.now()}`,
          role: 'ai',
          text: `Welcome back! Your edit is ready on **Version ${last.number}** (${last.label}). Tell me what you'd like to adjust.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          version: {
            number: last.number,
            label: last.label,
            stats: last.stats,
          },
          suggestions: getSmartSuggestions(last.recipe.profile, last.recipe.hasRef),
        }]);
        setPhase('result');
        // Try to surface the stored reference for the reference view.
        try {
          const { getReferenceBlob } = await import('@/lib/mediaCloud');
          const refBlob = await getReferenceBlob(projectId, 0);
          if (refBlob) setRefUrl(URL.createObjectURL(refBlob.blob));
        } catch { /* reference is optional */ }
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
    sessionFootageCache.set(projectId, {
      blob: f,
      filename: f.name,
      durationS: meta?.durationS ?? 0,
      mimeType: f.type || 'video/mp4',
    });
    setMediaEntry(entry);
    await saveMediaFile(projectId, f, {
      mimeType: entry.mimeType, mediaType: entry.mediaType, aspectRatio: entry.aspectRatio,
      width: entry.width, height: entry.height, durationS: entry.durationS, filename: entry.filename,
    }).catch(() => {});
    // Durable server copy (no-op when the host has no durable storage).
    void uploadProjectMedia(projectId, 'main', f, f.name).catch(() => {});
    // Keep the (possibly draft) server record in sync so the project lists its
    // real footage/title on the dashboard. Status is 'processing' now — the real
    // analysis auto-runs on footage load; the pipeline PATCHes 'ready' only once
    // it has actually produced an edit.
    void fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: meta?.filename ?? f.name.replace(/\.[^.]+$/, ''),
        filename: f.name,
        durationS: meta?.durationS ?? 0,
        width: meta?.width ?? 0, height: meta?.height ?? 0,
        aspectRatio: meta?.aspectRatio ?? '16:9',
        status: 'processing',
      }),
    }).catch(() => {});
  }, [projectId, setMediaEntry]);

  const copyMessage = (txt: string, id: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(txt);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const resetChat = () => {
    if (!ctxRef.current) return;
    setChats([{
      id: `init-${Date.now()}`,
      role: 'ai',
      text: 'Chat history cleared. Tell me what changes you would like to make to your video edit.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestions: [
        'Color grade like reference',
        'Find me 3 viral clips',
        'Add bold captions',
        'What is happening in this video?',
      ],
    }]);
  };

  /**
   * "Tell Modaya what to change." All instructions go to the ONE editor AI
   * (/api/projects/[id]/ai) with the Studio's timeline, transcript, silences
   * and energy. There is no local parser pretending to be an AI: the route's
   * LLM understands when a provider is ready, its deterministic engine is the
   * honest fallback, and whatever it did (timeline edits, caption text,
   * placement, grade/punch-in looks) is applied from its answer.
   */
  const sendRefinement = async (customText?: string) => {
    const text = (customText ?? input).trim();
    if (!text || chatBusy) return;
    /* Sending always returns your view to the newest message. */
    chatStickRef.current = true;
    setShowJumpLatest(false);
    const userMsg: StudioChatMsg = {
      id: `usr-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChats(c => [...c, userMsg]);
    if (!customText) setInput('');
    setChatBusy(true);
    try {
      if (!ctxRef.current || !plan || plan.clips.length === 0) {
        setChats(c => [...c, {
          id: `ai-${Date.now()}`,
          role: 'ai',
          text: 'Create an edit first, then tell me what to change.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
        return;
      }
      const current = profileRef.current ?? ctxRef.current.baseProfile;

      /* Words first, when the request needs them: captions, filler removal,
         "what was said" — and clip-hunting that wants meaning (with a model
         configured; without one the measurement engine answers fine on its
         own). Transcription is a plain tool step; the ONE AI writes the words. */
      const needWords = needsTranscript(text) || (wantsClips(text) && aiReadyRef.current !== false);
      if (needWords && !ctxRef.current.transcript.length) {
        const progress: StudioChatMsg = {
          id: `asr-${Date.now()}`,
          role: 'ai',
          text: 'Transcribing your footage so the captions match the words…',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setChats(c => [...c, progress]);
        const footage = await resolveFootage(projectId, getMedia(projectId));
        if (footage) {
          const lines = await transcribeMedia(projectId, footage.blob, ctxRef.current.durationS).catch(() => null);
          if (lines && lines.length) {
            ctxRef.current.transcript = lines;
            ctxRef.current.captionsWanted = true;
          }
        }
        setChats(c => c.filter(m => m.id !== progress.id));
      }

      /* ── The one AI (with the eyes the Pro Editor used to prepare) ── */
      const view = toAiView(plan, styleLayer);
      const res = await fetch(`/api/projects/${projectId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          durationS: ctxRef.current.durationS,
          clips: view.clips,
          silences: ctxRef.current.silences,
          energy: ctxRef.current.interest,
          audio: ctxRef.current.audio,
          transcript: ctxRef.current.transcript.length
            ? transcriptPayload(ctxRef.current.transcript)
            : undefined,
          /* Picture measurements always travel; frames only when the question
             needs eyes (they are heavy). */
          visual: visualRef.current ?? undefined,
          frames: needsVision(text)
            ? framesRef.current.slice(0, 6).map(f => f.dataUrl)
            : undefined,
          style: ctxRef.current.hasRef ? styleForAi(ctxRef.current.baseProfile) : undefined,
          history: chats.slice(-8).map(m => ({ role: m.role, text: m.text })),
        }),
      });
      if (!res.ok) throw new Error(`ai route ${res.status}`);
      const data = await res.json().catch(() => null);
      const edit = data?.edit;
      if (!edit || !Array.isArray(edit.newClips)) throw new Error('bad ai response');

      const proOut = applyAiResult(plan, styleLayer, current, ctxRef.current.durationS, edit.newClips as AiClip[]);
      const aiText = String(data?.aiMessage?.text ?? edit.summary ?? '');
      const captionNote = /caption|subtitle|transcri/i.test(text) && ctxRef.current.transcript.length === 0
        && !/(transcri|speech key|empty caption slots)/i.test(aiText)
        ? " I couldn't transcribe the speech on your footage (no speech key or no intelligible audio), so caption slots were placed instead — add a Groq key in Settings → AI for word-accurate captions."
        : '';
      const look = applyAiLook(proOut?.styleLayer ?? styleLayer, current, edit.applied ?? []);
      const timelineChanged = proOut?.applied ?? false;
      /* Clip-hunting answer: standalone short clips, one tap to cut to. */
      const clipSuggestions: ClipSuggestion[] | undefined =
        Array.isArray(edit.clips) ? (edit.clips as ClipSuggestion[]) : undefined;
      const summary = String(edit.summary ?? '');
      const savedS = Number(edit.savedS ?? 0);

      if (timelineChanged && proOut) {
        /* Reversible: remember this exact state before the edit lands. */
        undoRef.current = [...undoRef.current.slice(-19), {
          plan, styleLayer, profile: current, seed: seedRef.current,
        }];
        setUndoable(true);
        const synced = syncProfileAfterAi(look.profile, proOut.plan);
        profileRef.current = synced;
        setPlan(proOut.plan);
        setFrame({ width: proOut.plan.frame.width, height: proOut.plan.frame.height });
        setClips(proOut.plan.clips.map(clipToEditor));
        setStyleLayer(look.layer);
        setTotalS(proOut.plan.durationS);

        const videoShots = proOut.plan.clips.filter(c => c.type === 'video' && c.trackId === 'video');
        const cutCount = Math.max(1, proOut.plan.cutCount || videoShots.length);
        const editCpm = (cutCount / Math.max(1, proOut.plan.durationS)) * 60;
        const m = referenceMatch({
          hasReference: ctxRef.current.hasRef,
          editCutsPerMin: editCpm,
          refCutsPerMin: ctxRef.current.baseProfile.cutsPerMin || editCpm,
          beatSnapRate: ctxRef.current.hasRef ? 0.7 : 0,
          refPunchInRate: ctxRef.current.baseProfile.punchInRate,
          editPunchInRate: synced.punchInRate,
          captionsWanted: ctxRef.current.captionsWanted || (synced.captions?.present ?? false),
          captionsPresent: proOut.plan.captions > 0,
        });
        setMatch(m);
        setHeadline(resultHeadline({
          hasReference: ctxRef.current.hasRef, match: m, durationS: proOut.plan.durationS,
        }));

        const diffBadges = getDiffBadges(current, synced);
        const nextVerNum = (versions[versions.length - 1]?.number ?? 1) + 1;
        void saveVersion(
          synced, ++seedRef.current, text,
          { plan: proOut.plan, match: m },
          { clips: proOut.plan.clips, durationS: proOut.plan.durationS, frame: proOut.plan.frame },
        );
        setChats(c => [...c, {
          id: `ai-${Date.now()}`,
          role: 'ai',
          text: aiText + captionNote,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          version: {
            number: nextVerNum,
            label: text,
            stats: { durationS: proOut.plan.durationS, cuts: proOut.plan.cutCount, match: m },
          },
          diffs: diffBadges,
          summary: summary !== 'No change' ? summary : undefined,
          savedS: savedS || undefined,
          suggestions: getSmartSuggestions(synced, ctxRef.current!.hasRef),
        }]);
        return;
      }

      if (look.changed) {
        /* The AI applied a look without touching the clip list (grade /
           punch-in) — show it immediately and keep it in the version. */
        undoRef.current = [...undoRef.current.slice(-19), {
          plan, styleLayer, profile: current, seed: seedRef.current,
        }];
        setUndoable(true);
        const withEffects: PlannedShot[] = plan.clips.map(c =>
          c.type === 'video' && look.layer[c.id]?.effects
            ? { ...c, effects: { ...DEFAULT_EFFECTS, ...look.layer[c.id]!.effects! } }
            : c);
        const nextPlan: StudioPlan = { ...plan, clips: withEffects };
        const synced = syncProfileAfterAi(look.profile, nextPlan);
        profileRef.current = synced;
        setStyleLayer(look.layer);
        setPlan(nextPlan);
        setClips(nextPlan.clips.map(clipToEditor));
        const diffBadges = getDiffBadges(current, synced);
        const nextVerNum = (versions[versions.length - 1]?.number ?? 1) + 1;
        void saveVersion(synced, ++seedRef.current, text,
          { plan: nextPlan, match },
          { clips: nextPlan.clips, durationS: nextPlan.durationS, frame: nextPlan.frame });
        setChats(c => [...c, {
          id: `ai-${Date.now()}`,
          role: 'ai',
          text: aiText + captionNote,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          version: {
            number: nextVerNum,
            label: text,
            stats: { durationS: nextPlan.durationS, cuts: nextPlan.cutCount, match },
          },
          diffs: diffBadges,
          summary: summary !== 'No change' ? summary : undefined,
          savedS: savedS || undefined,
          suggestions: getSmartSuggestions(synced, ctxRef.current!.hasRef),
        }]);
        return;
      }

      /* The AI answered without changing anything. If it suggested standalone
         clips, show them (one tap cuts to the chosen clip) — otherwise its
         answer stands (questions, explanations, "nothing to change"). */
      setChats(c => [...c, {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: aiText || 'No change needed.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        summary: clipSuggestions?.length ? undefined : (summary !== 'No change' ? summary : undefined),
        savedS: clipSuggestions?.length ? undefined : (savedS || undefined),
        clips: clipSuggestions,
        suggestions: getSmartSuggestions(current, ctxRef.current!.hasRef),
      }]);
    } catch {
      setChats(c => [...c, {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: "I couldn't reach the editor AI — check your connection and try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setChatBusy(false);
    }
  };

  /** Clipping engine result — keep only the chosen range, as its own short
   *  programme. Mirrors the Pro Editor's one-tap cut: same AI suggested it,
   *  same bridge applies it. */
  const cutToClip = async (clip: ClipSuggestion) => {
    if (!ctxRef.current || !plan || chatBusy) return;
    setChatBusy(true);
    try {
      const current = profileRef.current ?? ctxRef.current.baseProfile;
      const cutClips: AiClip[] = [{
        id: `cut-${Date.now()}`, trackId: 'video', label: clip.title,
        type: 'video', startS: clip.startS, endS: clip.endS,
      }];
      const out = applyAiResult(plan, styleLayer, current, ctxRef.current.durationS, cutClips);
      if (out?.applied) {
        undoRef.current = [...undoRef.current.slice(-19), {
          plan, styleLayer, profile: current, seed: seedRef.current,
        }];
        setUndoable(true);
        const synced = syncProfileAfterAi(current, out.plan);
        profileRef.current = synced;
        setPlan(out.plan);
        setFrame({ width: out.plan.frame.width, height: out.plan.frame.height });
        setClips(out.plan.clips.map(clipToEditor));
        setStyleLayer(out.styleLayer);
        setTotalS(out.plan.durationS);
        const m = referenceMatch({
          hasReference: ctxRef.current.hasRef,
          editCutsPerMin: 0,
          refCutsPerMin: ctxRef.current.baseProfile.cutsPerMin || 0,
          beatSnapRate: 0,
          refPunchInRate: ctxRef.current.baseProfile.punchInRate,
          editPunchInRate: synced.punchInRate,
          captionsWanted: ctxRef.current.captionsWanted,
          captionsPresent: out.plan.captions > 0,
        });
        setMatch(m);
        setHeadline(resultHeadline({
          hasReference: ctxRef.current.hasRef, match: m, durationS: out.plan.durationS,
        }));
        const nextVerNum = (versions[versions.length - 1]?.number ?? 1) + 1;
        void saveVersion(synced, ++seedRef.current, `Clip: ${clip.title}`,
          { plan: out.plan, match: m },
          { clips: out.plan.clips, durationS: out.plan.durationS, frame: out.plan.frame });
        const stat = `Cut to “${clip.title}” (${fmtTime(clip.startS)}–${fmtTime(clip.endS)}) ${
          clip.source === 'ai' ? '— AI pick' : clip.source === 'hybrid' ? '— AI + measured' : '— measured'}.`;
        setChats(c => [...c, {
          id: `ai-${Date.now()}`,
          role: 'ai',
          text: stat,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          version: {
            number: nextVerNum,
            label: `Clip: ${clip.title}`,
            stats: { durationS: out.plan.durationS, cuts: out.plan.cutCount, match: m },
          },
          suggestions: getSmartSuggestions(synced, ctxRef.current!.hasRef),
        }]);
      } else {
        setChats(c => [...c, {
          id: `ai-${Date.now()}`,
          role: 'ai',
          text: "I couldn't cut to that clip — try again.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
      }
    } finally {
      setChatBusy(false);
    }
  };

  /** One step back: the AI edit (or the cut-to-clip) is reversed in place.
   *  Nothing is destroyed — the version list still has every cut. */
  const undoAi = () => {
    const snap = undoRef.current[undoRef.current.length - 1];
    if (!snap) return;
    undoRef.current = undoRef.current.slice(0, -1);
    setUndoable(undoRef.current.length > 0);
    profileRef.current = snap.profile;
    seedRef.current = snap.seed;
    setPlan(snap.plan);
    setFrame({ width: snap.plan.frame.width, height: snap.plan.frame.height });
    setClips(snap.plan.clips.map(clipToEditor));
    setStyleLayer(snap.styleLayer);
    setTotalS(snap.plan.durationS);
    const videoShots = snap.plan.clips.filter(c => c.type === 'video' && c.trackId === 'video');
    const m = referenceMatch({
      hasReference: ctxRef.current?.hasRef ?? false,
      editCutsPerMin: (Math.max(1, snap.plan.cutCount || videoShots.length) / Math.max(1, snap.plan.durationS)) * 60,
      refCutsPerMin: ctxRef.current?.baseProfile.cutsPerMin || 0,
      beatSnapRate: ctxRef.current?.hasRef ? 0.7 : 0,
      refPunchInRate: ctxRef.current?.baseProfile.punchInRate ?? 0,
      editPunchInRate: snap.profile.punchInRate,
      captionsWanted: ctxRef.current?.captionsWanted ?? false,
      captionsPresent: snap.plan.captions > 0,
    });
    setMatch(m);
    setChats(c => [...c, {
      id: `ai-${Date.now()}`,
      role: 'ai',
      text: 'Undone — the timeline is back to how it was before that edit.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestions: getSmartSuggestions(snap.profile, ctxRef.current?.hasRef ?? false),
    }]);
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
        hasReference: ctxRef.current?.hasRef ?? false, match: built.match, durationS: built.plan.durationS,
      }));
      void saveVersion(current, seed, '', built);
      const nextVerNum = (versions[versions.length - 1]?.number ?? 1) + 1;
      setChats(c => [...c, {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: 'Done! I re-cut the footage with fresh timing choices and alternate rhythm.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        version: {
          number: nextVerNum,
          label: 'Regenerated Timing',
          stats: { durationS: built.plan.durationS, cuts: built.plan.cutCount, match: built.match },
        },
        suggestions: getSmartSuggestions(current, ctxRef.current?.hasRef ?? false),
      }]);
    }
    setChatBusy(false);
  };

  /** Synced playback for side-by-side: scrub/play both by progress fraction. */
  const syncProgress = useCallback((frac: number, play: boolean) => {
    const t = Math.max(0, frac) * Math.max(1, totalS);
    setPlayhead(t);
    const ref = refVideoRef.current;
    if (ref && Number.isFinite(ref.duration) && ref.duration > 0) {
      const rt = frac * ref.duration;
      if (Math.abs(ref.currentTime - rt) > 0.25 || !play) {
        try { ref.currentTime = rt; } catch { /* seeking before metadata */ }
      }
      if (play) { void ref.play().catch(() => {}); } else { ref.pause(); }
    }
    setPlaying(play);
  }, [totalS]);

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
        broll={brollItems}
        onBroll={addBrollFiles}
        onRemoveBroll={removeBroll}
        error={error}
      />
    );
  }

  /* ─────────── working phase ─────────── */
  if (phase === 'working') {
    return <WorkingScreen stages={stages} refName={refName} progress={pipelineProgress(stages)} onCancel={() => { cancelRef.current = true; setPhase('drop'); }} />;
  }

  /* ─────────── result phase ─────────── */
  const safeTotal = Number.isFinite(totalS) && totalS > 0 ? totalS : 0;
  const mm = String(Math.floor(safeTotal / 60));
  const ss = String(Math.floor(safeTotal % 60)).padStart(2, '0');
  const currentVersion = versions.length ? versions[versions.length - 1] : null;

  const resultVideo = (
    <div style={{ ...previewBox(plan?.frame.ratio), background: C.media, borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.b3}`, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
      {sequence && sourceUrl ? (
        <PreviewCanvas
          sequence={sequence} sourceUrl={sourceUrl} sourceId={projectId || 'main'} extraSources={brollSources}
          playing={playing} playheadS={playhead}
          onTime={setPlayhead} onPaused={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPlayhead(0); }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>Preparing preview…</div>
      )}
      <button onClick={() => setPlaying(p => !p)} style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', width: 44, height: 44, borderRadius: '50%', background: 'rgba(15,27,51,0.55)', border: `1px solid rgba(255,255,255,0.25)`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
    </div>
  );

  return (
    <div className="studio-result-shell" style={{ height: '100vh', overflow: 'hidden', background: C.bg, color: C.text, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
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
        </div>
      </header>

      {/* Compare ⇄ Iterate toggle (only if reference exists) */}
      {refUrl && (
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
      )}

      {resultView === 'compare' && refUrl ? (
        /* ─────────── comparison screen ─────────── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', gap: 14, overflowY: 'auto' }}>
          <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>{headline}</p>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
            {/* Reference */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <CompareBox title="REFERENCE" ratio={plan?.frame.ratio}>
                <video ref={refVideoRef} src={refUrl} preload="auto" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} muted playsInline />
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

          <button onClick={() => { const frac = playing ? (playhead / Math.max(1, totalS)) : 0; syncProgress(frac, !playing); }}
            style={{ ...primaryBtn, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {playing ? <><Pause size={14} fill="currentColor" /> Pause both</> : <><Play size={14} fill="currentColor" /> Play together (synced)</>}
          </button>

          {plan?.summary && <p style={{ margin: 0, color: C.dim, fontSize: 12, textAlign: 'center', maxWidth: 560 }}>{plan.summary}</p>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => setExpOpen(true)} style={primaryBtn}><Download size={15} /> Export</button>
            <button onClick={() => setResultView('iterate')} style={ghostBtn}><Sparkles size={14} /> Iterate with Modaya</button>
          </div>
        </div>
      ) : (
        /* ─────────── iterate screen: video + chat, edit map below ─────────── */
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 0, minHeight: 0, overflow: 'hidden' }} className="studio-iterate-grid">
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
                  <SideBox highlight={!!refMoment} label="REFERENCE" ratio={plan?.frame.ratio}>
                    <video ref={refVideoRef} src={refUrl} preload="auto" controls playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} muted />
                  </SideBox>
                  <span style={{ fontSize: 11, color: refMoment ? C.accent : C.dim, fontWeight: refMoment ? 700 : 400 }}>
                    {refMoment ? `Reference ${fmtTime(refMoment.t)}` : (refName ?? 'Reference')}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <SideBox highlight={!!selectedMarker} label="YOUR EDIT" ratio={plan?.frame.ratio}>
                    {sequence && sourceUrl ? (
                      <PreviewCanvas
                        sequence={sequence} sourceUrl={sourceUrl} sourceId={projectId || 'main'} extraSources={brollSources}
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
                <div style={{ ...previewBox(plan?.frame.ratio), background: '#000', borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.b3}` }}>
                  <video ref={refVideoRef} src={refUrl} preload="auto" controls playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
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
            </div>
          </div>

          {/* Right: Modern Lovable-style AI Copilot */}
          <div
            className="studio-chat-col"
            style={{
              borderLeft: `1px solid ${C.b}`,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
              background: 'linear-gradient(180deg, #0C0D11 0%, #08080A 100%)',
            }}
          >
            {/* Copilot Header */}
            <div style={{
              padding: '14px 18px',
              borderBottom: `1px solid ${C.b}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.02)',
              backdropFilter: 'blur(8px)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #EC4899 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  boxShadow: '0 2px 12px rgba(139,92,246,0.35)',
                }}>
                  <Sparkles size={16} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: '-0.02em', color: '#FAFAFA' }}>Modaya Copilot</span>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: chatBusy ? 'rgba(168,85,247,0.15)' : 'rgba(52,211,153,0.15)',
                      color: chatBusy ? '#C084FC' : '#34D399',
                      border: `1px solid ${chatBusy ? 'rgba(168,85,247,0.3)' : 'rgba(52,211,153,0.3)'}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                      <span style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: chatBusy ? '#C084FC' : '#34D399',
                        boxShadow: `0 0 6px ${chatBusy ? '#C084FC' : '#34D399'}`,
                        animation: chatBusy ? 'pulseGlow 1.2s infinite' : 'none',
                      }} />
                      {chatBusy ? 'Editing…' : 'Ready'}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: C.dim }}>Interactive AI Video Director</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {undoable && (
                  <button
                    onClick={undoAi}
                    disabled={chatBusy}
                    title="Undo the last AI edit"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${C.b3}`,
                      borderRadius: 8,
                      padding: '4px 8px',
                      color: C.sec,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: chatBusy ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      opacity: chatBusy ? 0.5 : 1,
                    }}
                  >
                    <RotateCcw size={12} color="#FBBF24" /> Undo
                  </button>
                )}
                {currentVersion && (
                  <button
                    onClick={() => setVersionOpen(v => !v)}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${C.b3}`,
                      borderRadius: 8,
                      padding: '4px 8px',
                      color: C.sec,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Layers size={12} color="#A78BFA" /> v{currentVersion.number}
                  </button>
                )}
                <button
                  onClick={resetChat}
                  title="Reset conversation"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: C.dim,
                    cursor: 'pointer',
                    padding: 5,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 120ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.dim; }}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div
              ref={chatScrollRef}
              onScroll={onChatScroll}
              className="custom-scrollbar"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '16px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {chats.map((m) => (
                <div
                  key={m.id}
                  className="chat-msg-anim"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      maxWidth: m.role === 'user' ? '88%' : '98%',
                      alignItems: 'flex-start',
                      flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
                    }}
                  >
                    {/* Avatar */}
                    {m.role === 'user' ? (
                      <div style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #374151, #1F2937)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#E5E7EB',
                        flexShrink: 0,
                        marginTop: 2,
                      }}>
                        <User size={13} />
                      </div>
                    ) : (
                      <div style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        flexShrink: 0,
                        marginTop: 2,
                        boxShadow: '0 2px 8px rgba(139,92,246,0.3)',
                      }}>
                        <Sparkles size={13} />
                      </div>
                    )}

                    {/* Message Bubble Card */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      minWidth: 0,
                    }}>
                      <div style={{
                        padding: m.role === 'user' ? '10px 14px' : '12px 15px',
                        borderRadius: m.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                        background: m.role === 'user'
                          ? 'linear-gradient(135deg, #27272A, #18181B)'
                          : 'rgba(255,255,255,0.035)',
                        border: m.role === 'user'
                          ? '1px solid rgba(255,255,255,0.14)'
                          : '1px solid rgba(255,255,255,0.08)',
                        color: m.role === 'user' ? '#FAFAFA' : '#E4E4E7',
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{formatMessageText(m.text)}</div>

                        {/* Artifact Card: Version Applied */}
                        {m.version && (
                          <div style={{
                            marginTop: 10,
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: 'rgba(99,102,241,0.08)',
                            border: '1px solid rgba(99,102,241,0.22)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#A5B4FC', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <CheckCircle2 size={13} color="#34D399" /> Version {m.version.number} Live
                              </span>
                              {m.version.stats && (
                                <span style={{ fontSize: 11, color: C.dim }}>
                                  {fmtTime(m.version.stats.durationS)} · {m.version.stats.cuts} cuts
                                </span>
                              )}
                            </div>

                            {/* Applied Diffs Chips */}
                            {m.diffs && m.diffs.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
                                {m.diffs.map((d, di) => (
                                  <span
                                    key={di}
                                    style={{
                                      fontSize: 10.5,
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                      background: 'rgba(255,255,255,0.06)',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      color: '#D1D5DB',
                                    }}
                                  >
                                    <span style={{ color: '#9CA3AF' }}>{d.label}:</span> <b>{d.value}</b>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Edit summary chip — what actually happened */}
                        {m.summary && (
                          <div style={{
                            marginTop: 8,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '4px 9px',
                            background: 'rgba(52,211,153,0.08)',
                            border: '1px solid rgba(52,211,153,0.2)',
                            borderRadius: 9999,
                          }}>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#34D399', flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#34D399' }}>
                              {m.summary}{m.savedS ? ` · −${m.savedS}s` : ''}
                            </span>
                          </div>
                        )}

                        {/* Clipping engine results — one tap to isolate a clip */}
                        {m.clips && m.clips.length > 0 && (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                            {m.clips.map((c) => (
                              <div key={c.id} style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 10,
                                padding: '9px 11px',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                                  <span style={{
                                    fontSize: 10.5,
                                    color: '#A5B4FC',
                                    background: 'rgba(99,102,241,0.12)',
                                    border: '1px solid rgba(99,102,241,0.25)',
                                    borderRadius: 5,
                                    padding: '1px 6px',
                                    fontWeight: 700,
                                  }}>
                                    {fmtTime(c.startS)}–{fmtTime(c.endS)}
                                  </span>
                                  <span style={{ flex: 1, fontSize: 10.5, color: C.dim }}>
                                    <span style={{
                                      width: 5, height: 5, borderRadius: '50%',
                                      background: c.score >= 80 ? '#34D399' : c.score >= 55 ? '#FBBF24' : '#737D8D',
                                      display: 'inline-block', marginRight: 4,
                                    }} />
                                    {c.score}
                                  </span>
                                  <span style={{ fontSize: 10, color: c.source === 'measurement' ? C.dim : '#A5B4FC', fontWeight: 600 }}>
                                    {c.source === 'measurement' ? 'measured' : c.source === 'hybrid' ? 'AI + measured' : 'AI pick'}
                                  </span>
                                </div>
                                <p style={{ fontSize: 12.5, color: '#F5F7FA', fontWeight: 600, margin: '0 0 3px', lineHeight: 1.35 }}>
                                  {c.title}
                                </p>
                                {c.reason && (
                                  <p style={{ fontSize: 11.5, color: C.muted, margin: '0 0 8px', lineHeight: 1.4 }}>{c.reason}</p>
                                )}
                                <button
                                  onClick={() => cutToClip(c)}
                                  disabled={chatBusy}
                                  style={{
                                    background: 'rgba(99,102,241,0.12)',
                                    border: '1px solid rgba(99,102,241,0.3)',
                                    borderRadius: 7,
                                    padding: '4px 10px',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: '#C7D2FE',
                                    cursor: chatBusy ? 'default' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                  }}
                                >
                                  <Scissors size={11} /> Cut to this clip
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Follow-up suggestions */}
                        {m.suggestions && m.suggestions.length > 0 && (
                          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {m.suggestions.map((s, si) => {
                              const SugIcon = getSuggestionIcon(s);
                              return (
                                <button
                                  key={si}
                                  onClick={() => sendRefinement(s)}
                                  disabled={chatBusy}
                                  style={{
                                    background: 'rgba(99,102,241,0.08)',
                                    border: '1px solid rgba(99,102,241,0.25)',
                                    borderRadius: 8,
                                    padding: '4px 9px',
                                    fontSize: 11.5,
                                    fontWeight: 500,
                                    color: '#C7D2FE',
                                    cursor: chatBusy ? 'default' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    transition: 'all 120ms',
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background = 'rgba(99,102,241,0.18)';
                                    e.currentTarget.style.borderColor = '#818CF8';
                                    e.currentTarget.style.color = '#fff';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
                                    e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)';
                                    e.currentTarget.style.color = '#C7D2FE';
                                  }}
                                >
                                  <SugIcon size={12} color="#A78BFA" />
                                  <span>{s}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Footer: timestamp + copy */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                        gap: 8,
                        padding: '0 4px',
                      }}>
                        <span style={{ fontSize: 10.5, color: C.dim }}>{m.timestamp}</span>
                        {m.role === 'ai' && (
                          <button
                            onClick={() => copyMessage(m.text, m.id)}
                            title="Copy text"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: C.dim,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                              fontSize: 10.5,
                              padding: 2,
                              transition: 'color 120ms',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
                            onMouseLeave={e => { e.currentTarget.style.color = C.dim; }}
                          >
                            {copiedId === m.id ? <Check size={11} color="#34D399" /> : <Copy size={11} />}
                            <span>{copiedId === m.id ? 'Copied' : 'Copy'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Lovable Thinking / Generating State */}
              {chatBusy && (
                <div
                  className="chat-msg-anim"
                  style={{
                    display: 'flex',
                    gap: 8,
                    maxWidth: '98%',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    flexShrink: 0,
                    marginTop: 2,
                  }}>
                    <Loader2 size={13} className="spin" />
                  </div>
                  <div style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: '4px 16px 16px 16px',
                    background: 'rgba(255,255,255,0.035)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#A5B4FC', fontSize: 13, fontWeight: 600 }}>
                      <Sparkles size={14} className="spin" />
                      <span>Modaya AI is refining your video…</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ fontSize: 11.5, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6366F1' }} />
                        Analyzing instructions & style parameters
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8B5CF6' }} />
                        Synthesizing timeline cuts & GPU color grading
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34D399' }} />
                        Rendering real-time 60 FPS preview
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Jump to latest — appears only after scrolling back up */}
              {showJumpLatest && chats.length > 0 && (
                <button
                  onClick={() => { chatStickRef.current = true; setShowJumpLatest(false); scrollChatToBottom(true); }}
                  style={{
                    position: 'sticky', bottom: 8, alignSelf: 'flex-end', zIndex: 5,
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 11px', borderRadius: 999,
                    background: 'rgba(99,102,241,0.16)', border: '1px solid rgba(99,102,241,0.4)',
                    color: '#C7D2FE', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    fontFamily: F, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(8px)', transition: 'background 120ms, border-color 120ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.28)'; e.currentTarget.style.borderColor = '#818CF8'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.16)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)'; }}
                >
                  <ChevronDown size={12} /> Latest
                </button>
              )}
            </div>

            {/* Lovable-Style Floating Input Bar */}
            <div style={{
              padding: '12px 14px',
              borderTop: `1px solid ${C.b}`,
              background: 'rgba(10,10,11,0.92)',
              backdropFilter: 'blur(12px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              {/* Quick Suggestion Chips */}
              <div style={{
                display: 'flex',
                gap: 6,
                overflowX: 'auto',
                paddingBottom: 2,
                scrollbarWidth: 'none',
              }}>
                {[
                  { icon: Palette, label: 'Match Ref Color', prompt: 'Color grade like reference' },
                  { icon: SunMedium, label: 'Vibrant & Bright', prompt: 'Make it vibrant and bright' },
                  { icon: Scissors, label: "Don't Cut Anything", prompt: "Don't cut anything" },
                  { icon: Type, label: 'Bold Captions', prompt: 'Add bold captions' },
                  { icon: Zap, label: 'Fast Pacing', prompt: 'Make pacing fast' },
                ].map(chip => {
                  const ChipIcon = chip.icon;
                  return (
                    <button
                      key={chip.label}
                      onClick={() => sendRefinement(chip.prompt)}
                      disabled={chatBusy}
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.09)',
                        borderRadius: 999,
                        padding: '4px 10px',
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: C.sec,
                        cursor: chatBusy ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        transition: 'all 120ms',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                        e.currentTarget.style.color = '#fff';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                        e.currentTarget.style.color = C.sec;
                      }}
                    >
                      <ChipIcon size={12} color="#A78BFA" />
                      <span>{chip.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Floating Input Box */}
              <div style={{
                background: 'rgba(255,255,255,0.035)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 14,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                transition: 'all 150ms ease',
              }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendRefinement();
                    }
                  }}
                  rows={2}
                  placeholder={`Ask Modaya… e.g. "Color grade like reference", "Don't cut anything", "Make it vibrant"`}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    color: '#FAFAFA',
                    fontFamily: F,
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    maxHeight: 120,
                  }}
                />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: C.dim, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>↵ Send</span>
                    <span>·</span>
                    <span>Shift+↵ Newline</span>
                  </span>

                  <button
                    onClick={() => sendRefinement()}
                    disabled={!input.trim() || chatBusy}
                    style={{
                      height: 32,
                      padding: '0 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: input.trim() && !chatBusy ? 'linear-gradient(135deg, #6366F1, #8B5CF6)' : 'rgba(255,255,255,0.08)',
                      color: input.trim() && !chatBusy ? '#fff' : C.dim,
                      fontSize: 12.5,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: input.trim() && !chatBusy ? 'pointer' : 'default',
                      boxShadow: input.trim() && !chatBusy ? '0 2px 10px rgba(139,92,246,0.35)' : 'none',
                      transition: 'all 150ms ease',
                    }}
                  >
                    {chatBusy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                    <span>{chatBusy ? 'Editing…' : 'Apply'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Versions popover */}
      {versionOpen && (
        <div style={{ position: 'fixed', top: 58, right: 130, zIndex: 9500, width: 300, background: C.surface, border: `1px solid ${C.b3}`, borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.5)', padding: 8, maxHeight: '60vh', overflowY: 'auto' }}>
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
          sequence={sequence} sourceUrl={sourceUrl} sourceId={projectId || 'main'} extraSources={brollSources}
          projectName={projectName}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulseGlow { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.55; transform: scale(0.95); } }
        @keyframes slideUpFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .spin { animation: spin 0.8s linear infinite; }
        .pulse-glow { animation: pulseGlow 2s infinite ease-in-out; }
        .chat-msg-anim { animation: slideUpFade 0.22s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 999px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        @media (max-width: 860px) {
          /* Stacked mobile layout: let the page scroll so the copilot is
             reachable below the video, but keep the message list scrollable
             inside a bounded panel so the input bar stays pinned to it. */
          .studio-result-shell { height: auto !important; min-height: 100vh !important; overflow: visible !important; }
          .studio-iterate-grid { grid-template-columns: 1fr !important; grid-template-rows: auto auto !important; }
          .studio-chat-col { height: min(76vh, 760px) !important; }
        }
      `}</style>
    </div>
  );
}

/* ─────────── comparison box ─────────── */
function CompareBox({ title, ratio, children }: { title: string; ratio?: string; children: React.ReactNode }) {
  const isWide = ratio === '16:9';
  const isSquare = ratio === '1:1';
  return (
    <div style={{
      width: isWide ? 'min(46vw, 360px)' : isSquare ? 'min(40vw, 260px)' : 'min(38vw, 220px)',
      aspectRatio: isWide ? '16 / 9' : isSquare ? '1 / 1' : '9 / 16',
      background: '#000', borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.b3}`, boxShadow: '0 18px 50px rgba(0,0,0,0.45)'
    }}>
      <span style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#fff', background: 'rgba(15,27,51,0.65)', padding: '3px 8px', borderRadius: 6, backdropFilter: 'blur(4px)' }}>{title}</span>
      {children}
    </div>
  );
}

/* ─────────── side-by-side box (iterate view) ─────────── */
function SideBox({ label, highlight, ratio, children }: { label: string; highlight: boolean; ratio?: string; children: React.ReactNode }) {
  const isWide = ratio === '16:9';
  const isSquare = ratio === '1:1';
  return (
    <div style={{
      width: isWide ? 'min(46vw, 360px)' : isSquare ? 'min(40vw, 260px)' : 'min(38vw, 210px)',
      aspectRatio: isWide ? '16 / 9' : isSquare ? '1 / 1' : '9 / 16',
      background: '#000', borderRadius: 12, overflow: 'hidden',
      position: 'relative', border: `2px solid ${highlight ? C.accent : C.b3}`,
      boxShadow: highlight ? `0 0 0 3px ${C.accent}33` : 'none', transition: 'border 160ms'
    }}>
      <span style={{ position: 'absolute', top: 7, left: 7, zIndex: 3, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
        color: '#fff', background: 'rgba(15,27,51,0.65)', padding: '3px 7px', borderRadius: 6, backdropFilter: 'blur(4px)' }}>{label}</span>
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
    hook: '#FFFFFF', cut: '#E4E4E7', zoom: '#A1A1AA', caption: '#D4D4D8', broll: '#71717A',
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
                fontWeight: 800, color: '#000000',
                background: color, boxShadow: active ? `0 0 0 3px ${color}44` : 'none', border: active ? '2px solid #FFFFFF' : 'none', lineHeight: 1 }}>
                {renderMarkerIcon(m.type)}
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

function DropScreen({ projectId, projectName, mode, onModeChange, hasFootage, onFootage, onReference, onStart, refInputRef, broll, onBroll, onRemoveBroll, error }: {
  projectId: string; projectName: string; mode: 'edit' | 'reference'; onModeChange: (m: 'edit' | 'reference') => void;
  hasFootage: boolean;
  onFootage: (f: File) => void;
  onReference: (ref: File | null, range: { startS: number; endS: number } | null, note: string) => void;
  onStart: (note: string) => void;
  refInputRef: React.RefObject<HTMLInputElement | null>;
  broll: BrollItem[];
  onBroll: (files: File[]) => void;
  onRemoveBroll: (index: number) => void;
  error: string | null;
}) {
  const footageRef = useRef<HTMLInputElement>(null);
  const brollInputRef = useRef<HTMLInputElement>(null);
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
  const [localError, setLocalError] = useState<string | null>(null);
  const ready = !!hasFootage || !!footName;
  const refReady = ref.kind !== 'none';

  const useLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setLinkBusy(true); setLinkError(null); setLocalError(null);
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
    if (linkBusy) return;
    if (!ready) {
      setLocalError('Please select or drop your video footage first.');
      footageRef.current?.click();
      return;
    }
    if (!rangeValid) {
      setLocalError('Please enter a valid time range format (e.g. 00:10 – 01:00).');
      return;
    }
    setLocalError(null);
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
            sub={hasFootage || footName ? 'Ready · tap or drop another video to replace' : 'Upload or drop the video you want edited'}
            icon={<Film size={22} />}
            onClick={() => footageRef.current?.click()}
            filled={!!(hasFootage || footName)}
            onFileDrop={f => {
              setFootName(f.name);
              setLocalError(null);
              void onFootage(f);
            }}
          />
          <input ref={footageRef} type="file" accept="video/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { setFootName(f.name); setLocalError(null); void onFootage(f); } e.target.value = ''; }} />

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

          {/* B-roll library — optional extra clips used only as silent
              cutaways. Without a library, Modaya cuts cutaways from unused
              parts of the main footage; with one, it prefers these. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 8px' }}>
            <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              B-roll library · optional
            </p>
            {broll.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: C.muted, background: C.s3, borderRadius: 999, padding: '2px 8px' }}>
                {broll.length} clip{broll.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files ?? []); if (fs.length) onBroll(fs); }}
            style={{ background: broll.length ? C.s2 : 'transparent', border: broll.length ? `1.5px solid ${C.b3}` : 'none',
              borderRadius: 14, padding: broll.length ? 14 : 0 }}>
            <input ref={brollInputRef} type="file" accept="video/*" multiple style={{ display: 'none' }}
              onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) onBroll(fs); e.target.value = ''; }} />
            {broll.length ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {broll.map((it, i) => (
                    <div key={`${it.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      background: C.s3, borderRadius: 9 }}>
                      <span style={{ width: 30, height: 30, borderRadius: 7, background: C.s2, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', color: C.broll, flexShrink: 0 }}><Film size={14} /></span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</span>
                        <span style={{ display: 'block', fontSize: 10.5, color: C.dim, marginTop: 1 }}>
                          {it.durationS ? `${fmtTime(it.durationS)} · cutaway clip` : 'cutaway clip'}
                        </span>
                      </span>
                      <button onClick={() => onRemoveBroll(i)} title="Remove"
                        style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 4 }}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => brollInputRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 2px 0', background: 'none', border: 'none',
                    color: C.muted, cursor: 'pointer', fontSize: 12, fontFamily: F, padding: 0 }}>
                  <Plus size={13} /> Add more clips
                </button>
              </>
            ) : (
              <button onClick={() => brollInputRef.current?.click()}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                  padding: '14px 18px', borderRadius: 14, cursor: 'pointer',
                  background: C.s2, border: `1.5px dashed ${C.b3}`, color: C.text, fontFamily: F }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: C.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, flexShrink: 0 }}><Film size={16} /></span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>Add B-roll for cutaways</span>
                  <span style={{ display: 'block', color: C.dim, fontSize: 12, marginTop: 1 }}>Extra clips Modaya can cut to while you keep talking — drop them here or browse</span>
                </span>
                <Plus size={16} color={C.muted} />
              </button>
            )}
          </div>

          <p style={{ color: C.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '20px 0 8px' }}>Instructions · optional</p>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            rows={2} placeholder={'e.g. "Create a 60-second cinematic edit. Keep the reference\'s pacing and transitions."'}
            style={{ width: '100%', boxSizing: 'border-box', background: C.s2, border: `1.5px solid ${C.b3}`, borderRadius: 12, color: C.text,
              fontFamily: F, fontSize: 14, lineHeight: 1.5, padding: '12px 14px', resize: 'vertical', outline: 'none' }}
          />

          {(localError || error) && (
            <p style={{
              color: C.danger,
              fontSize: 13,
              margin: '16px 0 0',
              background: 'rgba(239, 68, 68, 0.1)',
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid rgba(239, 68, 68, 0.3)',
              lineHeight: 1.4,
            }}>
              {localError || error}
            </p>
          )}

          <div style={{ marginTop: 26 }}>
            <GlowButton size="lg" fullWidth onClick={create} disabled={linkBusy}
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
            color: '#09090B', background: C.gold ?? '#F4F4F5', borderRadius: 999, padding: '2px 6px' }}>Hero</span>}
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

function DropZone({
  label,
  sub,
  icon,
  onClick,
  filled,
  onFileDrop,
}: {
  label: string;
  sub: string;
  icon: React.ReactNode;
  onClick: () => void;
  filled: boolean;
  onFileDrop?: (file: File) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onClick={onClick}
      onDragOver={e => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={e => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={e => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && (f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(f.name))) {
          onFileDrop?.(f);
        }
      }}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
        padding: '22px 18px', borderRadius: 14, cursor: 'pointer',
        background: isDragOver ? `${C.accent}22` : filled ? `${C.accent}0e` : C.s2,
        border: `1.5px dashed ${isDragOver ? C.accent : filled ? C.accent + '66' : C.b3}`,
        color: C.text, transition: 'all 140ms'
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent + '88'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = isDragOver ? C.accent : filled ? C.accent + '66' : C.b3; }}>
      <span style={{ width: 44, height: 44, borderRadius: 11, background: filled ? `${C.accent}1c` : C.s3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: filled ? C.accent : C.muted, flexShrink: 0 }}>{icon}</span>
      <span>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>{label}</span>
        <span style={{ display: 'block', color: C.muted, fontSize: 12.5, marginTop: 2 }}>{sub}</span>
      </span>
    </div>
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

/* A default profile used when no reference is given: keeps footage intact with original
   framing so the AI only applies what the user explicitly asks for. */
function defaultPunchyProfile(durationS: number): StyleProfile {
  return {
    sourceName: 'modaya-default', durationS,
    cuts: [], cutsPerMin: 0, shotMeanS: durationS, shotMedianS: durationS, shotVariance: 0,
    pace: 'relaxed',
    grade: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
    punchInRate: 0, punchInMax: 1,
    captions: { present: false, position: 'lower', emphasis: 0.5 },
    beatSynced: false, bpm: null, energy: 0.2,
    uncut: true,
    targetRatio: 'original',
  };
}

const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderRadius: 12,
  background: 'linear-gradient(180deg,#FFFFFF,#E4E4E7)', color: '#09090B', border: '1px solid rgba(255,255,255,0.12)', fontFamily: F, fontSize: 14, fontWeight: 600,
  cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.45)',
  transition: 'all 150ms ease',
};
const ghostBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 10,
  background: C.s3, color: C.sec, border: `1px solid ${C.b3}`, fontFamily: F, fontSize: 13, fontWeight: 500,
  cursor: 'pointer', textDecoration: 'none',
};
