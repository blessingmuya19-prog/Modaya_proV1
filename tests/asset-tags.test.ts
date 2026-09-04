/**
 * Asset understanding: the kit is classified so the AI can refer to real
 * assets instead of guessing. Name + MIME + duration only — nothing invented.
 */
import { describe, it, expect } from 'vitest';
import { tagAsset, describeAssets } from '@/lib/ai/assetTags';

describe('tagAsset', () => {
  it('reads a transition SFX from its name before generic audio', () => {
    const t = tagAsset({ name: 'whoosh-07.mp3', mimeType: 'audio/mpeg', durationS: 0.4 });
    expect(t.tags).toEqual(['transition sfx']);
    expect(t.note).toContain('whoosh-07.mp3');
  });

  it('classifies graphics, fonts, voiceover and music', () => {
    expect(tagAsset({ name: 'warning-icon.png', mimeType: 'image/png' }).tags).toEqual(['graphic']);
    expect(tagAsset({ name: 'Inter-Bold.ttf', mimeType: 'font/ttf' }).tags).toEqual(['font']);
    expect(tagAsset({ name: 'voiceover-take3.wav', mimeType: 'audio/wav' }).tags).toEqual(['voice']);
    expect(tagAsset({ name: 'bed-01.mp3', mimeType: 'audio/mpeg', durationS: 30 }).tags).toEqual(['music']);
  });

  it('classifies video as cutaway footage', () => {
    const t = tagAsset({ name: 'city-broll.mov', mimeType: 'video/quicktime', durationS: 12 });
    expect(t.tags).toEqual(['cutaway']);
  });

  it('says plainly when it cannot classify', () => {
    const t = tagAsset({ name: 'file.xy', mimeType: 'application/octet-stream' });
    expect(t.tags).toEqual(['unknown']);
    expect(t.note).toMatch(/unclassified/);
  });
});

describe('describeAssets', () => {
  it('renders the kit for the AI context', () => {
    const text = describeAssets([
      { name: 'whoosh.mp3', mimeType: 'audio/mpeg', durationS: 0.5 },
      { name: 'logo.png', mimeType: 'image/png' },
      { name: 'broll-city.mp4', mimeType: 'video/mp4', durationS: 8 },
    ]);
    expect(text).toContain('ASSET KIT (3 assets)');
    expect(text).toContain('[transition sfx]');
    expect(text).toContain('[graphic]');
    expect(text).toContain('[cutaway]');
    expect(text.includes('whoosh.mp3')).toBe(true);
  });

  it('states when the kit is empty instead of implying one', () => {
    expect(describeAssets([])).toContain('no asset library uploaded');
  });
});
