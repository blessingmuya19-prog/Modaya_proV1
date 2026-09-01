/**
 * Exercises the real EditorShell in jsdom: does the timeline exist before the
 * AI clips arrive, does clicking the ruler seek the video, does the playhead
 * follow the video's own clock?
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EditorShell } from '@/components/editor/EditorShell';
import { setMedia } from '@/lib/videoStore';

const PROJECT = 'test-project';

beforeAll(() => {
  // jsdom has no media stack — give the element a working clock
  let t = 0;
  let paused = true;
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get() { return t; },
    set(v) { t = v; this.dispatchEvent(new Event('seeked')); },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true, get() { return paused; },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'seeking', {
    configurable: true, get() { return false; },
  });
  HTMLMediaElement.prototype.play  = vi.fn(function () { paused = false; return Promise.resolve(); });
  HTMLMediaElement.prototype.pause = vi.fn(function () { paused = true; });
  HTMLMediaElement.prototype.load  = vi.fn();
  (globalThis as any).__setVideoTime = (v: number) => { t = v; };

  Element.prototype.scrollIntoView = function () {};
  Element.prototype.scrollTo = function (opts: any) {
    Object.defineProperty(this, 'scrollLeft', { configurable: true, writable: true, value: opts.left });
  };
  window.matchMedia = window.matchMedia || (() => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  })) as any;

  setMedia(PROJECT, {
    objectUrl: 'blob:http://localhost/fake', mimeType: 'video/mp4', mediaType: 'video',
    aspectRatio: '9:16', width: 1080, height: 1920, durationS: 300, filename: 'clip.mp4',
  });
});

function mount(clips: any[] = []) {
  return render(
    <EditorShell projectId={PROJECT} projectName="Test" onAIAction={() => {}}
      clips={clips} durationS={300} aiHistory={[]} />
  );
}

describe('editor timeline', () => {
  it('renders a usable timeline before the AI clips arrive', () => {
    const { container } = mount([]);
    const scroller = container.querySelector('[data-modaya-timeline]');
    const playhead = container.querySelector('[data-modaya-playhead]');
    expect(scroller, 'timeline scroll container missing (spinner state?)').toBeTruthy();
    expect(playhead, 'playhead missing').toBeTruthy();
    expect(container.querySelector('video')).toBeTruthy();
  });

  it('starts the playhead at 0', () => {
    const { container } = mount([]);
    const ph = container.querySelector('[data-modaya-playhead]') as HTMLElement;
    expect(ph.style.left).toBe('0px');
  });

  it('clicking the ruler moves the playhead AND seeks the video', () => {
    const { container } = mount([]);
    const ruler = container.querySelector('[data-modaya-timeline] > div > div') as HTMLElement;
    ruler.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 24,
      width: 900, height: 24, x: 0, y: 0, toJSON: () => {} });

    act(() => {
      ruler.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    const ph = container.querySelector('[data-modaya-playhead]') as HTMLElement;
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(parseFloat(ph.style.left), 'playhead did not move').toBeGreaterThan(0);
    expect(video.currentTime, 'video did not seek to the clicked position').toBeGreaterThan(0);
  });

  it('playhead follows the video clock during playback', async () => {
    const { container } = mount([]);
    const playBtn = container.querySelectorAll('button');
    // the round transport play button is the one with a white background
    const btn = Array.from(playBtn).find(b => (b as HTMLElement).style.background === 'rgb(255, 255, 255)') as HTMLElement;
    expect(btn, 'play button not found').toBeTruthy();

    await act(async () => { btn.click(); });
    (globalThis as any).__setVideoTime(42);
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });

    const ph = container.querySelector('[data-modaya-playhead]') as HTMLElement;
    expect(parseFloat(ph.style.left), 'playhead ignored the video clock').toBeGreaterThan(0);
  });

  it('returns the playhead to the start when the video ends', async () => {
    const { container } = mount([]);
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => (b as HTMLElement).style.background === 'rgb(255, 255, 255)') as HTMLElement;

    await act(async () => { btn.click(); });
    (globalThis as any).__setVideoTime(120);
    await act(async () => { await new Promise(r => setTimeout(r, 150)); });
    const ph = container.querySelector('[data-modaya-playhead]') as HTMLElement;
    expect(parseFloat(ph.style.left), 'playhead never moved off zero').toBeGreaterThan(0);

    // the element runs out of footage
    (globalThis as any).__setVideoTime(300);
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });

    const after = container.querySelector('[data-modaya-playhead]') as HTMLElement;
    expect(parseFloat(after.style.left), 'playhead was left parked at the end').toBe(0);
  });

  it('leaves the playhead alone on an ordinary pause', async () => {
    const { container } = mount([]);
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => (b as HTMLElement).style.background === 'rgb(255, 255, 255)') as HTMLElement;

    await act(async () => { btn.click(); });
    (globalThis as any).__setVideoTime(120);
    await act(async () => { await new Promise(r => setTimeout(r, 150)); });

    const pauseBtn = Array.from(container.querySelectorAll('button'))
      .find(b => (b as HTMLElement).style.background === 'rgb(255, 255, 255)') as HTMLElement;
    await act(async () => { pauseBtn.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });

    const ph = container.querySelector('[data-modaya-playhead]') as HTMLElement;
    expect(parseFloat(ph.style.left), 'pause rewound the playhead').toBeGreaterThan(0);
  });

  it('scrolls the timeline to follow the playhead off-screen', async () => {
    const { container } = mount([]);
    const scroller = container.querySelector('[data-modaya-timeline]') as HTMLElement;

    // jsdom has no layout — give the scroller a viewport narrower than content
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 600 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 4000 });
    Object.defineProperty(scroller, 'scrollLeft',  { configurable: true, writable: true, value: 0 });

    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => (b as HTMLElement).style.background === 'rgb(255, 255, 255)') as HTMLElement;
    await act(async () => { btn.click(); });

    // video runs deep into the clip — well past the visible window
    (globalThis as any).__setVideoTime(250);
    await act(async () => { await new Promise(r => setTimeout(r, 400)); });

    expect(scroller.scrollLeft, 'timeline never scrolled to the playhead').toBeGreaterThan(0);
  });
});
