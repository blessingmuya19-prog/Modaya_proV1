/**
 * Jump Cut Smoothing & Optical Flow Morph Frame Synthesis Engine.
 *
 * Automatically detects jump cuts resulting from silence / filler word
 * removal and synthesizes smooth morph transitions across cut boundaries
 * using optical flow motion vector interpolation.
 *
 * Pure, deterministic, and fully testable without browser DOM dependencies.
 */

export interface JumpCut {
  id: string;
  cutTimelineS: number;
  outgoingClipId: string;
  incomingClipId: string;
  sourceGapS: number;
  smoothable: boolean;
  reason: string;
}

export type MorphMode = 'optical_flow' | 'feature_morph' | 'seamless_dissolve';

export interface MorphCutConfig {
  enabled: boolean;
  blendDurationS: number; // e.g. 0.16s (roughly 4-5 frames)
  maxGapS: number;        // maximum silence gap to smooth (e.g. 2.5s)
  mode: MorphMode;
  headAlignment: boolean;
}

export const DEFAULT_MORPH_CUT_CONFIG: MorphCutConfig = {
  enabled: true,
  blendDurationS: 0.16,
  maxGapS: 2.50,
  mode: 'optical_flow',
  headAlignment: true,
};

export interface FlowVector {
  u: number; // Horizontal velocity (pixels)
  v: number; // Vertical velocity (pixels)
  confidence: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Identify all candidate jump cuts between consecutive video clips in a sequence.
 */
export function detectJumpCuts(
  clips: Array<{
    id: string;
    trackId?: string;
    kind?: string;
    type?: string;
    sourceId: string;
    sourceIn: number;
    timelineIn: number;
    timelineOut: number;
  }>,
  opts?: Partial<MorphCutConfig>,
): JumpCut[] {
  const cfg = { ...DEFAULT_MORPH_CUT_CONFIG, ...(opts ?? {}) };
  const videoClips = (clips ?? [])
    .filter(c => (c.kind === 'video' || c.type === 'video' || c.trackId === 'video'))
    .sort((a, b) => a.timelineIn - b.timelineIn);

  if (videoClips.length <= 1) return [];

  const jumpCuts: JumpCut[] = [];

  for (let i = 0; i < videoClips.length - 1; i++) {
    const cur = videoClips[i];
    const next = videoClips[i + 1];

    // Jump cuts occur at the boundary between two clips on the timeline
    const cutTimelineS = cur.timelineOut;
    const isAdjacentOnTimeline = Math.abs(next.timelineIn - cur.timelineOut) <= 0.05;

    if (!isAdjacentOnTimeline) continue;

    // Check if both clips originate from the same source footage
    const isSameSource = cur.sourceId === next.sourceId;
    if (!isSameSource) continue;

    const curSourceEnd = cur.sourceIn + (cur.timelineOut - cur.timelineIn);
    const nextSourceStart = next.sourceIn;
    const sourceGapS = Number((nextSourceStart - curSourceEnd).toFixed(3));

    // A jump cut has a forward jump in source time (e.g. deleted silence)
    const isForwardJump = sourceGapS > 0.05;
    const withinMaxGap = sourceGapS <= cfg.maxGapS;
    const curDuration = cur.timelineOut - cur.timelineIn;
    const nextDuration = next.timelineOut - next.timelineIn;
    const hasEnoughHandles = curDuration >= cfg.blendDurationS * 0.8 && nextDuration >= cfg.blendDurationS * 0.8;

    const smoothable = isForwardJump && withinMaxGap && hasEnoughHandles;
    const reason = !isForwardJump
      ? 'Continuous take (no jump cut)'
      : !withinMaxGap
      ? `Gap too large (${sourceGapS.toFixed(1)}s > ${cfg.maxGapS}s)`
      : !hasEnoughHandles
      ? 'Shot duration too short for smooth morph blend'
      : `Clean jump cut (${sourceGapS.toFixed(2)}s removed)`;

    jumpCuts.push({
      id: `jump-${cur.id}-${next.id}`,
      cutTimelineS: Number(cutTimelineS.toFixed(3)),
      outgoingClipId: cur.id,
      incomingClipId: next.id,
      sourceGapS,
      smoothable,
      reason,
    });
  }

  return jumpCuts;
}

/**
 * Calculate the transition progress (0..1) when the playhead is inside a jump cut morph window.
 * Returns null if outside the morph window.
 */
export function getMorphTransitionProgress(
  timelineS: number,
  jumpCuts: JumpCut[],
  blendDurationS = DEFAULT_MORPH_CUT_CONFIG.blendDurationS,
): { inTransition: boolean; progress: number; jumpCut: JumpCut | null } {
  const halfBlend = blendDurationS / 2;

  for (const jc of jumpCuts) {
    if (!jc.smoothable) continue;

    const winStart = jc.cutTimelineS - halfBlend;
    const winEnd = jc.cutTimelineS + halfBlend;

    if (timelineS >= winStart && timelineS <= winEnd) {
      const rawProgress = (timelineS - winStart) / Math.max(0.001, blendDurationS);
      // Smooth Hermite S-curve
      const eased = rawProgress * rawProgress * (3 - 2 * rawProgress);
      return {
        inTransition: true,
        progress: Number(clamp(eased, 0, 1).toFixed(4)),
        jumpCut: jc,
      };
    }
  }

  return { inTransition: false, progress: 0, jumpCut: null };
}

/**
 * Compute 2D Optical Flow Vector Field between outgoing Frame A and incoming Frame B.
 */
export function calculateOpticalFlowField(
  frameA: Uint8ClampedArray | ArrayLike<number>,
  frameB: Uint8ClampedArray | ArrayLike<number>,
  width: number,
  height: number,
  gridStep = 8,
): FlowVector[][] {
  const cols = Math.floor(width / gridStep);
  const rows = Math.floor(height / gridStep);
  const flow: FlowVector[][] = Array.from({ length: rows }, () => []);

  const searchRadius = 12;
  const halfBlock = Math.floor(gridStep / 2);

  for (let r = 0; r < rows; r++) {
    const cy = r * gridStep + halfBlock;

    for (let c = 0; c < cols; c++) {
      const cx = c * gridStep + halfBlock;

      let bestU = 0;
      let bestV = 0;
      let minSAD = Infinity;

      for (let dv = -searchRadius; dv <= searchRadius; dv += 2) {
        for (let du = -searchRadius; du <= searchRadius; du += 2) {
          let sad = 0;
          let samples = 0;

          for (let by = -halfBlock; by <= halfBlock; by += 2) {
            for (let bx = -halfBlock; bx <= halfBlock; bx += 2) {
              const ax = cx + bx;
              const ay = cy + by;
              const bxCoord = cx + bx + du;
              const byCoord = cy + by + dv;

              if (ax >= 0 && ax < width && ay >= 0 && ay < height &&
                  bxCoord >= 0 && bxCoord < width && byCoord >= 0 && byCoord < height) {
                const idxA = (ay * width + ax) * 4;
                const idxB = (byCoord * width + bxCoord) * 4;

                const lumaA = 0.299 * frameA[idxA] + 0.587 * frameA[idxA + 1] + 0.114 * frameA[idxA + 2];
                const lumaB = 0.299 * frameB[idxB] + 0.587 * frameB[idxB + 1] + 0.114 * frameB[idxB + 2];

                sad += Math.abs(lumaA - lumaB);
                samples++;
              }
            }
          }

          if (samples > 0 && sad < minSAD) {
            minSAD = sad;
            bestU = du;
            bestV = dv;
          }
        }
      }

      const conf = Math.max(0, 1 - (minSAD / (halfBlock * halfBlock * 64)));
      flow[r][c] = {
        u: bestU,
        v: bestV,
        confidence: Number(conf.toFixed(3)),
      };
    }
  }

  return flow;
}

/**
 * Synthesize an intermediate morphed video frame at transition progress `p` (0..1)
 * via bi-directional optical flow warping and cross-dissolve blending.
 */
export function synthesizeMorphFrame(
  frameA: Uint8ClampedArray | ArrayLike<number>,
  frameB: Uint8ClampedArray | ArrayLike<number>,
  width: number,
  height: number,
  progress: number, // 0 = 100% Frame A, 1 = 100% Frame B
  flow?: FlowVector[][],
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const p = clamp(progress, 0, 1);
  const length = width * height * 4;
  const result = out ?? new Uint8ClampedArray(length);

  // If at extreme ends, copy verbatim
  if (p <= 0.001) {
    for (let i = 0; i < length; i++) result[i] = frameA[i];
    return result;
  }
  if (p >= 0.999) {
    for (let i = 0; i < length; i++) result[i] = frameB[i];
    return result;
  }

  const weightA = 1 - p;
  const weightB = p;

  if (!flow || flow.length === 0) {
    // Linear cross-dissolve fallback
    for (let i = 0; i < length; i += 4) {
      result[i]     = Math.round(frameA[i] * weightA + frameB[i] * weightB);
      result[i + 1] = Math.round(frameA[i + 1] * weightA + frameB[i + 1] * weightB);
      result[i + 2] = Math.round(frameA[i + 2] * weightA + frameB[i + 2] * weightB);
      result[i + 3] = 255;
    }
    return result;
  }

  const gridRows = flow.length;
  const gridCols = flow[0]?.length ?? 1;
  const cellW = width / gridCols;
  const cellH = height / gridRows;

  for (let y = 0; y < height; y++) {
    const gridY = Math.min(gridRows - 1, Math.floor(y / cellH));

    for (let x = 0; x < width; x++) {
      const gridX = Math.min(gridCols - 1, Math.floor(x / cellW));
      const vec = flow[gridY][gridX] ?? { u: 0, v: 0, confidence: 1 };

      // Forward warp from A and backward warp from B
      const warpAx = clamp(Math.round(x + vec.u * p), 0, width - 1);
      const warpAy = clamp(Math.round(y + vec.v * p), 0, height - 1);

      const warpBx = clamp(Math.round(x - vec.u * (1 - p)), 0, width - 1);
      const warpBy = clamp(Math.round(y - vec.v * (1 - p)), 0, height - 1);

      const idxA = (warpAy * width + warpAx) * 4;
      const idxB = (warpBy * width + warpBx) * 4;
      const idxOut = (y * width + x) * 4;

      result[idxOut]     = Math.round(frameA[idxA] * weightA + frameB[idxB] * weightB);
      result[idxOut + 1] = Math.round(frameA[idxA + 1] * weightA + frameB[idxB + 1] * weightB);
      result[idxOut + 2] = Math.round(frameA[idxA + 2] * weightA + frameB[idxB + 2] * weightB);
      result[idxOut + 3] = 255;
    }
  }

  return result;
}
