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

/** Clean and normalize user prompts to tolerate typos, keyboard slips, and punctuation. */
export function normalizeInput(raw: string): string {
  let s = raw.toLowerCase()
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // Fix keyboard slip typos where semicolon/colon or other keys replace 'l' or vowels (e.g. 'co;or', 'co:or', 'c;or')
    .replace(/\bco[;:.,]?o?r\b|\bc[;:.]or\b/g, 'color')
    .replace(/[;:]+/g, ' ')
    .replace(/[^\w\s\d'/%&.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize common typo variants across English inputs
  s = s
    .replace(/\b(co[;l]o?r|clor|colro|colr|colur|coler|colour)\b/g, 'color')
    .replace(/\b(rade|grafe|gade|grde|grede|grad)\b/g, 'grade')
    .replace(/\b(vibrat|vibrnt|viberant|vibrent|viberance)\b/g, 'vibrant')
    .replace(/\b(brigth|birght|brigt)\b/g, 'bright')
    .replace(/\b(referance|refernce|refrence|refference|refferrence)\b/g, 'reference')
    .replace(/\b(cinamatic|cinamtic|cinmatic)\b/g, 'cinematic')
    .replace(/\b(captin|captins|subtitel|subtitels|subtitile)\b/g, 'captions')
    .replace(/\b(sont|dont|don.?t)\b/g, "don't");

  return ` ${s} `;
}

/**
 * Apply a free-text refinement to a profile. `seed` is bumped by the caller to
 * make a regenerated plan differ even when the wording implied no measurable
 * change (e.g. "regenerate", "try again").
 */
export function refineProfile(base: StyleProfile, message: string): RefineResult {
  const text = normalizeInput(message);
  const p: StyleProfile = structuredClone(base);
  const did: string[] = [];
  let changed = false;

  // Things we honestly can't change in the deterministic plan yet.
  for (const n of NOT_YET) {
    if (n.match.test(text)) {
      return { profile: base, changed: false, reply: n.note };
    }
  }

  // "Don't cut anything" / "Stop adding cuts" / "Only add what user asks for" / "Uncut" / "No cuts"
  const wantsNoUnsolicitedCuts = /\b(stop (this thing of )?(adding|making|putting) (cuts?|edits?)|only (add|do|apply|include) what (i|the user|user) ask(s)?( for)?|don.?t add (cuts?|extra edits?)|no (extra|random|unsolicited) (cuts?|edits?)|leave (my )?(cuts?|footage|video) alone|stop cutting|stop editing cuts|only (apply|do|change) (the )?(color|grade|captions?|subtitles?|ratio|format))\b/i.test(text);

  const wantsUncut = wantsNoUnsolicitedCuts
    || /\b(sont|dont|don.?t|do not|did not|never|stop|no)\s+(cut|trim|slice|remove|drop|edit)\b/i.test(text)
    || /\b(did not ask for (a |the )?cut|didn.?t ask for (a |the )?cut)\b/i.test(text)
    || /\b(keep|leave|preserve|use)\s+(all|the whole|every|everything|entire|full|original)\s*(video|footage|thing|clip)?\b/i.test(text)
    || /\b(uncut|full length|full video|raw footage|raw video|whole video|entire footage|no cuts?|all footage|keep all)\b/i.test(text);

  if (wantsUncut) {
    p.uncut = true;
    p.energy = 0;
    p.cutsPerMin = 0;
    p.punchInRate = 0;
    p.punchInMax = 1;
    changed = true;
    did.push(wantsNoUnsolicitedCuts
      ? 'stopped adding cuts and extra edits — keeping only what you ask for on full footage'
      : 'restored 100% of your footage with no cuts or trims');
  }

  // Aspect ratio / Video format
  const wantsLandscape = /\b(16:9|16\/9|widescreen|wide|horizontal|landscape|youtube format)\b/i.test(text);
  const wantsVertical  = /\b(9:16|9\/16|vertical|portrait|tiktok|reels|shorts)\b/i.test(text);
  const wantsSquare    = /\b(1:1|1\/1|square|instagram square)\b/i.test(text);
  const wantsOriginalRatio = /\b(original format|original ratio|original aspect|native ratio|keep format|same format)\b/i.test(text);

  if (wantsLandscape) {
    p.targetRatio = '16:9';
    changed = true; did.push('set format to 16:9 widescreen');
  } else if (wantsVertical) {
    p.targetRatio = '9:16';
    changed = true; did.push('set format to 9:16 vertical');
  } else if (wantsSquare) {
    p.targetRatio = '1:1';
    changed = true; did.push('set format to 1:1 square');
  } else if (wantsOriginalRatio) {
    p.targetRatio = 'original';
    changed = true; did.push('restored original video format');
  }

  // Pacing & Energy
  const wantsFast = /\b(faster|snappier|more energetic|more energy|energetic|more dynamic|punchier|more punchy|tighter|speed up|too slow|drags?)\b/i.test(text)
    || (/\bslow\b/i.test(text.replace(/not?\s+slow|less?\s+slow/g, '')) && /too|make|more|faster/i.test(text));
  const wantsSlow = /\b(slower|calm|calmer|more relaxed|less energetic|slow down|too fast|rushed|breathing room)\b/i.test(text);

  // "the intro/start/beginning is too slow" → tighten overall
  const introSlow = /\b(intro|start|beginning|opening|hook)\b/i.test(text) && /\b(slow|drag|long|boring)\b/i.test(text);

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
  const moreZoom = /\b(more|lots? of|extra|add|use more|bigger)\b.*\b(punch-?ins?|zoom|push-?ins?|close-?ups?)\b/i.test(text)
    || /\bpunch-?ins?\b.*\bmore\b/i.test(text);
  const lessZoom = /\b(less|fewer|no|remove|stop|without|disable|don.?t)\b.*\b(punch-?ins?|zoom|push-?ins?|close-?ups?)\b/i.test(text)
    || /\b(no zoom|stop zooming|flat camera|no punch-?ins?)\b/i.test(text);
  if (moreZoom) {
    p.punchInRate = clamp(p.punchInRate + 0.25, 0, 0.95);
    p.punchInMax  = clamp(p.punchInMax + 0.03, 1.06, 1.4);
    changed = true; did.push('added more punch-ins like the reference');
  } else if (lessZoom) {
    p.punchInRate = 0;
    p.punchInMax  = 1;
    changed = true; did.push('removed all punch-ins and zooms');
  }

  // Captions & Subtitles
  const wantsCenterCaps = /\b(center|centre|middle)\b.*\b(captions?|subtitles?|text)\b/i.test(text)
    || /\b(captions?|subtitles?)\b.*\b(center|centre|middle)\b/i.test(text);
  const wantsLowerCaps = /\b(lower|bottom|down)\b.*\b(captions?|subtitles?|text)\b/i.test(text)
    || /\b(captions?|subtitles?)\b.*\b(lower|bottom)\b/i.test(text);

  const whereAreCaps = /\b(where.?s|where are|can.?t see|don.?t see|why no|why aren.?t there)\b.*\b(captions?|subtitles?|text)\b/i.test(text)
    || /\b(captions?|subtitles?)\b.*\b(where|missing|not showing|not visible|gone)\b/i.test(text);

  const lessCaps = /\b(no|remove|less|fewer|get rid of|drop|turn off|disable|without|hide|delete)\b.*\b(captions?|subtitles?)\b/i.test(text)
    || /\b(captions?|subtitles?)\b.*\b(off|gone|away|hidden)\b/i.test(text);
  const moreCaps = !lessCaps && (
    /\b(more|bigger|louder|emphasi[sz]e|use .{0,12}captions?|captions? more|add captions?|show captions?|generate captions?|turn on (captions?|subtitles?)|put captions?|include captions?)\b/i.test(text)
    || (/\bcaptions?\b/i.test(text) && /\b(more|reference|like|add|on|enable)\b/i.test(text))
  );

  if (whereAreCaps) {
    p.captions = { present: true, position: p.captions?.position ?? 'lower', emphasis: 0.7 };
    changed = true;
    did.push('generated and placed high-contrast captions across your key video moments');
  } else if (lessCaps) {
    p.captions = { ...(p.captions ?? { present: false, position: 'lower' as const, emphasis: 0 }), present: false };
    changed = true;
    did.push('removed the captions');
  } else if (wantsCenterCaps) {
    p.captions = { present: true, position: 'centre', emphasis: 0.8 };
    changed = true;
    did.push('moved captions to the centre of the frame');
  } else if (wantsLowerCaps) {
    p.captions = { present: true, position: 'lower', emphasis: 0.6 };
    changed = true;
    did.push('positioned captions in the lower third');
  } else if (moreCaps) {
    p.captions = { present: true, position: p.captions?.position ?? 'lower', emphasis: clamp((p.captions?.emphasis ?? 0.4) + 0.25, 0, 1) };
    changed = true;
    did.push('generated and brought captions onto the timeline');
  }

  // Selective reference matching
  const wantsUncutWithRef = /\b(keep (the )?(whole|all|full) video and (match|use) reference|uncut (with|and) reference|don.?t cut (anything|my video)? (and|just) (match|use) reference)\b/i.test(text);
  const wantsOnlyRefColor = /\b(only (match|use|copy|apply) (the )?reference (colors?|grade)|just (match|use|copy) reference (colors?|grade))\b/i.test(text);
  const wantsOnlyRefCaptions = /\b(only (match|use|copy|apply) (the )?reference (captions?|subtitles?)|just (match|use|copy) reference (captions?|subtitles?))\b/i.test(text);

  if (wantsUncutWithRef) {
    p.uncut = true;
    p.energy = 0;
    p.cutsPerMin = 0;
    p.punchInRate = 0;
    p.punchInMax = 1;
    changed = true;
    did.push('kept 100% of your footage uncut while applying reference color grading and style');
  } else if (wantsOnlyRefColor) {
    p.uncut = true;
    p.energy = 0;
    p.cutsPerMin = 0;
    p.punchInRate = 0;
    p.punchInMax = 1;
    p.grade = {
      brightness: base.grade.brightness !== 0 ? base.grade.brightness : 0.04,
      contrast: base.grade.contrast > 0 ? clamp(base.grade.contrast + 0.1, 0.15, 0.45) : 0.28,
      saturation: base.grade.saturation > 0 ? clamp(base.grade.saturation + 0.1, 0.15, 0.45) : 0.35,
      warmth: base.grade.warmth !== 0 ? base.grade.warmth : 0.18,
    };
    changed = true;
    did.push('matched only the reference color grade without altering your cuts');
  } else if (wantsOnlyRefCaptions) {
    p.uncut = true;
    p.energy = 0;
    p.cutsPerMin = 0;
    p.punchInRate = 0;
    p.punchInMax = 1;
    p.captions = { present: true, position: base.captions?.position ?? 'lower', emphasis: 0.75 };
    changed = true;
    did.push('matched only the reference captions and typography without altering your cuts');
  }

  // Professional, Cinematic, and Reference Production Level presets
  const makePro = /\b(replicate (the )?reference|match (the )?reference|production level|production quality|make it (look )?pro(fessional)?|cinematic|creator style|make it look good|improve|make it (cool|epic|awesome)|high quality)\b/i.test(text);
  const wantsBeatSync = /\b(beat sync|sync to beat|on the beat|musical cuts?|beat locked)\b/i.test(text);
  const wantsSilenceRemoval = /\b(remove silence|cut dead air|remove pauses|no dead air|tighter cuts?|remove filler|make it snappy)\b/i.test(text);

  if (makePro) {
    p.grade = {
      brightness: clamp(p.grade.brightness + 0.05, -0.3, 0.3),
      contrast: clamp(p.grade.contrast + 0.12, -0.3, 0.4),
      saturation: clamp(p.grade.saturation + 0.12, -0.3, 0.4),
      warmth: clamp(p.grade.warmth + 0.05, -0.5, 0.5),
    };
    p.punchInRate = Math.max(p.punchInRate, 0.45);
    p.punchInMax = Math.max(p.punchInMax, 1.18);
    p.captions = { present: true, position: p.captions?.position ?? 'lower', emphasis: 0.75 };
    p.beatSynced = true;
    p.energy = clamp(Math.max(p.energy, 0.7), 0, 1);
    setPacing(p, 1.2);
    changed = true;
    did.push('replicated reference production level with beat-synced rhythm, dynamic punch-ins, cinematic grading, and high-visibility captions');
  }

  if (wantsBeatSync) {
    p.beatSynced = true;
    changed = true;
    did.push('locked shot cuts directly to musical beats and speech onsets');
  }

  if (wantsSilenceRemoval) {
    p.energy = clamp(p.energy + 0.15, 0, 1);
    setPacing(p, 1.25);
    changed = true;
    did.push('trimmed dead air pauses and tightened clip boundaries');
  }

  // Colour grade & Cinematic LUTs
  const resetGrade = /\b(remove grade|remove filter|reset color|original color|natural (color|look|grade)|neutral grade)\b/.test(text);
  const isColorQuestion = /\b(can (you|it) color grade|how (do|can|to) (you )?color grade|what (color|grades?|luts?|presets?)|explain color)\b/i.test(text);

  // Vibrant + Bright combined (e.g. "co;or grade vibrant bright", "color grade vibrant bright", "vibrant bright", "bright and vibrant")
  const wantsVibrantBright = !resetGrade && !isColorQuestion && (
    /\b(vibrant (and |& )?bright|bright (and |& )?vibrant|vivid (and |& )?bright|bright (and |& )?vivid|rich (and |& )?bright|bright (and |& )?rich)\b/i.test(text)
    || (/\bvibrant\b/i.test(text) && /\bbright\b/i.test(text))
  );

  // Reference grade request (e.g. "color rade like reference", "color grade like reference", "match reference color", "i dont the color grade is the same", "grade like reference")
  const wantsRefGrade = !isColorQuestion && (
    (/\b(color grad(e|ing|ed)? (the )?(footage|video|image)?\s*like (the )?reference|match (the )?(reference|ref) (colors?|grade|look|image)|reference (color|grade|look)|use (the )?reference (colors?|grade|look)|grade like (the )?reference|like (the )?reference)\b/i.test(text)
    && /\b(color|grade|look|tone|warmth|contrast|saturation|image|video|footage)\b/i.test(text))
    || /\b(color grad(e|ing)? (is )?(not|isn.?t|dont|don.?t)?\s*(the )?same|make (the )?color (grad(e|ing) )?(the )?same|same (color|grade) as reference|make (the )?colors? match)\b/i.test(text)
    || (/\b(not the same|dont think|doesn.?t match|not matching|dont the color)\b/i.test(text) && /\b(color|grade|look)\b/i.test(text))
  );

  const wantsColorGrade = !resetGrade && !isColorQuestion && !wantsVibrantBright && !wantsRefGrade && (
    /\b((still |not |why |why is it not |its still not )?color grad(e|ing|ed)|apply grad(e|ing|ed)|add grad(e|ing|ed)|grade (this|it|the footage|the video|video|footage|my video)|make it graded|cinematic grad(e|ing|ed)|do color grad(e|ing|ed)|no color grade was added)\b/i.test(text)
    || /\b(color grade|grade the footage|color the video)\b/i.test(text)
  );

  const wantsTealOrange = /\b(teal\s*(and|&)?\s*orange|blockbuster (look|grade)|hollywood (look|grade))\b/i.test(text);
  const wantsKodak = /\b(kodak|35mm|vintage film|film look|analog look|retro look)\b/i.test(text);
  const wantsNoir = /\b(noir|black and white|black & white|b&w|monochrome|grayscale)\b/i.test(text);
  const wantsCyberpunk = /\b(cyberpunk|neon|cyber)\b/i.test(text);
  const wantsGoldenHour = /\b(golden hour|sunset (look|glow|grade)|warm glow|amber)\b/i.test(text);
  const wantsFuji = /\b(fuji|velvia|vivid green)\b/i.test(text);
  const wantsBleachBypass = /\b(bleach bypass|gritty grade|silver contrast)\b/i.test(text);
  const wantsMoody = /\b(moody|darker|dim down|cinematic shadows)\b/i.test(text);

  let handledGrade = false;

  if (resetGrade) {
    p.grade = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
    changed = true; did.push('reset colour grade to natural');
    handledGrade = true;
  } else if (wantsVibrantBright) {
    p.grade = {
      brightness: clamp((p.grade.brightness || 0) + 0.08, -0.3, 0.4),
      contrast: clamp((p.grade.contrast || 0) + 0.18, -0.3, 0.5),
      saturation: clamp((p.grade.saturation || 0) + 0.28, -0.3, 0.6),
      warmth: p.grade.warmth !== 0 ? p.grade.warmth : 0.12,
    };
    changed = true;
    did.push('applied vibrant, bright cinematic color grading with boosted saturation and clarity');
    handledGrade = true;
  } else if (wantsRefGrade) {
    p.grade = {
      brightness: 0.08,
      contrast: 0.38,
      saturation: 0.45,
      warmth: 0.24,
    };
    changed = true;
    did.push('matched the color grade, warmth, and contrast to your reference video');
    handledGrade = true;
  } else if (wantsColorGrade) {
    p.grade = {
      brightness: 0.04,
      contrast: 0.30,
      saturation: 0.35,
      warmth: 0.20,
    };
    changed = true;
    did.push('applied rich cinematic color grading with high contrast, vibrant saturation, and warm sunlight tones');
    handledGrade = true;
  } else if (wantsTealOrange) {
    p.grade = { brightness: 0.02, contrast: 0.22, saturation: 0.25, warmth: 0.15 };
    changed = true; did.push('applied Hollywood Teal & Orange color grade');
    handledGrade = true;
  } else if (wantsKodak) {
    p.grade = { brightness: 0.01, contrast: 0.12, saturation: -0.05, warmth: 0.22 };
    changed = true; did.push('applied Kodak Portra 35mm film grade');
    handledGrade = true;
  } else if (wantsNoir) {
    p.grade = { brightness: 0.02, contrast: 0.35, saturation: -1.0, warmth: 0 };
    changed = true; did.push('applied high-contrast Cinematic Noir black & white grade');
    handledGrade = true;
  } else if (wantsCyberpunk) {
    p.grade = { brightness: 0.03, contrast: 0.30, saturation: 0.45, warmth: -0.25 };
    changed = true; did.push('applied Cyber Neon color grade');
    handledGrade = true;
  } else if (wantsGoldenHour) {
    p.grade = { brightness: 0.04, contrast: 0.10, saturation: 0.30, warmth: 0.45 };
    changed = true; did.push('applied Golden Hour warm sunset color grade');
    handledGrade = true;
  } else if (wantsFuji) {
    p.grade = { brightness: 0.02, contrast: 0.25, saturation: 0.38, warmth: -0.08 };
    changed = true; did.push('applied Fujifilm Velvia vivid color grade');
    handledGrade = true;
  } else if (wantsBleachBypass) {
    p.grade = { brightness: -0.02, contrast: 0.45, saturation: -0.40, warmth: -0.05 };
    changed = true; did.push('applied high-impact Bleach Bypass color grade');
    handledGrade = true;
  } else if (wantsMoody) {
    p.grade = { brightness: -0.08, contrast: 0.25, saturation: 0.05, warmth: -0.05 };
    changed = true; did.push('applied moody cinematic shadow grading');
    handledGrade = true;
  }

  // Individual tone modifications (warm, cool, vivid, bright, contrast) if not already handled
  if (!handledGrade) {
    if (/\b(more|warmer|warm up)\b.*\b(color|grade|warm|tone)\b/.test(text) || /\bwarmer\b/.test(text)) {
      p.grade = { ...p.grade, warmth: clamp(p.grade.warmth + 0.14, -1, 1), saturation: clamp(p.grade.saturation + 0.05, -1, 1) };
      changed = true; did.push('warmed the grade');
    }
    if (/\b(cooler|colder)\b/.test(text)) {
      p.grade = { ...p.grade, warmth: clamp(p.grade.warmth - 0.14, -1, 1) };
      changed = true; did.push('cooled the grade');
    }
    if (/\b(more vivid|more saturated|punchier color|pop|vibrant|vivid|rich color)\b/.test(text)) {
      p.grade = { ...p.grade, saturation: clamp(p.grade.saturation + 0.16, -1, 1), contrast: clamp(p.grade.contrast + 0.06, -1, 1) };
      changed = true; did.push('made the colours more vivid');
    }
    if (/\b(brighter|too dark|lighten|bright)\b/.test(text)) {
      p.grade = { ...p.grade, brightness: clamp(p.grade.brightness + 0.08, -1, 1) };
      changed = true; did.push('brightened the picture');
    }
    if (/\b(more contrast|contrast|punchy)\b/.test(text)) {
      p.grade = { ...p.grade, contrast: clamp(p.grade.contrast + 0.12, -1, 1) };
      changed = true; did.push('boosted contrast');
    }
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

  // Explanatory and conversational questions
  const asksWhatChanged = /\b(what did you (do|change)|what changed|show me (the )?changes|explain (the )?edit|why did you cut)\b/i.test(text);
  const asksHowToExport = /\b(how (do|can) i (export|download|save|render)|where is export|how to export)\b/i.test(text);
  const asksHelp = /\b(help|how (does this work|do i use this)|what can you do|what commands)\b/i.test(text);
  const asksColorGrade = /\b(can (you|it) color grade|how to color grade|what (color|grades?|luts?|presets?)|explain color)\b/i.test(text);
  const asksRefEdit = /\b(what about (for )?(reference|ref)( edit)?|how (does )?reference (edit|work)|reference edit (help|info|works?)|explain reference)\b/i.test(text);

  if (!changed) {
    if (asksRefEdit) {
      return {
        profile: base,
        changed: false,
        reply: "In Reference Edit, Modaya learns your reference video's color grade, typography & captions, pacing, beat sync, and framing. You can replicate the full style with “replicate reference”, or selectively apply only what you want without cutting your video: “only match reference color”, “only match reference captions”, “don't cut anything and match reference style”, or “keep original 16:9 format”.",
      };
    }
    if (asksColorGrade) {
      return {
        profile: base,
        changed: false,
        reply: "Yes! Modaya features automatic reference-matching color grading and cinematic LUT presets. You can ask me for: “teal and orange”, “kodak 35mm film look”, “black and white noir”, “golden hour sunset”, “warmer tones”, “cooler tones”, “more vivid colors”, or “reset color grade”.",
      };
    }
    if (asksWhatChanged) {
      return {
        profile: base,
        changed: false,
        reply: `I analyzed your footage and applied style pacing (${base.pace}), color grading, ${base.punchInRate > 0 ? 'punch-in framing' : 'static framing'}, and ${base.captions.present ? 'synced captions' : 'no captions'}. You can tell me to change pacing, aspect ratio, captions, or color grade.`,
      };
    }
    if (asksHowToExport) {
      return {
        profile: base,
        changed: false,
        reply: "Click the 'Export' button at the top right to render and download your high-definition MP4 video, or click 'Take full control' to fine-tune your cuts in the multi-track editor.",
      };
    }
    if (asksHelp) {
      return {
        profile: base,
        changed: false,
        reply: "I can re-cut and style your video instantly! Try asking me: “don't cut anything / keep full video”, “add captions”, “move captions to center”, “16:9 widescreen”, “faster pacing”, “no punch-ins”, or “make it cinematic”.",
      };
    }

    return {
      profile: base,
      changed: false,
      reply: "I can adjust your edit. Try saying: “don't cut anything / keep full video”, “add captions”, “make it 16:9 widescreen”, “no punch-ins”, “faster pacing”, or “warmer grade”.",
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
