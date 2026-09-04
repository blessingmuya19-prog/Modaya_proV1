/**
 * Reference deconstruction — four intelligence tracks, one master timeline.
 *
 * The blueprint: never ask a model "what's the style?" — force the analysis
 * through four parallel passes, synced by timestamp, so the context layer can
 * say WHY an edit happened, not just that it happened.
 *
 * Everything here is computed from measured signals (transcript, loudness,
 * onsets, picture, silences) — none of it is the LLM guessing. That is the
 * retrieval half of "structured RAG": the structured analysis is retrieved
 * from deterministic measurement, the model only reasons over it.
 *
 *   Track 1 NARRATIVE — speech segments, word rate, vocal intensity
 *   Track 2 VISUAL    — shot changes, motion bursts
 *   Track 3 OVERLAY   — caption windows (position from the measured style)
 *   Track 4 SONIC     — onset spikes triggered OUTSIDE speech = SFX, segment
 *                       starts = music-duck points
 */

export type TrackId = 'narrative' | 'visual' | 'overlay' | 'sonic';

export interface TrackEvent {
  tS:         number;
  durationS?: number;
  track:      TrackId;
  /** 'emphasis_hook' | 'vocal_beat' | 'steady' | 'shot_change' | 'motion_burst'
   *  | 'overlay_on' | 'overlay_off' | 'sfx_trigger' | 'duck_point' */
  type:       string;
  /** 0..1 — how strong the measured signal is here. */
  strength:   number;
  /** Why it happened, in one sentence — the model reads reasons, not guesses. */
  reason:     string;
}

export interface ReferenceAnalysis {
  global: {
    /** editorial label from mean shot length. */
    pacing: 'high_retention_rapid' | 'steady' | 'relaxed';
    averageCutDurationS: number;
    wordsPerMinute: number;
    energy: number;
    beatSynced: boolean;
  };
  /** Every track's events merged into one chronological timeline. */
  timeline_events: TrackEvent[];
}

/** Segment shape from the transcript module (startS/endS/text). */
export interface AnalysisTranscript {
  segments: { startS: number; endS: number; text: string }[];
}

/** Picture measurement from the browser (cut times + per-sample motion). */
export interface AnalysisVisual {
  cuts: number[];
  samples?: { tS: number; motion: number }[];
}

/** Caption knowledge derived from the reference style measurement. */
export interface AnalysisCaptions {
  present: boolean;
  position: 'centre' | 'lower';
  animated: boolean;
}

const wpm = (text: string, durS: number) =>
  durS > 0.05 ? Math.round((text.trim().split(/\s+/).filter(Boolean).length / durS) * 60) : 0;

/* ── Track 1: narrative ─────────────────────────────────────────────────── */

function narrativeTrack(
  transcript: AnalysisTranscript | null,
  durationS: number,
  energy: number[],
): TrackEvent[] {
  if (!transcript?.segments?.length) return [];
  const hop = energy.length > 1 ? durationS / energy.length : 0;
  const amplitude = (s: number, e: number) => {
    if (!hop) return 0.5;
    const a = Math.max(0, Math.floor(s / hop));
    const b = Math.min(energy.length, Math.ceil(e / hop));
    if (b <= a) return 0.5;
    let sum = 0;
    for (let i = a; i < b; i++) sum += energy[i] ?? 0;
    return sum / (b - a);
  };

  return transcript.segments.map(seg => {
    const dur = Math.max(0.2, seg.endS - seg.startS);
    const vol = amplitude(seg.startS, seg.endS);
    const words = wpm(seg.text, dur);
    const strong = vol > 0.72;
    const mid = vol > 0.52;
    return {
      tS: Number(seg.startS.toFixed(3)),
      durationS: Number(dur.toFixed(3)),
      track: 'narrative',
      type: strong ? 'emphasis_hook' : mid ? 'vocal_beat' : 'steady',
      strength: Number(Math.min(1, vol).toFixed(2)),
      reason: strong
        ? `Speaker's voice peaks here (${Math.round(vol * 100)}% intensity)${words > 150 ? ' while talking fast' : ''} — an emotional/hook inflection.`
        : mid
          ? `Firm vocal delivery at ${Math.round(vol * 100)}% intensity — keeps the beat of the talk.`
          : `Calm delivery at ${Math.round(vol * 100)}% intensity — a breath between emphases.`,
    };
  });
}

