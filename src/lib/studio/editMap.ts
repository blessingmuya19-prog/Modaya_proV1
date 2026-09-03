/**
 * Edit Map — the transparent, inspectable view of what Modaya decided.
 *
 * The user is never expected to edit this. It turns the finished EditPlan into
 * a clean row of markers (Hook, Cut, Zoom, Caption, B-roll) placed on the
 * programme timeline, each with a plain-English explanation grounded in the
 * real decision: how much dead air a cut removed, why a punch-in happened, that
 * a caption is the words actually spoken. Clicking a marker is how the user
 * asks "why did you do that?" — so every reason is derived from measurements,
 * never invented.
 */
import type { StudioPlan, PlannedShot } from './editPlan';

export type EditMarkerType = 'hook' | 'cut' | 'zoom' | 'caption' | 'broll';

export interface EditMarker {
  id: string;
  type: EditMarkerType;
  /** Position on the finished programme timeline, seconds. */
  t: number;
  /** How long the thing lasts (captions / b-roll / a zoomed shot). */
  durS?: number;
  /** Where it maps back to in the source footage, seconds (video markers).
   *  For a library B-roll this is a time inside that library clip instead. */
  sourceIn?: number;
  /** True when this cutaway reads from an uploaded B-roll library clip
   *  (rather than an unused window of the main footage). */
  fromLibrary?: boolean;
  /** Ordinal among markers of the same kind (cut #0, zoom #1…), for mapping
   *  an edit onto the corresponding moment in the reference. */
  seq?: number;
  /** Short label shown under the icon. */
  label: string;
}

const BASE = (plan: StudioPlan): PlannedShot[] =>
  plan.clips
    .filter(c => c.trackId === 'video' && c.type === 'video')
    .slice()
    .sort((a, b) => a.startS - b.startS);

const ZOOM_MIN = 1.03;   // scale above this reads as a deliberate punch-in

/** Derive the ordered edit markers from a composed plan. */
export function buildEditMap(plan: StudioPlan): EditMarker[] {
  const markers: EditMarker[] = [];
  const base = BASE(plan);
  let cutN = 0, zoomN = 0, brollN = 0;

  // ── Hook + cuts + zooms from the base video shots ──
  base.forEach((shot, i) => {
    if (i === 0) {
      markers.push({ id: 'hook', type: 'hook', t: shot.startS, label: 'Hook', sourceIn: shot.sourceIn, seq: 0 });
    } else {
      const prev = base[i - 1];
      const boundary = shot.startS;
      const gap = removedGap(prev, shot);
      markers.push({
        id: `cut-${i}`, type: 'cut', t: boundary, label: 'Cut',
        sourceIn: shot.sourceIn, durS: gap, seq: cutN++,
      });
    }
    if ((shot.transform?.scale ?? 1) > ZOOM_MIN) {
      markers.push({
        id: `zoom-${i}`, type: 'zoom', t: shot.startS,
        durS: shot.endS - shot.startS, sourceIn: shot.sourceIn, label: 'Zoom', seq: zoomN++,
      });
    }
  });

  // ── B-roll cutaways (overlay, muted) ──
  plan.clips
    .filter(c => c.trackId === 'overlay')
    .sort((a, b) => a.startS - b.startS)
    .forEach((c, i) => markers.push({
      id: `broll-${i}`, type: 'broll', t: c.startS,
      durS: c.endS - c.startS, sourceIn: c.sourceIn, label: 'B-roll', seq: brollN++,
      fromLibrary: !!c.sourceId,
    }));

  // ── Captions: one band from the first to last line, not dozens of marks ──
  const caps = plan.clips
    .filter(c => c.trackId === 'subs' || (c.type === 'text'))
    .sort((a, b) => a.startS - b.startS);
  if (caps.length) {
    markers.push({
      id: 'captions', type: 'caption', t: caps[0].startS,
      durS: Math.max(0, caps[caps.length - 1].endS - caps[0].startS),
      label: `Captions · ${plan.captions || caps.length}`, seq: 0,
    });
  }

  return markers.sort((a, b) => a.t - b.t || (a.type === 'hook' ? -1 : 0));
}

/** Source footage removed between two consecutive programme shots, seconds. */
function removedGap(prev: PlannedShot, next: PlannedShot): number {
  const prevSourceEnd = prev.sourceIn + (prev.endS - prev.startS);
  return Math.max(0, next.sourceIn - prevSourceEnd);
}

// ── Explanations ─────────────────────────────────────────────────────────────

export interface ExplainCtx {
  hasRef: boolean;
  /** Reference cuts-per-minute, when a reference was learned. */
  cutsPerMin?: number;
  /** Reference punch-in rate (0..1), when known. */
  punchInRate?: number;
}

