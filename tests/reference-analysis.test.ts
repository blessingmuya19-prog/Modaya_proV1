/**
 * Four-track reference deconstruction: narrative, visual, overlay, sonic —
 * one master timeline, all from measured signals, nothing the model invents.
 */
import { describe, it, expect } from 'vitest';
import { buildReferenceAnalysis, referenceAnalysisText } from '@/lib/ai/referenceAnalysis';

const TRANSCRIPT = {
  segments: [
    { startS: 1.0, endS: 3.0, text: 'this is the big one' },      // 5 words / 2s
    { startS: 3.2, endS: 5.2, text: 'so anyway moving on' },      // 4 words / 2s
  ],
};

describe('buildReferenceAnalysis', () => {
  it('finds the emphasis hook from vocal amplitude, not word count alone', () => {
    const a = buildReferenceAnalysis({
      durationS: 10,
      transcript: TRANSCRIPT,
      energy: [0.1, 0.9, 0.9, 0.9, 0.1, 0.1, 0.2, 0.2, 0.1, 0.1],   // hop = 1s
      cutsPerMin: 30,
    });
    const narrative = a.timeline_events.filter(e => e.track === 'narrative');
    expect(narrative.some(e => e.type === 'emphasis_hook' && e.tS === 1)).toBe(true);
    const hook = narrative.find(e => e.type === 'emphasis_hook')!;
    expect(hook.reason).toMatch(/voice peaks/);
    expect(hook.track).toBe('narrative');
  });

  it('detects shot changes AND motion bursts on the visual track', () => {
    const a = buildReferenceAnalysis({
      durationS: 20,
      visual: {
        cuts: [2, 8.4],
        samples: [
          { tS: 0, motion: 0.1 }, { tS: 1, motion: 0.1 },
          { tS: 3, motion: 0.9 }, { tS: 4, motion: 0.85 },   // burst
          { tS: 5, motion: 0.1 }, { tS: 10, motion: 0.1 },
        ],
      },
    });
    const visual = a.timeline_events.filter(e => e.track === 'visual');
    expect(visual.some(e => e.type === 'shot_change' && e.tS === 2)).toBe(true);
    expect(visual.some(e => e.type === 'motion_burst' && e.tS === 3)).toBe(true);
  });

  it('maps caption windows onto speech spans (track 3)', () => {
    const a = buildReferenceAnalysis({
      durationS: 10,
      transcript: TRANSCRIPT,
      captions: { present: true, position: 'lower', animated: true },
    });
    const overlay = a.timeline_events.filter(e => e.track === 'overlay');
    expect(overlay.length).toBe(2);
    expect(overlay[0].type).toBe('overlay_on');
    expect(overlay[0].reason).toMatch(/Animated caption appears along the bottom/);
  });

  it('flags off-voice onset spikes as SFX and speech starts as duck points (track 4)', () => {
    const a = buildReferenceAnalysis({
      durationS: 10,
      transcript: TRANSCRIPT,
      onsets: [0.6, 8.02],          // 0.6 = outside speech, spike; 8.02 = quiet
      energy: [0.1, 0.9, 0.1, 0.9, 0.1, 0.2, 0.1, 0.1, 0.05, 0.05],
    });
    const sonic = a.timeline_events.filter(e => e.track === 'sonic');
    expect(sonic.some(e => e.type === 'sfx_trigger' && e.tS === 0.6)).toBe(true);
    expect(sonic.some(e => e.type === 'duck_point' && e.tS === 1)).toBe(true);
    expect(sonic.some(e => e.tS === 8.02)).toBe(false);  // quiet onset is not an SFX
  });

  it('merges all four tracks into one chronological master timeline', () => {
    const a = buildReferenceAnalysis({
      durationS: 10,
      transcript: TRANSCRIPT,
      energy: [0.9, 0.1, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      onsets: [0.6],
      visual: { cuts: [4.0] },
      captions: { present: true, position: 'lower', animated: true },
      cutsPerMin: 30,
    });
    const tracks = new Set(a.timeline_events.map(e => e.track));
    expect(tracks.has('narrative')).toBe(true);
    expect(tracks.has('visual')).toBe(true);
    expect(tracks.has('overlay')).toBe(true);
    expect(tracks.has('sonic')).toBe(true);
    const ts = a.timeline_events.map(e => e.tS);
    expect([...ts]).toEqual([...ts].sort((x, y) => x - y));
  });

  it('reports global pacing from measured cut rate', () => {
    const fast = buildReferenceAnalysis({ durationS: 60, cutsPerMin: 36 });
    expect(fast.global.pacing).toBe('high_retention_rapid');
    const slow = buildReferenceAnalysis({ durationS: 60, cutsPerMin: 8 });
    expect(slow.global.pacing).toBe('relaxed');
  });

  it('produces the prompt block with reasons, not just timestamps', () => {
    const a = buildReferenceAnalysis({
      durationS: 10, transcript: TRANSCRIPT, energy: [0.1, 0.9, 0.9, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      cutsPerMin: 30,
    });
    const text = referenceAnalysisText(a);
    expect(text).toContain('REFERENCE ANALYSIS');
    expect(text).toContain('pacing');
    expect(text).toContain('[narrative/emphasis_hook/');
    expect(text).toMatch(/vocal amplitude|voice peaks/);
    /* seconds, not a fake HH:MM:SS */
    expect(text).not.toMatch(/00:0\d/);
  });
});