/* ── Track 2: visual dynamics ───────────────────────────────────────────── */

function visualTrack(
  visual: AnalysisVisual | null,
  durationS: number,
): TrackEvent[] {
  if (!visual) return [];
  const events: TrackEvent[] = [];
  for (const t of visual.cuts ?? []) {
    events.push({
      tS: Number(t.toFixed(3)),
      track: 'visual',
      type: 'shot_change',
      strength: 1,
      reason: 'The picture changed completely here — a hard cut in the source.',
    });
  }
  /* Motion bursts: sustained movement well above the clip's own baseline. */
  const samples = (visual.samples ?? []).filter(s => Number.isFinite(s.motion));
  if (samples.length > 4) {
    const mean = samples.reduce((a, s) => a + s.motion, 0) / samples.length;
    const sd = Math.sqrt(samples.reduce((a, s) => a + (s.motion - mean) ** 2, 0) / samples.length);
    for (let i = 1; i < samples.length - 1; i++) {
      const v = samples[i].motion;
      if (v > mean + 1.4 * sd && v > 0.25) {
        events.push({
          tS: Number(samples[i].tS.toFixed(3)),
          track: 'visual',
          type: 'motion_burst',
          strength: Number(Math.min(1, v).toFixed(2)),
          reason: `Framing moves fast here (${Math.round(v * 100)}% motion)${v > mean + 2.2 * sd ? ' — unusual for this footage' : ''}.`,
        });
      }
    }
  }
  return events;
}

/* ── Track 3: graphic overlays ──────────────────────────────────────────── */

function overlayTrack(
  transcript: AnalysisTranscript | null,
  captions: AnalysisCaptions,
): TrackEvent[] {
  if (!captions.present) return [];
  /* The reference burns captions where speech is; the measured style says
     where. Windows = speech spans (that is also when captions appear). */
  const segs = transcript?.segments ?? [];
  const events: TrackEvent[] = [];
  for (const seg of segs) {
    events.push({
      tS: Number(seg.startS.toFixed(3)),
      durationS: Number((seg.endS - seg.startS).toFixed(3)),
      track: 'overlay',
      type: 'overlay_on',
      strength: 0.8,
      reason: `${captions.animated ? 'Animated' : 'Static'} caption appears along the ${captions.position === 'centre' ? 'middle' : 'bottom'} at the start of speech.`,
    });
  }
  return events;
}

/* ── Track 4: sonic architecture ────────────────────────────────────────── */

function sonicTrack(
  onsets: number[],
  transcript: AnalysisTranscript | null,
  durationS: number,
  energy: number[],
): TrackEvent[] {
  const events: TrackEvent[] = [];
  if (!energy.length) return events;
  const segs = transcript?.segments ?? [];
  const inSpeech = (t: number) => segs.some(s => t >= s.startS - 0.05 && t <= s.endS + 0.05);
  const mean = energy.reduce((a, v) => a + v, 0) / energy.length;
  const sd = Math.sqrt(energy.reduce((a, v) => a + (v - mean) ** 2, 0) / energy.length);
  const hop = durationS / energy.length;

  for (const o of onsets) {
    const i = Math.round(o / hop);
    const v = energy[i];
    if (!Number.isFinite(v)) continue;
    /* A spike OUTSIDE speech is a sound effect / music hit, not a syllable. */
    if (inSpeech(o)) continue;
    if (v > mean + 0.9 * sd && v > 0.3) {
      events.push({
        tS: Number(o.toFixed(3)),
        track: 'sonic',
        type: 'sfx_trigger',
        strength: Number(Math.min(1, v).toFixed(2)),
        reason: `Loud hit off-voice (${Math.round(v * 100)}% loudness) — a transition SFX or music accent lands exactly here.`,
      });
    }
  }

  /* Music duck: speech starts after a musical pause — the momentary pause of
     the bed under the voice. Approximate with segment starts. */
  for (const seg of segs.slice(0, 120)) {
    events.push({
      tS: Number(seg.startS.toFixed(3)),
      track: 'sonic',
      type: 'duck_point',
      strength: 0.5,
      reason: 'Speech begins here — the bed ducks under the voice (and recovers at its end).',
    });
  }
  return events;
}

