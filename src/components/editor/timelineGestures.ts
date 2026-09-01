/**
 * Timeline gesture arithmetic, kept away from the DOM so it can be tested.
 *
 * The behaviours are CapCut's, desktop flavour: the playhead travels and the
 * view follows it, the wheel scrolls sideways, ctrl or ⌘ with the wheel zooms
 * around the pointer rather than the left edge, the playhead sticks to cut
 * points as it passes them, and the keyboard drives transport.
 */

export const MIN_ZOOM = 0.5;    // px per second
export const MAX_ZOOM = 240;

/** A frame at 30fps. Arrow keys step by this; nothing here knows the real
 *  frame rate of the file, and claiming otherwise would be a guess. */
export const FRAME_S = 1 / 30;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/**
 * Zooming should keep whatever is under the pointer under the pointer —
 * anchoring to the left edge instead makes the timeline lurch away from what
 * you were looking at.
 *
 * @param pointerX offset of the cursor from the left edge of the visible area
 * @returns the scrollLeft to apply once the new zoom has been laid out
 */
export function anchoredScrollLeft(a: {
  zoom: number; next: number; pointerX: number; scrollLeft: number;
}): number {
  const { zoom, next, pointerX, scrollLeft } = a;
  if (!(zoom > 0) || !(next > 0)) return scrollLeft;
  const timeUnderPointer = (scrollLeft + pointerX) / zoom;
  return Math.max(0, timeUnderPointer * next - pointerX);
}

/** Wheel notches to a zoom factor. Smooth enough for a trackpad, quick
 *  enough for a mouse's chunky steps. */
export function zoomFactor(deltaY: number): number {
  return Math.exp(-Math.max(-120, Math.min(120, deltaY)) * 0.0025);
}

/**
 * Pull the playhead onto a nearby cut. Distance is judged in pixels, not
 * seconds, so snapping feels the same however far in you are zoomed.
 */
export function snapTime(
  t: number, edges: readonly number[], zoom: number, snapPx = 8,
): number {
  let best = t, bestPx = snapPx;
  for (const e of edges) {
    const px = Math.abs(e - t) * zoom;
    if (px < bestPx) { bestPx = px; best = e; }
  }
  return best;
}

/** Every point the playhead should stick to: the ends, and every cut. */
export function snapEdges(
  tracks: readonly { clips: readonly { s: number; e: number }[] }[],
  totalS: number,
): number[] {
  const set = new Set<number>([0]);
  if (totalS > 0) set.add(totalS);
  for (const tr of tracks) for (const c of tr.clips) { set.add(c.s); set.add(c.e); }
  return [...set].sort((a, b) => a - b);
}

/** One arrow-key nudge. Shift makes it a second instead of a frame. */
export function stepTime(
  t: number, dir: -1 | 1, opts: { totalS: number; coarse?: boolean },
): number {
  const d = (opts.coarse ? 1 : FRAME_S) * dir;
  return Math.max(0, Math.min(opts.totalS, Number((t + d).toFixed(4))));
}

/**
 * Should a keystroke drive the editor, or is the person typing?
 * Getting this wrong means space bar stops playback mid-sentence in the chat.
 */
export function keyIsForEditor(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  if (el.isContentEditable) return false;
  return true;
}
