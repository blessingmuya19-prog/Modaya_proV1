/**
 * TwelveLabs Pegasus is an optional visual ranker. It must (1) do nothing
 * without a key or a reachable URL, never throwing, and (2) when it answers,
 * boost overlapping clips and add unmatched moments — all pure/testable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyRanking, rankHighlights, twelveLabsReady } from '@/lib/ai/twelvelabs';
import type { ClipSuggestion } from '@/lib/ai/clips';

const clip = (i: number, startS: number, endS: number, score: number): ClipSuggestion => ({
  id: `clip-${i}`, startS, endS, score, title: `Clip ${i}`,
  reason: 'measured', tags: [], source: 'measurement',
});

describe('applyRanking (pure)', () => {
  it('boosts a clip a Pegasus moment overlaps, blending the visual score', () => {
    const clips = [clip(1, 100, 145, 50), clip(2, 200, 245, 50)];
    const segs = [{ startS: 110, endS: 140, reason: 'big reaction on camera', score: 92 }];
    const out = applyRanking(clips, segs, 300);

    const boosted = out.find(c => c.startS === 100)!;
    const untouched = out.find(c => c.startS === 200)!;
    // 0.6*92 + 0.4*50 = 75.2 → 75
    expect(boosted.score).toBe(75);
    expect(boosted.reason).toContain('Pegasus');
    expect(untouched.score).toBe(50);
    // never exceeds 100
    expect(boosted.score).toBeLessThanOrEqual(100);
  });

  it('adds a Pegasus moment with no nearby clip as an AI clip', () => {
    const clips = [clip(1, 0, 40, 40)];
    const segs = [{ startS: 250, endS: 285, reason: 'stunt the text model would miss', score: 88 }];
    const out = applyRanking(clips, segs, 300);
    expect(out.some(c => c.source === 'ai' && c.startS === 250)).toBe(true);
    const added = out.find(c => c.startS === 250)!;
    expect(added.reason).toContain('TwelveLabs');
    expect(added.endS).toBeLessThanOrEqual(300);
  });

  it('re-numbers ids by descending score after ranking', () => {
    const clips = [clip(1, 0, 40, 10), clip(2, 100, 140, 10)];
    const segs = [{ startS: 105, endS: 135, reason: 'peak action', score: 99 }];
    const out = applyRanking(clips, segs, 300);
    expect(out[0].id).toBe('clip-1');
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });
});

describe('rankHighlights (network)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.TWELVELABS_API_KEY;
    delete process.env.TWELVELABS_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it('reports not_configured when no key is set, without fetching', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    return rankHighlights('https://example.com/v.mp4', 300).then(r => {
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('not_configured');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('reports no_video when a key exists but no URL is available', async () => {
    process.env.TWELVELABS_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('@/lib/ai/twelvelabs');
    expect(mod.twelveLabsReady()).toBe(true);
    const r = await mod.rankHighlights(null, 300);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_video');
  });

  it('parses Pegasus segments into ranked clips', async () => {
    process.env.TWELVELABS_API_KEY = 'test-key';
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        segments: [
          { start: 100, end: 140, fields: { reason: 'crowd cheers', virality: 'high' } },
          { start: 200, end: 230, fields: { reason: 'quiet tip', virality: 'low' } },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const mod = await import('@/lib/ai/twelvelabs');
    const r = await mod.rankHighlights('https://example.com/v.mp4', 300);
    expect(r.ok).toBe(true);
    expect(r.segments?.length).toBe(2);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/analyze'), expect.objectContaining({
      method: 'POST',
    }));
    const high = r.segments!.find(s => s.startS === 100)!;
    expect(high.score).toBe(92); // 'high'
    expect(high.reason).toContain('cheers');
    expect(r.segments!.find(s => s.startS === 200)!.score).toBe(48); // 'low'
  });

  it('returns a typed failure (never throws) when the API rejects', async () => {
    process.env.TWELVELABS_API_KEY = 'test-key';
    vi.resetModules();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 429 }),
    );
    const mod = await import('@/lib/ai/twelvelabs');
    const r = await mod.rankHighlights('https://example.com/v.mp4', 300);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('rate_limited');
  });

  it('returns a typed failure when the network is unreachable', async () => {
    process.env.TWELVELABS_API_KEY = 'test-key';
    vi.resetModules();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const mod = await import('@/lib/ai/twelvelabs');
    const r = await mod.rankHighlights('https://example.com/v.mp4', 300);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unreachable');
  });
});

describe('twelveLabsReady', () => {
  it('is false without the env var', () => {
    delete process.env.TWELVELABS_API_KEY;
    // module-level ready reads process.env at call time
    expect(twelveLabsReady()).toBe(false);
  });
});
