import { describe, it, expect } from 'vitest';
import {
  detectJumpCuts,
  getMorphTransitionProgress,
  calculateOpticalFlowField,
  synthesizeMorphFrame,
  DEFAULT_MORPH_CUT_CONFIG,
} from '@/lib/render/jumpCutSmoother';

describe('jump cut smoother & morph frame synthesis', () => {
  it('detects forward jump cuts between clips from the same source footage', () => {
    const clips = [
      { id: 'c1', kind: 'video', sourceId: 'main', sourceIn: 0.0, timelineIn: 0.0, timelineOut: 10.0 },
      // 1.5s silence was cut: source jumps from 10.0s to 11.5s
      { id: 'c2', kind: 'video', sourceId: 'main', sourceIn: 11.5, timelineIn: 10.0, timelineOut: 20.0 },
      // 5.0s large scene cut: source jumps from 20.0s to 25.0s (exceeds 2.5s max gap)
      { id: 'c3', kind: 'video', sourceId: 'main', sourceIn: 25.0, timelineIn: 20.0, timelineOut: 30.0 },
    ];

    const detected = detectJumpCuts(clips);
    expect(detected).toHaveLength(2);

    // First jump cut is smoothable (1.5s gap <= 2.5s)
    expect(detected[0].cutTimelineS).toBe(10.0);
    expect(detected[0].sourceGapS).toBe(1.5);
    expect(detected[0].smoothable).toBe(true);

    // Second cut is not smoothable because gap is too large (3.5s > 2.5s)
    expect(detected[1].cutTimelineS).toBe(20.0);
    expect(detected[1].sourceGapS).toBe(3.5);
    expect(detected[1].smoothable).toBe(false);
  });

  it('calculates morph transition progress window around cut timestamp', () => {
    const jumpCuts = [
      { id: 'j1', cutTimelineS: 10.0, outgoingClipId: 'c1', incomingClipId: 'c2', sourceGapS: 1.2, smoothable: true, reason: 'ok' },
    ];

    const blendDurationS = 0.20; // 100ms before cut (9.9s) to 100ms after cut (10.1s)

    // Before transition window (9.8s)
    const before = getMorphTransitionProgress(9.80, jumpCuts, blendDurationS);
    expect(before.inTransition).toBe(false);

    // At transition start (9.90s)
    const start = getMorphTransitionProgress(9.90, jumpCuts, blendDurationS);
    expect(start.inTransition).toBe(true);
    expect(start.progress).toBeCloseTo(0.0, 2);

    // At exact cut point (10.0s) -> 50% morph
    const mid = getMorphTransitionProgress(10.00, jumpCuts, blendDurationS);
    expect(mid.inTransition).toBe(true);
    expect(mid.progress).toBeCloseTo(0.5, 2);

    // At transition end (10.10s) -> 100% morph
    const end = getMorphTransitionProgress(10.10, jumpCuts, blendDurationS);
    expect(end.inTransition).toBe(true);
    expect(end.progress).toBeCloseTo(1.0, 2);

    // After transition window (10.20s)
    const after = getMorphTransitionProgress(10.20, jumpCuts, blendDurationS);
    expect(after.inTransition).toBe(false);
  });

  it('computes 2D optical flow vectors between frames', () => {
    const width = 32;
    const height = 32;
    const frameA = new Uint8ClampedArray(width * height * 4);
    const frameB = new Uint8ClampedArray(width * height * 4);

    // Frame A has bright spot at (16, 16)
    for (let y = 14; y <= 18; y++) {
      for (let x = 14; x <= 18; x++) {
        const idx = (y * width + x) * 4;
        frameA[idx] = 255; frameA[idx + 1] = 255; frameA[idx + 2] = 255; frameA[idx + 3] = 255;
      }
    }

    // Frame B has bright spot shifted 2 pixels right and 2 down to (18, 18)
    for (let y = 16; y <= 20; y++) {
      for (let x = 16; x <= 20; x++) {
        const idx = (y * width + x) * 4;
        frameB[idx] = 255; frameB[idx + 1] = 255; frameB[idx + 2] = 255; frameB[idx + 3] = 255;
      }
    }

    const flow = calculateOpticalFlowField(frameA, frameB, width, height, 8);
    expect(flow.length).toBeGreaterThanOrEqual(3);
    expect(flow[0].length).toBeGreaterThanOrEqual(3);

    // Center block should detect movement
    const centerVec = flow[2][2];
    expect(centerVec).toBeDefined();
    expect(centerVec.confidence).toBeGreaterThan(0);
  });

  it('synthesizes intermediate morphed frame across blend progress', () => {
    const width = 16;
    const height = 16;
    const frameA = new Uint8ClampedArray(width * height * 4);
    const frameB = new Uint8ClampedArray(width * height * 4);

    // Frame A is all red
    for (let i = 0; i < frameA.length; i += 4) {
      frameA[i] = 200; frameA[i + 1] = 0; frameA[i + 2] = 0; frameA[i + 3] = 255;
    }
    // Frame B is all blue
    for (let i = 0; i < frameB.length; i += 4) {
      frameB[i] = 0; frameB[i + 1] = 0; frameB[i + 2] = 200; frameB[i + 3] = 255;
    }

    // Progress 0 -> 100% Frame A
    const out0 = synthesizeMorphFrame(frameA, frameB, width, height, 0.0);
    expect(out0[0]).toBe(200);
    expect(out0[2]).toBe(0);

    // Progress 0.5 -> 50% blend of A & B
    const outMid = synthesizeMorphFrame(frameA, frameB, width, height, 0.5);
    expect(outMid[0]).toBeCloseTo(100, -1);
    expect(outMid[2]).toBeCloseTo(100, -1);

    // Progress 1.0 -> 100% Frame B
    const out1 = synthesizeMorphFrame(frameA, frameB, width, height, 1.0);
    expect(out1[0]).toBe(0);
    expect(out1[2]).toBe(200);
  });
});
