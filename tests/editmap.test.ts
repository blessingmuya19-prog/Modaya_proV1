import { describe, it, expect } from 'vitest';
import { buildEditMap, explainMarker, markerIcon, fmtTime, referenceMoment, type RefMapCtx } from '../src/lib/studio/editMap';
import type { StudioPlan, PlannedShot } from '../src/lib/studio/editPlan';
import { shortLabel } from '../src/lib/studio/versions';

function shot(over: Partial<PlannedShot> & { startS: number; endS: number; sourceIn: number }): PlannedShot {
  return {
    id: `s-${Math.random()}`, trackId: 'video', label: 'shot', type: 'video',
    transform: { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, rotation: 0 } as never,
    effects: {} as never,
    ...over,
  };
}

function plan(over: Partial<StudioPlan> = {}): StudioPlan {
  return {
    clips: [], durationS: 30, removedS: 10, cutCount: 2, summary: '',
    profileName: 'ref', frame: { width: 1080, height: 1920, ratio: '9:16' },
    captions: 0, broll: 0, hookFirst: true,
    ...over,
  } as StudioPlan;
}

describe('buildEditMap', () => {
  it('marks the first base shot as the hook', () => {
    const p = plan({ clips: [shot({ startS: 0, endS: 5, sourceIn: 20 })] });
    const map = buildEditMap(p);
    expect(map[0].type).toBe('hook');
    expect(map[0].t).toBe(0);
  });

  it('marks each later shot boundary as a cut', () => {
    const p = plan({
      clips: [
        shot({ startS: 0, endS: 4, sourceIn: 20 }),
        shot({ startS: 4, endS: 9, sourceIn: 30 }),   // 6s gap removed (24→30)
      ],
    });
    const cuts = buildEditMap(p).filter(m => m.type === 'cut');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].t).toBe(4);
    // removed gap = 30 - (20+4) = 6s
    expect(cuts[0].durS).toBeCloseTo(6, 1);
  });

  it('flags scaled shots as zooms', () => {
    const p = plan({
      clips: [
        shot({ startS: 0, endS: 4, sourceIn: 0, transform: { scale: 1 } as never }),
        shot({ startS: 4, endS: 8, sourceIn: 20, transform: { scale: 1.12 } as never }),
      ],
    });
    const zooms = buildEditMap(p).filter(m => m.type === 'zoom');
    expect(zooms).toHaveLength(1);
    expect(zooms[0].t).toBe(4);
  });

  it('marks overlay shots as b-roll', () => {
    const p = plan({
      clips: [
        shot({ startS: 0, endS: 10, sourceIn: 0 }),
        shot({ trackId: 'overlay', startS: 3, endS: 5, sourceIn: 40, label: 'B-roll' }),
      ],
      broll: 1,
    });
    const br = buildEditMap(p).filter(m => m.type === 'broll');
    expect(br).toHaveLength(1);
    expect(br[0].durS).toBeCloseTo(2, 1);
  });

  it('collapses captions into a single spanning band', () => {
    const p = plan({
      clips: [
        shot({ startS: 0, endS: 10, sourceIn: 0 }),
        { id: 'c1', trackId: 'subs', label: 'c', type: 'text', startS: 0.5, endS: 2, sourceIn: 0, transform: {} as never, effects: {} as never },
        { id: 'c2', trackId: 'subs', label: 'c', type: 'text', startS: 2, endS: 3.5, sourceIn: 0, transform: {} as never, effects: {} as never },
      ],
      captions: 2,
    });
    const cap = buildEditMap(p).filter(m => m.type === 'caption');
    expect(cap).toHaveLength(1);
    expect(cap[0].t).toBeCloseTo(0.5, 1);
    expect(cap[0].durS).toBeCloseTo(3.0, 1);
  });

  it('returns markers in time order', () => {
    const p = plan({
      clips: [
        shot({ startS: 0, endS: 4, sourceIn: 0 }),
        shot({ trackId: 'overlay', startS: 2, endS: 3.5, sourceIn: 50 }),
        shot({ startS: 4, endS: 9, sourceIn: 20, transform: { scale: 1.1 } as never }),
      ],
    });
    const ts = buildEditMap(p).map(m => m.t);
    const sorted = [...ts].sort((a, b) => a - b);
    expect(ts).toEqual(sorted);
  });
});

