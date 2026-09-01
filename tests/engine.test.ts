/**
 * PreviewEngine — the compositor and transport, exercised in jsdom with a
 * recording canvas context and a stubbed media element.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreviewEngine } from '@/lib/render/engine';
import { buildSequence } from '@/lib/render/sequence';

interface DrawCall { x: number; y: number; w: number; h: number }

let draws: DrawCall[] = [];
let texts: string[] = [];
let textDraws: { t: string; x: number; y: number; font?: string }[] = [];
let filters: string[] = [];
let videoTime = 0;
let paused = true;

function fakeCtx() {
  return {
    canvas: null as unknown,
    filter: 'none',
    globalAlpha: 1,
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {},
    fillRect() {},
    measureText: () => ({ width: 100 }),
    fillText: (t: string, x: number, y: number) => {
      texts.push(t);
      textDraws.push({ t, x, y, font: (globalThis as never as { __lastFont: string }).__lastFont });
    },
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
      draws.push({ x, y, w, h });
      filters.push((globalThis as never as { __lastFilter: string }).__lastFilter);
    },
  };
}

function setup(clips: Parameters<typeof buildSequence>[0], durationS = 100,
               size = { width: 1920, height: 1080 }) {
  const canvas = document.createElement('canvas');
  const ctx = fakeCtx();
  // record the filter in force at each drawImage
  const proxy = new Proxy(ctx, {
    set(t, k, v) {
      if (k === 'filter') (globalThis as never as { __lastFilter: string }).__lastFilter = v;
      if (k === 'font')   (globalThis as never as { __lastFont: string }).__lastFont = v;
      return Reflect.set(t, k, v);
    },
  });
  canvas.getContext = (() => proxy) as never;

  const engine = new PreviewEngine();
  const host = document.createElement('div');
  document.body.appendChild(host);
  engine.mount(host);
  engine.attach(canvas);
  engine.setSequence(buildSequence(clips, { durationS, sourceId: 'p1', ...size }));
  engine.setSource('p1', 'blob:fake');
  return { engine, canvas };
}

beforeEach(() => {
  draws = []; texts = []; textDraws = []; filters = []; videoTime = 0; paused = true;

  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get() { return videoTime; },
    set(v) { videoTime = v; },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true, get() { return paused; },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState',  { configurable: true, get: () => 4 });
  // jsdom defines these on HTMLVideoElement, which shadows HTMLMediaElement
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth',  { configurable: true, get: () => 1080 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1920 });
  HTMLMediaElement.prototype.play  = vi.fn(function () { paused = false; return Promise.resolve(); });
  HTMLMediaElement.prototype.pause = vi.fn(function () { paused = true; });
  HTMLMediaElement.prototype.load  = vi.fn();
});

const CLIPS = [
  { id: 'a', trackId: 'video', label: 'A', startS: 0,  endS: 30,  type: 'video' as const },
  { id: 'b', trackId: 'video', label: 'B', startS: 50, endS: 100, type: 'video' as const },
];

const frames = (n = 3) => new Promise(r => {
  let i = 0;
  const step = () => (++i >= n ? r(null) : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

describe('PreviewEngine', () => {
  it('paints a composited frame on seek, even while paused', () => {
    const { engine } = setup(CLIPS);
    draws = [];
    engine.seek(10);
    expect(draws.length).toBeGreaterThan(0);
  });

  it('letterboxes a 9:16 source into a 16:9 frame instead of stretching it', () => {
    const { engine, canvas } = setup(CLIPS, 100, { width: 1920, height: 1080 });
    draws = [];
    engine.seek(10);
    const d = draws.at(-1)!;
    expect(d.w / d.h).toBeCloseTo(1080 / 1920, 3);      // source ratio kept
    expect(d.h).toBeCloseTo(canvas.height, 1);          // height-bound
    expect(d.x).toBeGreaterThan(0);                     // pillarboxed
  });

  it('maps the playhead to the right point in the source file', () => {
    const { engine } = setup(CLIPS);
    engine.seek(60);
    expect(videoTime).toBeCloseTo(60, 2);
  });

  it('skips a cut section rather than playing black', async () => {
    const { engine } = setup(CLIPS);
    engine.seek(40);                 // inside the removed 30–50s span
    await engine.play();
    expect(engine.time).toBeGreaterThanOrEqual(50);
  });

  it('advances across a clip boundary during playback', async () => {
    const { engine } = setup(CLIPS);
    engine.seek(29);
    await engine.play();
    videoTime = 30;                  // element reaches the end of clip A
    await frames(4);
    expect(engine.time).toBeGreaterThanOrEqual(50);   // now on clip B
    engine.pause();
  });

  it('stops at the end of the programme', async () => {
    const { engine } = setup(CLIPS);
    engine.seek(99);
    await engine.play();
    videoTime = 100;
    await frames(4);
    expect(engine.playing).toBe(false);
    expect(engine.time).toBeCloseTo(100, 1);
  });

  it('composites text overlays on top of the video', () => {
    const { engine } = setup([
      ...CLIPS,
      { id: 't', trackId: 'text', label: 'Hello world', startS: 5, endS: 9, type: 'text' as const },
    ]);
    texts = [];
    engine.seek(6);
    expect(texts).toContain('Hello world');
    engine.seek(20);
    texts = [];
    engine.seek(20);
    expect(texts).not.toContain('Hello world');
  });

  it('reports time through the listener while playing', async () => {
    const { engine } = setup(CLIPS);
    const seen: number[] = [];
    engine.onTime(t => seen.push(t));
    engine.seek(5);
    await engine.play();
    videoTime = 7;
    await frames(3);
    engine.pause();
    expect(seen.some(t => t > 5)).toBe(true);
  });

  it('cleans up its media elements on destroy', () => {
    const { engine } = setup(CLIPS);
    const before = document.querySelectorAll('video').length;
    expect(before).toBeGreaterThan(0);
    engine.destroy();
    expect(document.querySelectorAll('video').length).toBe(before - 2);
  });
});

/**
 * Reaching the end and pausing are different events. Conflating them meant the
 * playhead sat at the end of the video after playback finished, with no way
 * back to the start except dragging it.
 */