/* ── merge ──────────────────────────────────────────────────────────────── */

function mergeEvents(events: TrackEvent[]): TrackEvent[] {
  const byKey = new Map<string, TrackEvent>();
  for (const e of events) {
    const k = `${e.track}:${Math.round(e.tS * 10)}`;
    const prev = byKey.get(k);
    if (!prev || e.strength > prev.strength) byKey.set(k, e);
  }
  return [...byKey.values()].sort((a, b) => a.tS - b.tS);
}

/** Build the four-track analysis. Deterministic — same signals, same events. */
export function buildReferenceAnalysis(opts: {
  durationS: number;
  transcript?: AnalysisTranscript | null;
  energy?: number[];
  onsets?: number[];
  visual?: AnalysisVisual | null;
  /** Derived from the measured reference style. */
  captions?: AnalysisCaptions;
  /** Measured cut rate — feeds the global pacing label. */
  cutsPerMin?: number;
  beatSynced?: boolean;
}): ReferenceAnalysis {
  const {
    durationS, transcript = null, energy = [], onsets = [], visual = null,
    captions = { present: false, position: 'lower', animated: false },
    cutsPerMin = 0, beatSynced = false,
  } = opts;

  const events = mergeEvents([
    ...narrativeTrack(transcript, durationS, energy),
    ...visualTrack(visual, durationS),
    ...overlayTrack(transcript, captions),
    ...sonicTrack(onsets, transcript, durationS, energy),
  ]);

  const avgCut = cutsPerMin > 0 ? 60 / cutsPerMin : 0;
  const speakSeconds = (transcript?.segments ?? [])
    .reduce((a, s) => a + (s.endS - s.startS), 0);
  const words = (transcript?.segments ?? [])
    .reduce((a, s) => a + s.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const meanWordsPerMin = speakSeconds > 1 ? Math.round(words / (speakSeconds / 60)) : 0;

  return {
    global: {
      pacing: avgCut <= 0 ? 'relaxed'
        : avgCut < 2.4 ? 'high_retention_rapid'
        : avgCut < 4.5 ? 'steady' : 'relaxed',
      averageCutDurationS: Number(avgCut.toFixed(2)),
      wordsPerMinute: meanWordsPerMin,
      energy: Number(Math.min(1, energy.length
        ? energy.reduce((a, v) => a + v, 0) / energy.length : 0).toFixed(2)),
      beatSynced,
    },
    timeline_events: events.slice(0, 300),
  };
}

/** The block handed to the model — the exact shape the few-shot teaches. */
export function referenceAnalysisText(a: ReferenceAnalysis): string {
  const g = a.global;
  const head =
    `REFERENCE ANALYSIS (4 tracks, one master timeline):\n` +
    `global: pacing ${g.pacing}; average cut ${g.averageCutDurationS}s; ` +
    `${g.wordsPerMinute} words/min; energy ${Math.round(g.energy * 100)}%; ` +
    `beat ${g.beatSynced ? 'synced' : 'free'}`;
  if (!a.timeline_events.length) return head + '\n(no events measured)';
  const rows = a.timeline_events.map(e => {
    const at = `${e.tS.toFixed(2)}s`;
    const dur = e.durationS ? ` +${e.durationS.toFixed(2)}s` : '';
    return `  at ${at}${dur} [${e.track}/${e.type}/${Math.round(e.strength * 100)}%] ${e.reason}`;
  });
  return `${head}\n${rows.join('\n')}`;
}