describe('explainMarker', () => {
  it('says how much dead air a cut removed', () => {
    const text = explainMarker({ id: 'x', type: 'cut', t: 4, durS: 6, label: 'Cut' }, { hasRef: true, cutsPerMin: 28 });
    expect(text).toContain('6.0s');
    expect(text).toContain('28');
  });

  it('grounds zoom in the reference punch-in rate when there is one', () => {
    const text = explainMarker({ id: 'x', type: 'zoom', t: 4, label: 'Zoom' }, { hasRef: true, punchInRate: 0.35 });
    expect(text).toContain('35%');
  });

  it('mentions spoken words for captions', () => {
    expect(explainMarker({ id: 'x', type: 'caption', t: 0, label: 'Captions' }, { hasRef: false }))
      .toContain('spoken');
  });

  it('explains b-roll keeps the talk track', () => {
    expect(explainMarker({ id: 'x', type: 'broll', t: 3, label: 'B-roll' }, { hasRef: false }))
      .toContain('audio keeps playing');
  });
});

describe('reference correspondence', () => {
  const ctx: RefMapCtx = {
    hasRef: true, refCuts: [10, 20, 30, 40], refDurationS: 45,
    editDurationS: 30, editCutCount: 3,
  };

  it('returns null without a reference', () => {
    expect(referenceMoment({ id: 'x', type: 'cut', t: 4, seq: 0, label: 'Cut' }, { ...ctx, hasRef: false })).toBeNull();
  });

  it('maps the hook to the reference start', () => {
    expect(referenceMoment({ id: 'h', type: 'hook', t: 0, seq: 0, label: 'Hook' }, ctx)?.t).toBe(0);
  });

  it('aligns cuts by relative ordinal through the reference cut sequence', () => {
    // 3 edit cuts across 4 ref cuts: cut #0 -> ref cut index round(0*4/3)=0 → 10
    const m0 = referenceMoment({ id: 'c0', type: 'cut', t: 5, seq: 0, label: 'Cut' }, ctx);
    const m2 = referenceMoment({ id: 'c2', type: 'cut', t: 25, seq: 2, label: 'Cut' }, ctx);
    expect(m0?.t).toBe(10);
    expect(m2?.t).toBe(40);   // round(2*4/3)=round(2.67)=3 → refCuts[3]=40
  });

  it('snaps zooms to the nearest real reference cut', () => {
    // t=21 of 30 → frac .7 → ref at 31.5 → nearest cut 30
    const m = referenceMoment({ id: 'z', type: 'zoom', t: 21, seq: 0, label: 'Zoom' }, ctx);
    expect(m?.t).toBe(30);
  });

  it('gives b-roll no fabricated reference moment', () => {
    expect(referenceMoment({ id: 'b', type: 'broll', t: 8, seq: 0, label: 'B-roll' }, ctx)).toBeNull();
  });

  it('falls back to progress alignment when the reference has no detected cuts', () => {
    const noCuts = { ...ctx, refCuts: [] };
    const m = referenceMoment({ id: 'c', type: 'cut', t: 15, seq: 0, label: 'Cut' }, noCuts);
    expect(m?.t).toBeCloseTo(22.5, 1); // 15/30 * 45
  });
});

describe('helpers', () => {
  it('has an icon for every marker type', () => {
    for (const t of ['hook', 'cut', 'zoom', 'caption', 'broll'] as const) {
      expect(markerIcon(t)).toBeTruthy();
    }
  });
  it('formats time as m:ss', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(74)).toBe('1:14');
  });
  it('shortens long instruction labels', () => {
    expect(shortLabel('make it more cinematic and faster')).toMatch(/^[A-Z]/);
    expect(shortLabel('short').length).toBeLessThanOrEqual(26);
  });
});