describe('end of playback', () => {
  it('announces the end, distinctly from a pause', async () => {
    const { engine } = setup(CLIPS, 100);
    const ended: number[] = [];
    const paused: boolean[] = [];
    engine.onEnd(() => ended.push(engine.time));
    engine.onState(p => paused.push(p));

    engine.seek(99);
    await engine.play();
    videoTime = 100;                 // element runs out
    await frames(6);

    expect(ended.length).toBeGreaterThan(0);
    expect(engine.playing).toBe(false);
    expect(paused).toContain(false);
  });

  it('reports the very end as the final time, not a value short of it', async () => {
    const { engine } = setup(CLIPS, 100);
    let last = -1;
    engine.onTime(t => { last = t; });
    engine.onEnd(() => {});

    engine.seek(99);
    await engine.play();
    videoTime = 100;                 // element runs out
    await frames(6);

    expect(last).toBeCloseTo(100, 1);
  });

  it('does NOT announce the end on an ordinary pause', async () => {
    const { engine } = setup(CLIPS, 100);
    let ends = 0;
    engine.onEnd(() => { ends++; });

    engine.seek(10);
    await engine.play();
    await frames(2);
    engine.pause();

    expect(ends).toBe(0);
    expect(engine.time).toBeCloseTo(10, 0);   // a pause leaves the playhead alone
  });

  it('fires the end once, not on every frame afterwards', async () => {
    const { engine } = setup(CLIPS, 100);
    let ends = 0;
    engine.onEnd(() => { ends++; });

    engine.seek(99);
    await engine.play();
    videoTime = 100;
    await frames(8);

    expect(ends).toBe(1);
  });
});


/**
 * Where a caption is drawn.
 *
 * Asking for captions along the bottom put them in the middle of the frame
 * however many times it was asked: the operation records the position as the
 * track the caption lives on, and the renderer was reading only the clip kind.
 */
describe('caption position', () => {
  const at = (clips: any[], t: number) => {
    const { engine, canvas } = setup(clips, 100);
    textDraws = [];
    engine.seek(t);
    const hit = textDraws.find(d => d.t.includes('spoken'));
    return { y: hit?.y ?? -1, H: canvas.height };
  };

  it('draws a subtitle along the bottom', () => {
    const { y, H } = at([
      { id:'v', trackId:'video', label:'V', startS:0, endS:100, type:'video' as const },
      { id:'cap-0', trackId:'subs', label:'the spoken words', startS:1, endS:5, type:'subtitle' as const },
    ], 2);
    expect(y).toBeGreaterThan(H * 0.8);
  });

  it('draws a caption on the subs track along the bottom even if it is typed as plain text', () => {
    // projects captioned before the fix are stored exactly like this
    const { y, H } = at([
      { id:'v', trackId:'video', label:'V', startS:0, endS:100, type:'video' as const },
      { id:'cap-0', trackId:'subs', label:'the spoken words', startS:1, endS:5, type:'text' as const },
    ], 2);
    expect(y, 'a caption on the subs track was drawn in the middle').toBeGreaterThan(H * 0.8);
  });

  it('still centres a caption that asked to be centred', () => {
    const { y, H } = at([
      { id:'v', trackId:'video', label:'V', startS:0, endS:100, type:'video' as const },
      { id:'cap-0', trackId:'text', label:'the spoken words', startS:1, endS:5, type:'text' as const },
    ], 2);
    // the block of text straddles the middle of the frame
    expect(y).toBeGreaterThan(H * 0.45);
    expect(y).toBeLessThan(H * 0.6);
  });
});


