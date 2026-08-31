/**
 * LLM plumbing: provider selection, response parsing, operation validation and
 * execution. The point of these tests is that a *hostile* model response can
 * never corrupt a timeline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectProvider, llmAvailable, extractJson } from '@/lib/ai/llm';
import {
  validateOperations, applyOperations, detectSilences, TimelineClip,
} from '@/lib/ai/operations';

const KEYS = [
  'LLM_PROVIDER', 'LLM_MODEL', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL',
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => { delete process.env[k]; });
});
afterEach(() => {
  KEYS.forEach(k => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

describe('provider detection', () => {
  it('reports unavailable with no keys, so the app falls back to rules', () => {
    expect(llmAvailable()).toBe(false);
    expect(detectProvider().name).toBe('none');
  });

  it('picks up any free provider key', () => {
    process.env.GEMINI_API_KEY = 'x';
    expect(detectProvider()).toMatchObject({ name: 'gemini', ready: true });

    process.env.GROQ_API_KEY = 'y';
    expect(detectProvider().name).toBe('groq');       // preference order
  });

  it('honours an explicit provider and model override', () => {
    process.env.GROQ_API_KEY = 'y';
    process.env.OPENROUTER_API_KEY = 'z';
    process.env.LLM_PROVIDER = 'openrouter';
    process.env.LLM_MODEL = 'some/model:free';
    expect(detectProvider()).toMatchObject({ name: 'openrouter', model: 'some/model:free' });
  });

  it('does not select a provider whose key is missing', () => {
    process.env.LLM_PROVIDER = 'groq';
    expect(detectProvider().name).toBe('none');
  });
});

describe('response parsing', () => {
  it('parses clean JSON', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('survives code fences and chatter around the JSON', () => {
    expect(extractJson('```json\n{"reply":"hi","operations":[]}\n```'))
      .toEqual({ reply: 'hi', operations: [] });
    expect(extractJson('Sure! Here you go:\n{"reply":"ok"}\nHope that helps.'))
      .toEqual({ reply: 'ok' });
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(extractJson('not json at all')).toBeNull();
    expect(extractJson('')).toBeNull();
    expect(extractJson('{"broken": ')).toBeNull();
  });
});

describe('operation validation', () => {
  const ctx = { durationS: 100 };

  it('drops unknown operations', () => {
    expect(validateOperations([{ op: 'delete_everything' }, { op: 'rm -rf' }], ctx)).toEqual([]);
  });

  it('clamps ranges to the video and merges overlaps', () => {
    const ops = validateOperations([{ op: 'remove_ranges', ranges: [[-10, 20], [15, 30], [90, 500]] }], ctx);
    expect(ops).toEqual([{ op: 'remove_ranges', ranges: [[0, 30], [90, 100]] }]);
  });

  it('accepts object-shaped ranges too', () => {
    const ops = validateOperations([{ op: 'remove_ranges', ranges: [{ startS: 5, endS: 10 }] }], ctx);
    expect(ops[0]).toMatchObject({ ranges: [[5, 10]] });
  });

  it('rejects nonsense numbers', () => {
    expect(validateOperations([{ op: 'trim_to', targetS: -5 }], ctx)).toEqual([]);
    expect(validateOperations([{ op: 'trim_to', targetS: 1e9 }], ctx)).toEqual([]);
    expect(validateOperations([{ op: 'trim_to', targetS: 'soon' }], ctx)).toEqual([]);
  });

  it('clamps look parameters into a sane band', () => {
    const [op] = validateOperations([{ op: 'grade', brightness: 99, contrast: -4, saturation: 1.2 }], ctx);
    expect(op).toEqual({ op: 'grade', brightness: 1.6, contrast: 0.6, saturation: 1.2 });
  });

  it('ignores a non-array plan', () => {
    expect(validateOperations('drop the table', ctx)).toEqual([]);
    expect(validateOperations(null, ctx)).toEqual([]);
  });
});

describe('operation execution', () => {
  const clips = (): TimelineClip[] => ([
    { id: 'v1', trackId: 'video', label: 'Video', startS: 0, endS: 100, type: 'video' },
  ]);
  const ctx = { durationS: 100 };

  it('removing a middle span splits the clip in two', () => {
    const out = applyOperations(clips(), [{ op: 'remove_ranges', ranges: [[30, 50]] }], ctx);
    const video = out.clips.filter(c => c.type === 'video');
    expect(video).toHaveLength(2);
    expect(video[0]).toMatchObject({ startS: 0, endS: 30 });
    expect(video[1]).toMatchObject({ startS: 50, endS: 100 });
    expect(out.removedS).toBe(20);
    expect(out.affectedIds).toContain('v1');
  });

  it('keeps only the requested spans', () => {
    const out = applyOperations(clips(), [{ op: 'keep_ranges', ranges: [[10, 20], [60, 70]] }], ctx);
    const video = out.clips.filter(c => c.type === 'video');
    expect(video.map(c => [c.startS, c.endS])).toEqual([[10, 20], [60, 70]]);
    expect(out.removedS).toBe(80);
  });

  it('trims to a target length', () => {
    const out = applyOperations(clips(), [{ op: 'trim_to', targetS: 40 }], ctx);
    const video = out.clips.filter(c => c.type === 'video');
    expect(video).toHaveLength(1);
    expect(video[0].endS).toBe(40);
  });

  it('cutting real silences leaves only speech', () => {
    const silences: [number, number][] = [[10, 14], [40, 47]];
    const out = applyOperations(clips(), [{ op: 'remove_ranges', ranges: silences }], ctx);
    expect(out.removedS).toBe(11);
    for (const [s, e] of silences) {
      const mid = (s + e) / 2;
      expect(out.clips.some(c => c.type === 'video' && mid > c.startS && mid < c.endS)).toBe(false);
    }
  });

  it('adds caption slots across the video only', () => {
    const out = applyOperations(clips(), [{ op: 'add_captions', position: 'lower', everyS: 10 }], ctx);
    const caps = out.clips.filter(c => c.type === 'text');
    expect(caps.length).toBe(10);
    expect(caps.every(c => c.trackId === 'subs')).toBe(true);
  });

  it('never produces zero-length or inverted clips', () => {
    const out = applyOperations(clips(), [
      { op: 'remove_ranges', ranges: [[0, 0.05], [99.99, 100]] },
    ], ctx);
    for (const c of out.clips) expect(c.endS - c.startS).toBeGreaterThan(0.05);
  });

  it('an empty plan changes nothing', () => {
    const out = applyOperations(clips(), [{ op: 'none' }], ctx);
    expect(out.clips).toHaveLength(1);
    expect(out.removedS).toBe(0);
  });
});

describe('silence detection', () => {
  it('finds the quiet spans in an envelope', () => {
    // 20s at 50ms hops: loud, then silent 5–10s, then loud
    const hopS = 0.05;
    const rms = Array.from({ length: 400 }, (_, i) => {
      const t = i * hopS;
      return t >= 5 && t < 10 ? 0.01 : 0.4;
    });
    const spans = detectSilences(rms, hopS);
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBeGreaterThanOrEqual(5);
    expect(spans[0][1]).toBeLessThanOrEqual(10);
  });

  it('ignores gaps that are too short to be pauses', () => {
    const hopS = 0.05;
    const rms = Array.from({ length: 400 }, (_, i) => (i % 20 === 0 ? 0.01 : 0.4));
    expect(detectSilences(rms, hopS)).toHaveLength(0);
  });

  it('handles a completely silent track', () => {
    const spans = detectSilences(new Array(200).fill(0), 0.05);
    expect(spans).toHaveLength(1);
    expect(spans[0][1] - spans[0][0]).toBeGreaterThan(9);
  });
});
