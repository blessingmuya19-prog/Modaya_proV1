/**
 * Timeline gestures, CapCut's desktop behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
  clampZoom, anchoredScrollLeft, zoomFactor, snapTime, snapEdges, stepTime,
  keyIsForEditor, MIN_ZOOM, MAX_ZOOM, FRAME_S,
} from '@/components/editor/timelineGestures';

describe('zooming', () => {
  it('stays within the usable range', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(9999)).toBe(MAX_ZOOM);
    expect(clampZoom(12)).toBe(12);
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
  });

  it('zooms in when the wheel is pushed away, out when pulled back', () => {
    expect(zoomFactor(-100)).toBeGreaterThan(1);
    expect(zoomFactor(100)).toBeLessThan(1);
    expect(zoomFactor(0)).toBe(1);
  });

  it('does not leap on one violent trackpad flick', () => {
    expect(zoomFactor(-4000)).toBeLessThan(1.4);
  });

  it('keeps the moment under the pointer under the pointer', () => {
    // 60s in view at 10 px/s, pointer 400px in, so the pointer is on t=60
    const zoom = 10, scrollLeft = 200, pointerX = 400;
    const under = (scrollLeft + pointerX) / zoom;
    const next = 25;
    const left = anchoredScrollLeft({ zoom, next, pointerX, scrollLeft });
    expect((left + pointerX) / next).toBeCloseTo(under, 6);
  });

  it('never scrolls to a negative position when zooming out at the start', () => {
    const left = anchoredScrollLeft({ zoom: 40, next: 1, pointerX: 50, scrollLeft: 0 });
    expect(left).toBe(0);
  });
});

describe('snapping', () => {
  const tracks = [
    { clips: [{ s: 0, e: 12 }, { s: 20, e: 33.5 }] },
    { clips: [{ s: 5.25, e: 9 }] },
  ];

  it('collects the ends and every cut, once each, in order', () => {
    expect(snapEdges(tracks, 40)).toEqual([0, 5.25, 9, 12, 20, 33.5, 40]);
  });

  it('pulls the playhead onto a cut it is nearly on', () => {
    // 10 px/s: 12.3s is 3px from the cut at 12s
    expect(snapTime(12.3, [0, 12, 20], 10)).toBe(12);
  });

  it('leaves the playhead alone when no cut is close', () => {
    expect(snapTime(15.7, [0, 12, 20], 10)).toBe(15.7);
  });

  it('judges closeness in pixels, so it feels the same at any zoom', () => {
    // 0.5s away: a mile at 100 px/s, nothing at 2 px/s
    expect(snapTime(12.5, [12], 100)).toBe(12.5);
    expect(snapTime(12.5, [12], 2)).toBe(12);
  });

  it('takes the nearest cut when two are in reach', () => {
    expect(snapTime(12.4, [12, 12.5], 20)).toBe(12.5);
  });

  it('can be turned off by asking for no tolerance', () => {
    expect(snapTime(12.05, [12], 10, 0)).toBe(12.05);
  });
});

describe('arrow keys', () => {
  it('steps one frame at a time', () => {
    expect(stepTime(1, 1, { totalS: 10 })).toBeCloseTo(1 + FRAME_S, 4);
    expect(stepTime(1, -1, { totalS: 10 })).toBeCloseTo(1 - FRAME_S, 4);
  });

  it('steps a whole second when asked for a coarse move', () => {
    expect(stepTime(1, 1, { totalS: 10, coarse: true })).toBe(2);
  });

  it('stops at both ends rather than running off', () => {
    expect(stepTime(0, -1, { totalS: 10 })).toBe(0);
    expect(stepTime(10, 1, { totalS: 10 })).toBe(10);
  });
});

describe('keyboard focus', () => {
  const el = (tag: string, editable = false) => {
    const n = document.createElement(tag);
    if (editable) n.setAttribute('contenteditable', 'true');
    return n;
  };

  it('drives the editor from the page body', () => {
    expect(keyIsForEditor(document.body)).toBe(true);
    expect(keyIsForEditor(el('div'))).toBe(true);
    expect(keyIsForEditor(el('button'))).toBe(true);
  });

  it('keeps its hands off while someone is typing', () => {
    expect(keyIsForEditor(el('input'))).toBe(false);
    expect(keyIsForEditor(el('textarea'))).toBe(false);
    expect(keyIsForEditor(el('select'))).toBe(false);
  });

  it('leaves a rich text box alone too', () => {
    const box = el('div', true);
    Object.defineProperty(box, 'isContentEditable', { value: true });
    expect(keyIsForEditor(box)).toBe(false);
  });
});