/**
 * The frame position and the look of the words, as actually drawn.
 */
describe('text position and style on the canvas', () => {
  const draw = (clip: Record<string, unknown>, t = 2) => {
    const { engine, canvas } = setup([
      { id:'v', trackId:'video', label:'V', startS:0, endS:100, type:'video' as const },
      { id:'x', trackId:'text', label:'Blessing Muya', startS:1, endS:5, type:'text' as const, ...clip },
    ] as never, 100);
    textDraws = [];
    engine.seek(t);
    return { hit: textDraws.find(d => /blessing/i.test(d.t)), H: canvas.height, W: canvas.width };
  };

  it('draws across the top when asked for the top', () => {
    const { hit, H } = draw({ textPosition: 'top' });
    expect(hit, 'nothing was drawn').toBeTruthy();
    expect(hit!.y).toBeLessThan(H * 0.3);
  });

  it('draws along the bottom when asked for the bottom', () => {
    const { hit, H } = draw({ textPosition: 'lower' });
    expect(hit!.y).toBeGreaterThan(H * 0.8);
  });

  it('draws in the middle when asked for the middle', () => {
    const { hit, H } = draw({ textPosition: 'centre' });
    expect(hit!.y).toBeGreaterThan(H * 0.45);
    expect(hit!.y).toBeLessThan(H * 0.6);
  });

  it('uses the font that was asked for', () => {
    expect(draw({ textStyle: { font: 'serif' } }).hit!.font).toMatch(/Georgia|serif/i);
    expect(draw({ textStyle: { font: 'mono' } }).hit!.font).toMatch(/mono|Menlo|Consolas/i);
    expect(draw({ textStyle: { font: 'display' } }).hit!.font).toMatch(/Impact|Arial Black/i);
    expect(draw({ textStyle: { font: 'handwritten' } }).hit!.font).toMatch(/Script|Hand|cursive/i);
  });

  it('sizes the text as asked', () => {
    const px = (f?: string) => parseFloat((f ?? '').match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '0');
    const small  = px(draw({ textStyle: { size: 'small'  } }).hit!.font);
    const medium = px(draw({ textStyle: { size: 'medium' } }).hit!.font);
    const large  = px(draw({ textStyle: { size: 'large'  } }).hit!.font);
    expect(small).toBeGreaterThan(0);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
  });

  it('puts the words in upper case only when asked', () => {
    expect(draw({ textStyle: { uppercase: true } }).hit!.t).toBe('BLESSING MUYA');
    expect(draw({}).hit!.t).toBe('Blessing Muya');
  });

  it('draws in the top right corner when asked for one', () => {
    const { hit, H, W } = draw({ textPosition: 'top', textAlign: 'right' });
    expect(hit!.y).toBeLessThan(H * 0.3);
    expect(hit!.x, 'the words were not pushed to the right').toBeGreaterThan(W * 0.6);
  });

  it('draws in the bottom left corner when asked for one', () => {
    const { hit, H, W } = draw({ textPosition: 'lower', textAlign: 'left' });
    expect(hit!.y).toBeGreaterThan(H * 0.8);
    expect(hit!.x).toBeLessThan(W * 0.4);
  });

  it('keeps a corner clear of the very edge of the frame', () => {
    const { hit, W } = draw({ textPosition: 'top', textAlign: 'right' });
    expect(hit!.x).toBeLessThan(W - 1);
    expect(W - hit!.x).toBeGreaterThan(W * 0.02);
  });

  it('centres text across the frame when no side is asked for', () => {
    const { hit, W } = draw({ textPosition: 'top' });
    expect(hit!.x).toBeCloseTo(W / 2, 0);
  });

  it('still reads the old track-and-kind rule when a clip has no position', () => {
    const { hit, H } = draw({ trackId: 'subs', type: 'subtitle' });
    expect(hit!.y, 'a caption from before the fix moved').toBeGreaterThan(H * 0.8);
  });
});
