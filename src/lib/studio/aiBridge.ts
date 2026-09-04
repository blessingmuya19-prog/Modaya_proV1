/**
 * Bridge between the Studio timeline and the shared editor AI
 * (`/api/projects/[id]/ai`) — the one AI that understands every instruction
 * in Modaya, from the drop-screen brief to chat refinements.
 *
 * The AI reasons about a timeline whose clip positions are BOTH source and
 * programme time (its clips are written in source order, gaps = removed
 * sections). The Studio's plans are the opposite: a condensed programme where
 * `startS` is the output position and `sourceIn` points back into the source
 * file.
 *
 * This module converts between the two timebases. All functions are pure and
 * unit-tested.
 */
import type { StudioPlan, PlannedShot, TranscriptLine } from './editPlan';
import {
  DEFAULT_TRANSFORM, DEFAULT_EFFECTS,
  type StyleLayer, type Transform, type Effects,
} from '../render/sequence';
import type { StyleProfile } from '../ai/styleProfile';

/** The clip shape the editor AI route accepts. */
export interface AiClip {
  id: string;
  trackId: string;
  label: string;
  startS: number;
  endS: number;
  type: 'video' | 'audio' | 'text' | 'subtitle';
  textPosition?: 'top' | 'centre' | 'lower';
  textAlign?: 'left' | 'centre' | 'right';
  textStyle?: unknown;
}

/** One Studio shot in both timebases. */
export interface ShotMap {
  id: string;
  /** Source range this shot reads. */
  srcS: number;
  srcE: number;
  /** Output range where it sits. */
  tlS: number;
  tlE: number;
}

/** Timeline the AI sees when it edits a Studio plan. */
export interface AiView {
  clips: AiClip[];
  shots: ShotMap[];
}

/** Source time → programme time, using the shot mapping. Null = inside a gap. */
export function sourceToTimeline(shots: ShotMap[], t: number): number | null {
  for (const s of shots) {
    if (t >= s.srcS && t < s.srcE) {
      return s.tlS + (t - s.srcS);
    }
  }
  return null;
}

/** Programme time → source time. Null = not inside any shot. */
export function timelineToSource(shots: ShotMap[], t: number): number | null {
  for (const s of shots) {
    if (t >= s.tlS && t < s.tlE) {
      return s.srcS + (t - s.tlS);
    }
  }
  return null;
}

