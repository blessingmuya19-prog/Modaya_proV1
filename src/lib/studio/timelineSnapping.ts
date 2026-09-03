/**
 * Multi-Track Timeline Magnetism, Snapping & Collision Physics Engine.
 *
 * Provides multi-track magnetic snapping across clip boundaries, playheads,
 * beat ticks, markers, collision detection, and automated ripple gap closure.
 *
 * Fully deterministic, zero-dependency.
 */

export type SnapTargetType = 'clip_edge' | 'playhead' | 'beat_tick' | 'marker';

export interface SnapTarget {
  time: number;
  type: SnapTargetType;
  label?: string;
  trackId?: string;
  clipId?: string;
}

export interface SnapResult {
  originalTime: number;
  snappedTime: number;
  isSnapped: boolean;
  snappedTarget?: SnapTarget;
  snapDelta: number;
}

export interface TimelineClipItem {
  id: string;
  trackId: string;
  startS: number;
  endS: number;
  label?: string;
}

export interface CollisionResolution {
  adjustedClips: TimelineClipItem[];
  hasCollisions: boolean;
  totalShiftS: number;
}

/**
 * Gather all potential magnetic snap target points from timeline clips, playhead, and beats.
 */
export function collectSnapTargets(
  clips: TimelineClipItem[] = [],
  playheadS?: number,
  beatTicks: number[] = [],
  markers: { time: number; label?: string }[] = [],
  excludeClipId?: string
): SnapTarget[] {
  const targets: SnapTarget[] = [];

  // Clip in/out points
  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    targets.push({
      time: clip.startS,
      type: 'clip_edge',
      label: `${clip.label || 'Clip'} Start`,
      trackId: clip.trackId,
      clipId: clip.id,
    });
    targets.push({
      time: clip.endS,
      type: 'clip_edge',
      label: `${clip.label || 'Clip'} End`,
      trackId: clip.trackId,
      clipId: clip.id,
    });
  }

  // Playhead
  if (playheadS !== undefined && playheadS >= 0) {
    targets.push({
      time: playheadS,
      type: 'playhead',
      label: 'Playhead',
    });
  }

  // Beat ticks
  for (const b of beatTicks) {
    targets.push({
      time: b,
      type: 'beat_tick',
      label: 'Musical Beat',
    });
  }

  // Timeline markers
  for (const m of markers) {
    targets.push({
      time: m.time,
      type: 'marker',
      label: m.label || 'Marker',
    });
  }

  return targets;
}

/**
 * Calculate magnetic snap for a dragged point against all active snap targets.
 */
export function calculateSnapPoint(
  draggedTime: number,
  targets: SnapTarget[],
  snapDistanceS = 0.12
): SnapResult {
  if (!targets.length) {
    return { originalTime: draggedTime, snappedTime: draggedTime, isSnapped: false, snapDelta: 0 };
  }

  let closest: SnapTarget | undefined;
  let minDiff = Infinity;

  for (const target of targets) {
    const diff = Math.abs(target.time - draggedTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = target;
    }
  }

  if (closest && minDiff <= snapDistanceS) {
    return {
      originalTime: draggedTime,
      snappedTime: closest.time,
      isSnapped: true,
      snappedTarget: closest,
      snapDelta: closest.time - draggedTime,
    };
  }

  return {
    originalTime: draggedTime,
    snappedTime: draggedTime,
    isSnapped: false,
    snapDelta: 0,
  };
}

/**
 * Ripple collision resolution: when a clip is inserted or expanded,
 * smoothly pushes subsequent clips to prevent destructive overlaps.
 */
export function resolveRippleCollisions(
  clips: TimelineClipItem[],
  activeClipId: string,
  newStartS: number,
  newEndS: number
): CollisionResolution {
  const activeClip = clips.find(c => c.id === activeClipId);
  if (!activeClip) {
    return { adjustedClips: clips, hasCollisions: false, totalShiftS: 0 };
  }

  const trackClips = clips
    .filter(c => c.trackId === activeClip.trackId && c.id !== activeClipId)
    .sort((a, b) => a.startS - b.startS);

  const duration = Math.max(0.1, newEndS - newStartS);
  let cursor = newStartS + duration;
  let hasCollisions = false;
  let totalShiftS = 0;

  const adjustedTrackClips: TimelineClipItem[] = [];

  for (const clip of trackClips) {
    if (clip.startS < newStartS) {
      // Left of active clip
      adjustedTrackClips.push(clip);
    } else {
      // Right of active clip - check if collision
      if (clip.startS < cursor) {
        hasCollisions = true;
        const shift = cursor - clip.startS;
        totalShiftS += shift;
        const clipDur = clip.endS - clip.startS;
        adjustedTrackClips.push({
          ...clip,
          startS: parseFloat(cursor.toFixed(3)),
          endS: parseFloat((cursor + clipDur).toFixed(3)),
        });
        cursor += clipDur;
      } else {
        adjustedTrackClips.push(clip);
        cursor = clip.endS;
      }
    }
  }

  const resultClips = clips.map(c => {
    if (c.id === activeClipId) {
      return { ...c, startS: newStartS, endS: newEndS };
    }
    const found = adjustedTrackClips.find(tc => tc.id === c.id);
    return found || c;
  });

  return {
    adjustedClips: resultClips,
    hasCollisions,
    totalShiftS: parseFloat(totalShiftS.toFixed(3)),
  };
}

/**
 * Automatically close unwanted gaps between adjacent clips on the same track.
 */
export function closeTimelineGaps(
  clips: TimelineClipItem[],
  targetTrackId: string,
  minGapS = 0.05
): TimelineClipItem[] {
  const trackClips = clips
    .filter(c => c.trackId === targetTrackId)
    .sort((a, b) => a.startS - b.startS);

  if (trackClips.length <= 1) return clips;

  const updatedTrackClips: TimelineClipItem[] = [];
  let curEnd = trackClips[0].endS;
  updatedTrackClips.push(trackClips[0]);

  for (let i = 1; i < trackClips.length; i++) {
    const clip = trackClips[i];
    const gap = clip.startS - curEnd;
    const dur = clip.endS - clip.startS;

    if (gap > 0 && gap <= 2.0) {
      // Close gap
      const newStart = curEnd;
      const newEnd = curEnd + dur;
      updatedTrackClips.push({
        ...clip,
        startS: parseFloat(newStart.toFixed(3)),
        endS: parseFloat(newEnd.toFixed(3)),
      });
      curEnd = newEnd;
    } else {
      updatedTrackClips.push(clip);
      curEnd = clip.endS;
    }
  }

  return clips.map(c => {
    if (c.trackId !== targetTrackId) return c;
    const found = updatedTrackClips.find(tc => tc.id === c.id);
    return found || c;
  });
}
