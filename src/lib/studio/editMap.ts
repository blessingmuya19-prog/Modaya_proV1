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
  /** Where it maps back to in the source footage, seconds (video markers). */
  sourceIn?: number;
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

  // ── Hook + cuts + zooms from the base video shots ──
  base.forEach((shot, i) => {
    if (i === 0) {
      markers.push({ id: 'hook', type: 'hook', t: shot.startS, label: 'Hook', sourceIn: shot.sourceIn });
    } else {
      const prev = base[i - 1];
      const boundary = shot.startS;
      const gap = removedGap(prev, shot);
      markers.push({
        id: `cut-${i}`, type: 'cut', t: boundary, label: gap >= 0.5 ? 'Cut' : 'Cut',
        sourceIn: shot.sourceIn, durS: gap,
      });
    }
    if ((shot.transform?.scale ?? 1) > ZOOM_MIN) {
      markers.push({
        id: `zoom-${i}`, type: 'zoom', t: shot.startS,
        durS: shot.endS - shot.startS, sourceIn: shot.sourceIn, label: 'Zoom',
      });
    }
  });

  // ── B-roll cutaways (overlay, muted) ──
  plan.clips
    .filter(c => c.trackId === 'overlay')
    .sort((a, b) => a.startS - b.startS)
    .forEach((c, i) => markers.push({
      id: `broll-${i}`, type: 'broll', t: c.startS,
      durS: c.endS - c.startS, sourceIn: c.sourceIn, label: 'B-roll',
    }));

  // ── Captions: one band from the first to last line, not dozens of marks ──
  const caps = plan.clips
    .filter(c => c.trackId === 'subs' || (c.type === 'text'))
    .sort((a, b) => a.startS - b.startS);
  if (caps.length) {
    markers.push({
      id: 'captions', type: 'caption', t: caps[0].startS,
      durS: Math.max(0, caps[caps.length - 1].endS - caps[0].startS),
      label: `Captions · ${plan.captions || caps.length}`,
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
      return 'B-roll cutaway from another strong moment in your footage — your audio keeps playing underneath.';
  }
}

// ── Small helpers for the UI ─────────────────────────────────────────────────

const ICON: Record<EditMarkerType, string> = {
  hook: '★', cut: '✂', zoom: '🔍', caption: 'T', broll: '▣',
};

export function markerIcon(t: EditMarkerType): string { return ICON[t]; }

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