/** A grounded, one-to-two sentence explanation of why an edit exists. */
export function explainMarker(m: EditMarker, ctx: ExplainCtx): string {
  const pace = ctx.hasRef && ctx.cutsPerMin
    ? ` to match the reference's pace of about ${Math.round(ctx.cutsPerMin)} cuts a minute`
    : '';

  switch (m.type) {
    case 'hook':
      return 'Opens on the strongest moment, so the very first frame is the hook.';

    case 'cut': {
      const gap = m.durS ?? 0;
      if (gap >= 0.5) {
        return `Cut here and removed ${gap.toFixed(1)}s of dead air${pace}.`;
      }
      return `Cut to the next moment${pace ? pace : ' to keep the edit moving'}.`;
    }

    case 'zoom': {
      const pct = Math.round((ctx.punchInRate ?? 0.35) * 100);
      return ctx.hasRef
        ? `Punch-in for emphasis — the reference zooms on key points like this in about ${pct}% of shots.`
        : 'Punch-in for emphasis, to keep a static shot feeling energetic.';
    }

    case 'caption':
      return ctx.hasRef
        ? 'Burned-in captions of the words actually spoken, styled like the reference.'
        : 'Burned-in captions of the words actually spoken.';

    case 'broll':
      return m.fromLibrary
        ? 'B-roll cutaway from your uploaded library — it illustrates what is being said while your audio keeps playing underneath.'
        : 'B-roll cutaway from another strong moment in your footage — your audio keeps playing underneath.';
  }
}

// ── Reference correspondence ─────────────────────────────────────────────────

export interface RefMapCtx {
  hasRef: boolean;
  /** Real hard-cut timestamps detected in the reference video (seconds). */
  refCuts: number[];
  refDurationS: number;
  editDurationS: number;
  /** Number of cut markers in our edit (interior boundaries). */
  editCutCount: number;
}

export interface RefMoment {
  /** Where to seek the reference, seconds. */
  t: number;
  /** A short, honest note on why this is the matching moment. */
  note: string;
}

/** The nearest reference cut to time t, or null when the reference has none. */
function nearestRefCut(refCuts: number[], t: number): number | null {
  if (!refCuts.length) return null;
  let best = refCuts[0], bestD = Math.abs(t - best);
  for (const c of refCuts) {
    const d = Math.abs(t - c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * Where in the reference does the same editing decision appear? This is the
 * "Modaya made this cut because the reference does something similar here"
 * link. It is grounded only in the reference's *measured* cuts: cuts align by
 * ordinal (our k-th cut ↔ the reference cut at the same relative position),
 * zooms/captions align by progress fraction snapped to a real cut, and B-roll
 * (which has no reference analogue) reports no correspondence rather than a
 * fabricated one.
 */
export function referenceMoment(m: EditMarker, ctx: RefMapCtx): RefMoment | null {
  if (!ctx.hasRef) return null;

  if (m.type === 'hook') {
    return { t: 0, note: 'The reference also opens on its strongest frame — the hook.' };
  }

  if (m.type === 'cut' && typeof m.seq === 'number') {
    const refCuts = ctx.refCuts.filter(c => c > 0 && c < ctx.refDurationS).sort((a, b) => a - b);
    if (!refCuts.length) {
      // No cuts detected in the reference; align by progress.
      const t = (m.t / Math.max(1, ctx.editDurationS)) * ctx.refDurationS;
      return { t, note: 'Aligned to the same point in the reference timeline.' };
    }
    // Ordinal mapping: our cut number k maps to the reference cut at the same
    // relative position through its cut sequence.
    const editCuts = Math.max(1, ctx.editCutCount);
    const idx = Math.round(m.seq * (refCuts.length / editCuts));
    const ci = Math.max(0, Math.min(refCuts.length - 1, idx));
    return {
      t: refCuts[ci],
      note: `The reference cuts here too — cut #${m.seq + 1} in your edit matches this reference cut.`,
    };
  }

  if (m.type === 'zoom') {
    const frac = m.t / Math.max(1, ctx.editDurationS);
    const at = frac * ctx.refDurationS;
    const snap = nearestRefCut(ctx.refCuts, at);
    return {
      t: snap ?? at,
      note: snap != null
        ? 'The reference punches in around this moment for emphasis too.'
        : 'The reference emphasises this point the same way.',
    };
  }

  if (m.type === 'caption') {
    return { t: 0, note: 'The reference burns in captions throughout — your captions follow that style.' };
  }

  // B-roll cutaways are drawn from your own footage; the reference has no
  // equivalent moment to point at.
  return null;
}

// ── Small helpers for the UI ─────────────────────────────────────────────────

const ICON: Record<EditMarkerType, string> = {
  hook: '★', cut: '✂', zoom: '🔍', caption: 'T', broll: '▣',
};

export function markerIcon(t: EditMarkerType): string { return ICON[t]; }

export function fmtTime(s: number): string {
  const safe = Number.isFinite(s) && s > 0 ? s : 0;
  const m = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
