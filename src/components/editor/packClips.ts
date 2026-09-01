/**
 * Deciding what the timeline actually needs to put in the DOM.
 *
 * Captioning a 13-minute video line by line produces several hundred clips.
 * Rendering each one as its own node — with a border, a label and a resize
 * handle — is what made the editor crawl: the nodes exist whether or not you
 * can see them, and at a zoom where the whole programme fits on screen each
 * caption is about two pixels wide.
 *
 * Two rules, both purely geometric:
 *   1. Skip anything outside the visible window (plus a screen of slack).
 *   2. Collapse runs of clips too narrow to see into a single block. At that
 *      size the gaps between them are sub-pixel too, so the run already looks
 *      like one solid bar — it just costs hundreds of times more to draw.
 *
 * Zooming in makes the clips wider than the threshold and they come back as
 * individual clips, so nothing is lost, only deferred.
 */

export type TimelineClip = { s: number; e: number; label: string };

export type PackedClip = {
  /** Stable across re-renders: the clip's index in the unsorted input. */
  key:    string;
  left:   number;   // px
  w:      number;   // px
  label:  string;   // empty for a merged run — a 2px block can't show text
  /** How many source clips this block stands for. 1 = a real, addressable clip. */
  merged: number;
  s:      number;   // seconds, for hit-testing
  e:      number;
};

export type PackOptions = {
  /** How far outside the window to keep building, in px. */
  padPx?: number;
  /** Below this width a clip is not worth its own node. */
  minPx?: number;
};

export function packClips(
  clips: TimelineClip[],
  zoom: number,
  view: { left: number; width: number },
  opts: PackOptions = {},
): PackedClip[] {
  const { padPx = 1200, minPx = 4 } = opts;
  if (!clips.length || !(zoom > 0)) return [];

  const from = view.left - padPx;
  const to   = view.left + view.width + padPx;

  const order = clips.map((c, i) => ({ c, i })).sort((a, b) => a.c.s - b.c.s);
  const out: PackedClip[] = [];

  let k = 0;
  while (k < order.length) {
    const { c, i } = order[k];
    const left  = c.s * zoom;
    let   right = c.e * zoom;

    if (right < from) { k++; continue; }   // behind the window
    if (left > to) break;                  // past it — the rest are further right

    // Wide enough to see: keep it as itself.
    if (right - left >= minPx) {
      out.push({ key: `c${i}`, left, w: right - left, label: c.label, merged: 1, s: c.s, e: c.e });
      k++;
      continue;
    }

    // A sliver — swallow the run of slivers that touches it.
    let n = 1, j = k + 1;
    while (j < order.length) {
      const nx = order[j].c;
      const nl = nx.s * zoom, nr = nx.e * zoom;
      if (nl - right > minPx)   break;     // a gap you could actually see
      if (nr - nl   >= minPx)   break;     // a clip you could actually see
      if (nl > to)              break;     // ran off the window
      right = Math.max(right, nr);
      n++; j++;
    }

    out.push({
      key: `c${i}`, left, w: Math.max(1, right - left),
      label: n > 1 ? '' : c.label, merged: n,
      s: c.s, e: right / zoom,
    });
    k = j;
  }

  return out;
}
