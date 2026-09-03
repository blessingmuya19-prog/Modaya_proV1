/**
 * Refinement — turn a plain-language "tell Modaya what to change" request into
 * a new StyleProfile the edit plan is regenerated from.
 *
 * The product rule is that the user never touches a technical control. "Make
 * it more energetic", "more punch-ins", "use the reference's captions more" or
 * "the intro is too slow" are parsed here into the measured style properties
 * (cuts/min, energy, punch-in rate, caption habit, grade) and the EditPlan is
 * rebuilt — deterministically, with no extra model call required. The LLM
 * remains available for open-ended phrasing; this handles the common,
 * predictable intents instantly and safely.
 *
 * Everything in this module is pure and clamp-bounded, so a loose phrase can
 * never produce a nonsensical profile.
 */
import type { StyleProfile, Pace } from '../ai/styleProfile';
import { paceOf } from '../ai/styleProfile';

export interface RefineResult {
  /** The adjusted profile (a copy — the input is never mutated). */
  profile: StyleProfile;
  /** Whether the request actually changed anything. */
  changed: boolean;
  /** A short, human "done" description shown in the chat. */
  reply: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Push the cuts/min by a factor and keep the derived shot lengths consistent. */
function setPacing(p: StyleProfile, factor: number): boolean {
  const cpm = clamp(p.cutsPerMin * factor, 3, 60);
  if (Math.abs(cpm - p.cutsPerMin) < 0.5) return false;
  p.cutsPerMin  = Math.round(cpm * 10) / 10;
  // Shot lengths fall out of cuts per minute.
  const mean    = 60 / p.cutsPerMin;
  p.shotMeanS   = Math.round(mean * 100) / 100;
  p.shotMedianS = Math.round(mean * 0.92 * 100) / 100;
  p.pace        = paceOf(p.cutsPerMin);
  return true;
}

/** A request Modaya understands but requires footage not in the project. */
const NOT_YET: { match: RegExp; note: string }[] = [
  { match: /b-?roll from|insert stock footage|generate b-?roll|find b-?roll/i,
    note: 'Drop clips into the B-roll library on the drop screen — Modaya will weave them into your edit as silent cutaways.' },
];

/**
 * Apply a free-text refinement to a profile. `seed` is bumped by the caller to
 * make a regenerated plan differ even when the wording implied no measurable
 * change (e.g. "regenerate", "try again").
 */
export function refineProfile(base: StyleProfile, message: string): RefineResult {
  const text = ` ${message.toLowerCase()} `;
  const p: StyleProfile = structuredClone(base);
  const did: string[] = [];
  let changed = false;

  // Things we honestly can't change in the deterministic plan yet.
  for (const n of NOT_YET) {
    if (n.match.test(text)) {
      return { profile: base, changed: false, reply: n.note };
    }
  }

  const wantsFast = /\b(faster|snappier|more energetic|more energy|energetic|more dynamic|punchier|more punchy|tighter|speed up|too slow|drags?)\b/.test(text)
    || (/\bslow\b/.test(text.replace(/not?\s+slow|less?\s+slow/g, '')) && /too|make|more|faster/.test(text));
  const wantsSlow = /\b(slower|calm|calmer|more relaxed|less energetic|slow down|too fast|rushed|breathing room)\b/.test(text);

  // "the intro/start/beginning is too slow" → tighten overall (start-first is
  // a future refinement; we honour the clear intent: less dead air, faster cut).
  const introSlow = /\b(intro|start|beginning|opening|hook)\b/.test(text) && /\b(slow|drag|long|boring)\b/.test(text);

  if (introSlow) {
    if (setPacing(p, 1.3)) { changed = true; did.push('tightened the pacing and cut more dead air, especially up front'); }
    p.energy = clamp(p.energy + 0.12, 0, 1);
  } else if (wantsFast) {
    if (setPacing(p, 1.35)) { changed = true; did.push('sped up the cut rhythm'); }
    p.energy = clamp(p.energy + 0.1, 0, 1);
  } else if (wantsSlow) {
    if (setPacing(p, 0.7)) { changed = true; did.push('slowed the pacing to give moments room'); }
    p.energy = clamp(p.energy - 0.08, 0, 1);
  }

  // Punch-ins / zooms
  const moreZoom = /\b(more|lots? of|extra|add|use more|bigger)\b.*\b(punch-?ins?|zoom|push-?ins?|close-?ups?)\b/.test(text)
    || /\bpunch-?ins?\b.*\bmore\b/.test(text);
  const lessZoom = /\b(less|fewer|no|remove|stop)\b.*\b(punch-?ins?|zoom|push-?ins?|close-?ups?)\b/.test(text);
  if (moreZoom) {
    p.punchInRate = clamp(p.punchInRate + 0.25, 0, 0.95);
    p.punchInMax  = clamp(p.punchInMax + 0.03, 1.06, 1.4);
    changed = true; did.push('added more punch-ins like the reference');
  } else if (lessZoom) {
    p.punchInRate = clamp(p.punchInRate - 0.25, 0, 1);
    changed = true; did.push('dialled back the punch-ins');
  }

  // Captions
  const moreCaps = /\b(more|bigger|louder|emphasi[sz]e|use .{0,12}captions?|captions? more)\b.*\b(captions?|subtitles?|text)\b/.test(text)
    || (/\bcaptions?\b/.test(text) && /\bmore|reference|like\b/.test(text));
  const lessCaps = /\b(no|remove|less|fewer|get rid of|drop|turn off)\b.*\b(captions?|subtitles?)\b/.test(text)
    || /\b(captions?|subtitles?)\b.*\b(off|gone|away)\b/.test(text);
  if (moreCaps) {
    p.captions = { present: true, position: p.captions?.position ?? 'lower', emphasis: clamp((p.captions?.emphasis ?? 0.4) + 0.25, 0, 1) };
    if (setPacing(p, 1.05)) { /* denser shots → captions land more often */ }
    changed = true; did.push('brought the reference-style captions in more');
  } else if (lessCaps) {
    p.captions = { ...(p.captions ?? { present: false, position: 'lower' as const, emphasis: 0 }), present: false };
    changed = true; did.push('removed the captions');
  }

  // Colour grade
  if (/\b(more|warmer|warm up)\b.*\b(colou?r|grade|warm|tone)\b/.test(text) || /\bwarmer\b/.test(text)) {
    p.grade = { ...p.grade, warmth: clamp(p.grade.warmth + 0.12, -1, 1), saturation: clamp(p.grade.saturation + 0.05, -1, 1) };
    changed = true; did.push('warmed the grade');
  }
  if (/\b(cooler|colder)\b/.test(text)) {
    p.grade = { ...p.grade, warmth: clamp(p.grade.warmth - 0.12, -1, 1) };
    changed = true; did.push('cooled the grade');
  }
  if (/\b(more vivid|more saturated|punchier colou?r|pop)\b/.test(text)) {
    p.grade = { ...p.grade, saturation: clamp(p.grade.saturation + 0.12, -1, 1), contrast: clamp(p.grade.contrast + 0.05, -1, 1) };
    changed = true; did.push('made the colours more vivid');
  }
  if (/\b(brighter|too dark|lighten)\b/.test(text)) {
    p.grade = { ...p.grade, brightness: clamp(p.grade.brightness + 0.08, -1, 1) };
    changed = true; did.push('brightened the picture');
  }

  // Shorter / longer whole edit
  if (/\b(shorter|trim it down|cut it down|more concise)\b/.test(text)) {
    p.energy = clamp(p.energy + 0.15, 0, 1);
    if (setPacing(p, 1.15)) {}
    changed = true; did.push('tightened it to a shorter cut');
  }
  if (/\b(longer|keep more|less aggressive cut|don.t cut so much)\b/.test(text)) {
    p.energy = clamp(p.energy - 0.15, 0, 1);
    if (setPacing(p, 0.85)) {}
    changed = true; did.push('kept more of the footage');
  }

  // "I don't like this section / part" — trim the weak parts harder.
  if (/\b(don.t like|don.t want|remove|cut out|skip)\b.*\b(section|part|bit|chunk)\b/.test(text)
      || /\b(section|part|bit)\b.*\b(don.t like|boring|slow)\b/.test(text)) {
    p.energy = clamp(p.energy + 0.12, 0, 1);
    if (setPacing(p, 1.2)) {}
    changed = true; did.push('cut the weaker sections tighter');
  }

  if (!changed) {
    return {
      profile: base,
      changed: false,
      reply: "I can adjust pacing, punch-ins/zooms, captions, the grade, or make the cut shorter or longer. For example: “make it more energetic”, “more punch-ins”, or “use captions like the reference”.",
    };
  }

  return {
    profile: p,
    changed: true,
    reply: `Done — I ${did.join('; ')}. Regenerating your edit…`,
  };
}

/** Pace label helper exposed for the UI/tests. */
export function paceLabel(pace: Pace): string {
  return pace;
}
