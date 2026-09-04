/**
 * Style rules — the interpretation layer between raw measurement and the AI.
 *
 * `StyleProfile` is numbers; the LLM (and a human reading a prompt) needs
 * what those numbers MEAN. This module turns a profile into a rule card:
 * machine-readable `StyleRules` (deterministic, testable) plus a plain-English
 * passage that travels in the prompt as the "REFERENCE STYLE LEARNED" block.
 *
 * The measurements stay the source of truth — nothing here invents style.
 * It only names what was measured, in the vocabulary of an editor.
 */
import type { StyleProfile } from './styleProfile';

/** Nearest plain name for a measured caption highlight colour — the rule
 *  card is words, not hex, so the style lock can re-read it. */
export function captionColourName(hex: string): string {
  const c = (hex ?? '').toLowerCase().replace(/^#/, '');
  const rgb = c.length === 3
    ? c.split('').map(x => parseInt(x + x, 16))
    : [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  const [r, g, b] = rgb.map(v => Number.isFinite(v) ? v : 0);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (max < 60) return 'white';                       // dark band = black box/outline
  if (d < 40) return r > 180 ? 'white' : 'yellow';    // near-neutral: white or pale
  if (max === r) {
    if (g >= 190) return 'yellow';                    // orange / amber
    if (g >= 90 && b >= 90) return 'pink';            // magenta-ish
    return 'red';
  }
  if (max === g) {
    if (r >= 140) return 'yellow';                    // lime → yellow
    return 'green';
  }
  if (max === b) {
    if (g >= 140) return 'cyan';                      // sky / aqua
    return 'blue';
  }
  return 'yellow';
}

export type RhythmCharacter = 'metronome' | 'punctuated' | 'loose';

/** Everything the AI needs to know about a learned style, structured. */
export interface StyleRules {
  pace: {
    cutsPerMin:  number;
    meanShotS:   number;
    medianShotS: number;
    /** Coefficient of variation of reference shot lengths. */
    variance:    number;
    /** Steady cadence vs unpredictable rhythm. */
    character:   RhythmCharacter;
    /** Length of the reference's opening shot (first cut = its end), if known. */
    openShotS:   number | null;
  };
  beat: {
    synced:  boolean;
    bpm:     number | null;
    energy:  number;
  };
  motion: {
    punchInRate: number;
    punchInMax:  number;
  };
  captions: {
    present:         boolean;
    position:        'centre' | 'lower';
    animated:        boolean;
    highlightColour?: string;
    emphasis:        number;
  };
  grade: {
    brightness: number;
    contrast:   number;
    saturation: number;
    warmth:     number;
    summary:    string;
  };
}

/** What kind of rhythm the measured variance means. */
export function rhythmCharacter(variance: number): RhythmCharacter {
  if (variance < 0.25) return 'metronome';    // steady, regular cuts
  if (variance < 0.6)  return 'punctuated';   // regular but breathing
  return 'loose';                             // erratic, keeps the viewer off-balance
}

/** The reference's opening shot length — the first cut ends it. */
export function openShotLength(profile: StyleProfile): number | null {
  const first = profile.cuts?.sort((a, b) => a - b)[0];
  return typeof first === 'number' && first > 0.2 ? Number(first.toFixed(2)) : null;
}

/** Names the grade like a colourist would, from the measured RELATIVE deltas
 *  (the same domain the whole style transfer uses: +0.38 contrast, +0.45
 *  saturation, +0.24 warmth — not absolute multipliers). */
export function gradeSummary(p: StyleProfile['grade']): string {
  const parts: string[] = [];
  if (p.warmth > 0.08) parts.push('warm');
  else if (p.warmth < -0.08) parts.push('cool');
  if (p.saturation > 0.2) parts.push('saturated');
  else if (p.saturation < -0.05) parts.push('muted');
  if (p.contrast > 0.2) parts.push('high-contrast');
  else if (p.contrast < -0.05) parts.push('soft');
  if (p.brightness > 0.05) parts.push('bright');
  else if (p.brightness < -0.05) parts.push('underexposed');
  return parts.length ? parts.join(', ') + ' grade' : 'neutral grade';
}

/** Profile → structured, editable rule card. Pure and deterministic. */
export function deriveStyleRules(profile: StyleProfile): StyleRules {
  const variance = Number(profile.shotVariance ?? 0);
  return {
    pace: {
      cutsPerMin:  Number(profile.cutsPerMin ?? 0),
      meanShotS:   Number(profile.shotMeanS ?? 0),
      medianShotS: Number(profile.shotMedianS ?? 0),
      variance:    variance,
      character:   rhythmCharacter(variance),
      openShotS:   openShotLength(profile),
    },
    beat: {
      synced: profile.beatSynced,
      bpm:    profile.bpm,
      energy: Number(profile.energy ?? 0),
    },
    motion: {
      punchInRate: Number(profile.punchInRate ?? 0),
      punchInMax:  Number(profile.punchInMax ?? 1),
    },
    captions: {
      present:         profile.captions.present,
      position:        profile.captions.position,
      animated:        Boolean(profile.captions.animated),
      highlightColour: profile.captions.highlightColour,
      emphasis:        Number(profile.captions.emphasis ?? 0),
    },
    grade: {
      brightness: Number(profile.grade.brightness ?? 0),
      contrast:   Number(profile.grade.contrast ?? 1),
      saturation: Number(profile.grade.saturation ?? 1),
      warmth:     Number(profile.grade.warmth ?? 0),
      summary:    gradeSummary(profile.grade),
    },
  };
}

/** The prompt block: what the measurements mean, in editor language. Keeps
 *  the exact phrases the style lock parses ("bold captions along the
 *  bottom", "~12 cuts per minute") so grounding and the model agree. */
export function styleRulesText(profile: StyleProfile, sourceName?: string): string {
  const r = deriveStyleRules(profile);
  const lines: string[] = [];

  const head = sourceName ? `Style of "${sourceName}":` : 'Style of the reference:';
  lines.push(head);

  /* ── beat / energy ── */
  if (r.beat.bpm || r.beat.synced) {
    lines.push(
      `- beat${r.beat.synced ? ' sync' : ''}${r.beat.bpm ? ` ~${Math.round(r.beat.bpm)} BPM` : ''}; ` +
      `energy ${Math.round(r.beat.energy * 100)}%`);
  } else {
    lines.push(`- energy ${Math.round(r.beat.energy * 100)}%`);
  }

  /* ── pacing — one line, in the vocabulary groundOperations parses ── */
  if (profile.uncut || profile.cutsPerMin === 0) {
    lines.push('- single uncut take (no cut pacing)');
  } else if (profile.cutsPerMin > 0) {
    const cadence = `~${profile.cutsPerMin.toFixed(0)} cuts per minute (shots averaging ${r.pace.meanShotS.toFixed(1)}s`;
    const tail = r.pace.medianShotS > 0 ? `, median ${r.pace.medianShotS.toFixed(1)}s` : '';
    lines.push(`- ${cadence}${tail})`);
    lines.push(`- rhythm character: ${r.pace.character}`);
  } else {
    lines.push('- cut to the rhythm');
  }
  if (r.pace.openShotS !== null) {
    lines.push(`- opening shot: ${r.pace.openShotS}s long — the hook window`);
  }

  /* ── push-ins ── */
  if (r.motion.punchInRate > 0.08) {
    lines.push(`- push-ins on ~${Math.round(r.motion.punchInRate * 100)}% of shots (up to ${Math.round((r.motion.punchInMax - 1) * 100)}% zoom)`);
  } else {
    lines.push('- no push-ins (static framing)');
  }

  /* ── captions — the phrase lockTextToStyle keys on ── */
  if (r.captions.present) {
    const place = r.captions.position === 'centre' ? 'middle' : 'bottom';
    const motion = r.captions.animated
      ? `animated pop-in (${r.captions.highlightColour
          ? `${captionColourName(r.captions.highlightColour)} highlights`
          : 'word-by-word transitions'})`
      : 'static';
    lines.push(`- bold captions along the ${place}, ${motion}`);
  } else {
    lines.push('- no captions');
  }

  /* ── grade ── */
  const g = r.grade;
  const numbers = [
    g.brightness > 0.05 ? `brightness +${(g.brightness * 100).toFixed(0)}%` : null,
    g.contrast > 0.15 ? `contrast +${(g.contrast * 100).toFixed(0)}%` : null,
    g.saturation > 0.2 ? `saturation +${(g.saturation * 100).toFixed(0)}%` : null,
  ].filter(Boolean).join(', ');
  lines.push(`- ${g.summary}${numbers ? ` (${numbers})` : ''}`);

  return lines.join('\n');
}