/** Effects derived from a profile grade — mirrors composeStudioPlan's math. */
export function effectsForProfile(profile: StyleProfile): Effects {
  const grade = profile.grade ?? { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
  const effBrightness = grade.brightness >= 0.7
    ? Number(grade.brightness.toFixed(3))
    : Number((1 + (grade.brightness || 0) * 0.4).toFixed(3));
  const effContrast = grade.contrast >= 0.7
    ? Number(grade.contrast.toFixed(3))
    : Number((1 + (grade.contrast || 0) * 0.8).toFixed(3));
  const effSaturation = grade.saturation >= 0.7
    ? Number(grade.saturation.toFixed(3))
    : Number((1 + (grade.saturation || 0) * 0.85).toFixed(3));
  return {
    ...DEFAULT_EFFECTS,
    brightness: effBrightness,
    contrast: effContrast,
    saturation: effSaturation,
    colorGrade: {
      temperature: Math.round((grade.warmth || 0) * 80),
      tint: 0,
      vibrance: Math.round((effSaturation - 1) * 70),
      exposure: effBrightness - 1,
      contrast: effContrast,
      highlights: 0,
      shadows: 0,
      intensity: 100,
    },
  };
}

/** Build the source-aligned view the AI edits. Text/caption clips are
 *  translated into source time (the AI's coordinate system); overlays are
 *  dropped — the AI reasons about the programme, not cutaway artwork. */
export function toAiView(plan: StudioPlan | null, styleLayer: StyleLayer): AiView {
  const shots: ShotMap[] = [];
  if (plan) {
    for (const c of plan.clips) {
      if (c.type !== 'video' || c.trackId !== 'video') continue;
      const len = c.endS - c.startS;
      if (len <= 0) continue;
      shots.push({ id: c.id, srcS: c.sourceIn, srcE: c.sourceIn + len, tlS: c.startS, tlE: c.endS });
    }
  }
  shots.sort((a, b) => a.tlS - b.tlS);

  const clips: AiClip[] = shots.map(s => ({
    id: s.id, trackId: 'video', label: 'Shot', type: 'video',
    startS: Number(s.srcS.toFixed(3)), endS: Number(s.srcE.toFixed(3)),
  }));

  if (plan) {
    for (const c of plan.clips) {
      if (c.type !== 'text') continue;
      const host = shots.find(s => c.startS >= s.tlS && c.startS < s.tlE);
      if (!host) continue;
      const span = Math.min(c.endS - c.startS, host.tlE - c.startS);
      if (span <= 0) continue;
      /* Exact round trip: source span = host source start + programme offset. */
      clips.push({
        id: c.id, trackId: c.trackId, label: c.label, type: 'subtitle',
        startS: Number((host.srcS + (c.startS - host.tlS)).toFixed(3)),
        endS:   Number((host.srcS + (c.startS - host.tlS) + span).toFixed(3)),
        textPosition: c.textPosition, textAlign: c.textAlign, textStyle: c.textStyle,
      });
    }
  }
  return { clips, shots };
}

export interface AiApplyResult {
  plan: StudioPlan;
  styleLayer: StyleLayer;
  /** True when the programme actually changed (captions added/moved, cuts…). */
  applied: boolean;
}

/**
 * Turn the AI's source-aligned answer back into a Studio plan.
 *
 * - Video clips: if the AI changed nothing about the footage, the existing
 *   Studio shots are kept exactly (including b-roll and styling). If it cut
 *   or kept ranges, the surviving source windows are condensed into a fresh
 *   programme and caption times are re-mapped through it.
 * - Text clips: translated source → programme time, clamped into the shot
 *   that hosts them.
 */
export function applyAiResult(
  plan: StudioPlan | null,
  styleLayer: StyleLayer,
  profile: StyleProfile,
  sourceDurationS: number,
  newClips: AiClip[],
): AiApplyResult | null {
  const videos = (newClips ?? []).filter(c => c.type === 'video' && c.trackId === 'video')
    .sort((a, b) => a.startS - b.startS);
  const texts = (newClips ?? []).filter(c => c.type === 'text' || c.type === 'subtitle');

  const oldShots: ShotMap[] = [];
  if (plan) {
    for (const c of plan.clips) {
      if (c.type !== 'video' || c.trackId !== 'video') continue;
      const len = c.endS - c.startS;
      if (len <= 0) continue;
      oldShots.push({ id: c.id, srcS: c.sourceIn, srcE: c.sourceIn + len, tlS: c.startS, tlE: c.endS });
    }
  }

  const videosChanged = videos.length !== oldShots.length ||
    videos.some((v, i) => !oldShots[i] ||
      Math.abs(v.startS - oldShots[i].srcS) > 0.08 ||
      Math.abs(v.endS - oldShots[i].srcE) > 0.08);

  const effects = effectsForProfile(profile);
  const useCover = plan?.frame.ratio === '9:16';

  let videoOut: PlannedShot[];
  let layerOut: StyleLayer = {};
  let brollOut: PlannedShot[] = [];
  let durationS = plan?.durationS ?? sourceDurationS;

  if (!videosChanged) {
    // Footage untouched — keep the Studio plan's shots and artwork as-is.
    videoOut = plan ? plan.clips.filter(c => c.type === 'video' && c.trackId === 'video') : [];
    brollOut = plan ? plan.clips.filter(c => c.type === 'video' && c.trackId !== 'video') : [];
    layerOut = { ...styleLayer };
  } else {
    // Condense the surviving source windows into a continuous programme.
    let cursor = 0;
    videoOut = videos.map((v, i) => {
      const len = v.endS - v.startS;
      const out: PlannedShot = {
        id: v.id || `shot-${i}`,
        trackId: 'video',
        label: `Shot ${i + 1}`,
        startS: Number(cursor.toFixed(3)),
        endS: Number((cursor + len).toFixed(3)),
        type: 'video',
        sourceIn: Number(v.startS.toFixed(3)),
        transform: { ...DEFAULT_TRANSFORM, fit: useCover ? 'cover' : 'contain', scale: 1 },
        effects,
      };
      layerOut[out.id] = { sourceIn: out.sourceIn, transform: out.transform, effects };
      cursor += len;
      return out;
    });
    durationS = Number(cursor.toFixed(3));
    brollOut = [];   // cutaway artwork is dropped on a structural re-cut
  }

  const shots: ShotMap[] = videoOut.map(v => ({
    id: v.id,
    srcS: v.sourceIn,
    srcE: v.sourceIn + (v.endS - v.startS),
    tlS: v.startS,
    tlE: v.endS,
  }));

  /* Translate caption/text answers back into the programme, clamped to the
     shot that hosts each span. */
  const textOut: PlannedShot[] = [];
  let n = 0;
  for (const t of texts) {
    const srcS = Math.max(0, t.startS);
    const srcE = Math.max(srcS + 0.01, t.endS);
    const host = shots.find(s => srcS < s.srcE && srcE > s.srcS);
    if (!host) continue;
    const startTl = host.tlS + Math.max(0, srcS - host.srcS);
    const endTl = host.tlS + Math.min(host.srcE - host.srcS, srcE - host.srcS);
    if (endTl - startTl < 0.12) continue;
    textOut.push({
      id: t.id?.startsWith('cap-') ? t.id : `cap-${n}`,
      trackId: t.trackId === 'text' ? 'text' : 'subs',
      label: t.label || 'Caption',
      startS: Number(startTl.toFixed(3)),
      endS: Number(endTl.toFixed(3)),
      type: 'text',
      sourceIn: 0,
      textPosition: t.textPosition ?? 'lower',
      textAlign: t.textAlign ?? 'centre',
      textStyle: (t.textStyle as PlannedShot['textStyle']) ?? {
        font: 'sans', bold: true, size: t.textPosition === 'centre' ? 'large' : 'medium',
        colour: '#FFFFFF', background: 'box', uppercase: false,
      },
      transform: { ...DEFAULT_TRANSFORM },
      effects: { ...DEFAULT_EFFECTS },
    });
    n++;
  }

  const clips = [...videoOut, ...brollOut, ...textOut].sort((a, b) => a.startS - b.startS);
  const durationFallback = durationS > 0 ? durationS : sourceDurationS;
  const removedS = Math.max(0, Number((sourceDurationS - durationFallback).toFixed(2)));

  /* "Applied" means the timeline really changed — a reply that merely echoes
     the existing caption list must not mint a duplicate version. */
  const oldTexts = (plan?.clips ?? []).filter(c => c.type === 'text');
  const textChanged = textOut.length !== oldTexts.length ||
    textOut.some((t, i) => {
      const o = oldTexts[i];
      return !o || t.id !== o.id ||
        Math.abs(t.startS - o.startS) > 0.08 || Math.abs(t.endS - o.endS) > 0.08 ||
        t.label !== o.label || (t.textPosition ?? 'lower') !== (o.textPosition ?? 'lower');
    });

  return {
    applied: videosChanged || textChanged,
    plan: {
      ...(plan ?? {
        clips: [], durationS: durationFallback, removedS,
        cutCount: 0, summary: '', profileName: profile.sourceName,
        frame: { width: 1080, height: 1920, ratio: '9:16' as const },
        captions: 0, broll: 0, brollFromLibrary: false, hookFirst: false,
      }),
      clips,
      durationS: durationFallback,
      removedS,
      cutCount: videoOut.length,
      summary: (plan?.summary ?? '')
        .split(' · ')
        .filter(s => !/captions|moments|shots/i.test(s))
        .join(' · ') || 'AI edit',
      captions: textOut.length,
      broll: brollOut.length,
      hookFirst: plan?.hookFirst ?? false,
    },
    styleLayer: layerOut,
  };
}

/** An uncut source-only plan — the empty canvas the AI's first pass edits. */
export function uncutStudioPlan(
  profile: StyleProfile,
  sourceDurationS: number,
  ratio: StudioPlan['frame']['ratio'],
): StudioPlan {
  const frame = ratio === '9:16' ? { width: 1080, height: 1920, ratio }
    : ratio === '1:1' ? { width: 1080, height: 1080, ratio }
    : { width: 1920, height: 1080, ratio };
  const dur = Math.max(0.1, sourceDurationS);
  const effects = effectsForProfile(profile);
  return {
    clips: [{
      id: 'shot-1', trackId: 'video', label: 'Shot 1',
      startS: 0, endS: dur, type: 'video', sourceIn: 0,
      transform: { ...DEFAULT_TRANSFORM, fit: ratio === '9:16' ? 'cover' : 'contain', scale: 1 },
      effects,
    }],
    durationS: dur,
    removedS: 0,
    cutCount: 1,
    summary: '',
    profileName: profile.sourceName,
    frame,
    captions: 0,
    broll: 0,
    brollFromLibrary: false,
    hookFirst: false,
  };
}

/** After an AI edit, mirror what happened back into the Studio profile so the
 *  next regenerate and the suggestion chips stay truthful. */
export function syncProfileAfterAi(profile: StyleProfile, plan: StudioPlan | null): StyleProfile {
  if (!plan) return profile;
  const caps = plan.clips.filter(c => c.type === 'text');
  const positions = caps.map(c => c.textPosition).filter(Boolean) as ('top' | 'centre' | 'lower')[];
  const position: 'centre' | 'lower' = positions.includes('top')
    ? (positions.includes('centre') ? 'centre' : 'lower')
    : positions.includes('centre') ? 'centre' : 'lower';
  const videos = plan.clips.filter(c => c.type === 'video' && c.trackId === 'video');
  const fullSource = videos.length === 1 &&
    Math.abs((videos[0]?.endS ?? 0) - (videos[0]?.startS ?? 0) - plan.durationS) < 0.1;
  /* Punch-ins are measured from the plan itself (scale > 1 means the shot
     pushes in) — never carried over from the reference, so the next
     regenerate and the match score see what the edit ACTUALLY does. */
  const punched = videos.filter(v => (v.transform?.scale ?? 1) > 1.02).length;
  return {
    ...profile,
    captions: {
      present: caps.length > 0,
      position,
      emphasis: profile.captions?.emphasis ?? 0.7,
    },
    uncut: fullSource || videos.length === 0,
    cutsPerMin: plan.durationS > 0 ? Math.round((videos.length / plan.durationS) * 60 * 10) / 10 : 0,
    punchInRate: videos.length
      ? Number((punched / videos.length).toFixed(2))
      : profile.punchInRate,
  };
}

/** Payload shape the AI route expects for the browser transcript. */
export function transcriptPayload(lines: TranscriptLine[]): {
  segments: TranscriptLine[]; language: string; model: string; madeAt: string;
} {
  return {
    segments: lines,
    language: '',
    model: 'whisper',
    madeAt: new Date().toISOString(),
  };
}

/** Push the profile's grade onto every video clip so look-only ops ("make it
 *  vibrant", "grade it") change the preview immediately, not on the next
 *  regenerate. */
export function applyProfileEffectsToLayer(layer: StyleLayer, profile: StyleProfile): StyleLayer {
  const effects = effectsForProfile(profile);
  const out: StyleLayer = {};
  for (const [id, st] of Object.entries(layer)) {
    out[id] = { ...st, effects };
  }
  return out;
}

/* ── Word intents (shared with Studio so the ONE AI gets the same context
       the Pro Editor prepared for it) ─────────────────────────────────────── */

/** Which messages need the words before the AI can act. */
export function needsTranscript(text: string): boolean {
  return /caption|subtitle|filler|\bums?\b|\buhs?\b|transcri|what (did|do|does|is)\s+(they|he|she|it|the)|what.*(say|said|talk|about)|quote|word/i
    .test(text);
}

/** Messages asking for standalone short clips (TikTok / Reels / shorts). */
export function wantsClips(text: string): boolean {
  return /\bclips?\b|\bshorts?\b|tiktok|reels?|viral|\b(?:give|find|make)(?: me)?\s*\d+\b/i
    .test(text);
}

/** Messages that are only answerable by looking at the picture. */
export function needsVision(text: string): boolean {
  return /what (?:can |do )?you see|what.?s (?:in|happening|going on)|describe|look at|watch|see the|visual|colour|color|wearing|who is|what is (?:he|she|it|this|that)|jersey|logo|scene|shot|background/i
    .test(text);
}

/** Nearest plain name for a measured caption highlight colour — the AI's
 *  style string is words, not hex, so the style lock can re-read it. */
export function captionColourName(hex: string): string {
  const c = hex.toLowerCase().replace(/^#/, '');
  const rgb = c.length === 3
    ? c.split('').map(x => parseInt(x + x, 16))
    : [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  const [r, g, b] = rgb.map(v => Number.isFinite(v) ? v : 0);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (max < 60) return 'white';                       // dark band = black box/outline
  if (d < 40) return r > 180 ? 'white' : 'yellow';    // near-neutral: white or pale
  if (max === r && g > 90 && g < 190 && b < 90) return 'red';
  if (max === r && g >= 190 && b < 120) return 'yellow';
  if (max === g && r < 140 && b < 140) return 'green';
  if (max === g && r >= 140) return 'yellow';
  if (max === b && g >= 140) return 'cyan';
  if (max === b) return 'blue';
  return 'yellow';
}

/** A short description of the learned reference style, sent as the AI's
 *  `style` hint so the model knows what "the same style" means. */
export function styleForAi(profile: StyleProfile): string {
  const g = profile.grade;
  const gradeBits: string[] = [];
  if (g.warmth > 0.08) gradeBits.push('warm', `warmth ${g.warmth.toFixed(2)}`);
  if (g.brightness > 0.05) gradeBits.push(`brightness +${(g.brightness * 100).toFixed(0)}%`);
  if (g.contrast > 0.15) gradeBits.push(`contrast +${(g.contrast * 100).toFixed(0)}%`);
  if (g.saturation > 0.2) gradeBits.push(`saturation +${(g.saturation * 100).toFixed(0)}%`);
  const capture = profile.captions.present
    ? `bold ${profile.captions.animated ? 'animated pop-in ' : ''}captions along the ${
        profile.captions.position === 'centre' ? 'middle' : 'bottom'}${
        profile.captions.animated
          ? ` (${profile.captions.highlightColour
              ? `${captionColourName(profile.captions.highlightColour)} highlights`
              : 'word-by-word transitions'})`
          : ''}`
    : 'no captions';
  const pacing = profile.uncut
    ? 'single uncut take'
    : profile.cutsPerMin > 0
      ? `~${profile.cutsPerMin.toFixed(0)} cuts per minute`
      : 'cut to the rhythm';
  return `${gradeBits.length ? gradeBits.join(', ') + ' grade' : 'neutral grade'}; ${pacing}; ${capture}`;
}

/** One AI look decision carried in the response's `applied` ops. */
export interface AiLook {
  grade?: { brightness: number; contrast: number; saturation: number };
  punchInRate?: number;
  changed: boolean;
}

/** Read the look-only operations out of an AI answer. */
export function parseAiLook(applied: unknown): AiLook {
  const ops = Array.isArray(applied) ? applied : [];
  let grade: AiLook['grade'];
  let punchInRate: number | undefined;
  for (const raw of ops) {
    const op = raw as { op?: string; brightness?: number; contrast?: number; saturation?: number; rate?: number };
    if (op?.op === 'grade' && typeof op.brightness === 'number') {
      grade = { brightness: op.brightness, contrast: Number(op.contrast) || 1, saturation: Number(op.saturation) || 1 };
    }
    if (op?.op === 'punch_in' && typeof op.rate === 'number') punchInRate = op.rate;
  }
  return { grade, punchInRate, changed: !!grade || punchInRate !== undefined };
}

/** Render a grade op onto the layer immediately and fold it into the profile
 *  so the next regenerate keeps the look (approximate, clamp keeps the
 *  profile in its relative-grade domain). */
export function applyAiLook(
  layer: StyleLayer,
  profile: StyleProfile,
  applied: unknown,
): { layer: StyleLayer; profile: StyleProfile; changed: boolean } {
  const look = parseAiLook(applied);
  if (!look.changed) return { layer, profile, changed: false };

  let layerOut = layer;
  if (look.grade) {
    const g = look.grade;
    layerOut = {};
    for (const [id, st] of Object.entries(layer)) {
      const base = st.effects ?? {};
      layerOut[id] = {
        ...st,
        effects: {
          ...DEFAULT_EFFECTS, ...base,
          brightness: g.brightness,
          contrast: g.contrast,
          saturation: g.saturation,
          colorGrade: {
            temperature: base.colorGrade?.temperature ?? 0,
            tint: 0,
            vibrance: Math.round((g.saturation - 1) * 70),
            exposure: g.brightness - 1,
            contrast: g.contrast,
            highlights: 0,
            shadows: 0,
            intensity: 100,
          },
        },
      };
    }
  }

  const clampRel = (v: number) => Math.max(-0.69, Math.min(0.69, v));
  const grade = profile.grade ?? { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
  const profileOut: StyleProfile = {
    ...profile,
    ...(look.grade
      ? { grade: {
          ...grade,
          brightness: clampRel((look.grade.brightness - 1) / 0.4),
          contrast:   clampRel((look.grade.contrast - 1) / 0.8),
          saturation: clampRel((look.grade.saturation - 1) / 0.85),
        } }
      : {}),
    ...(look.punchInRate !== undefined ? { punchInRate: Math.max(0, Math.min(1, look.punchInRate)) } : {}),
  };
  return { layer: layerOut, profile: profileOut, changed: true };
}
