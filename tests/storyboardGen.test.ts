import { describe, it, expect } from 'vitest';
import {
  generateSemanticChapters,
  generateStoryboardCards,
  buildVideoStoryboard,
  type TranscriptLineItem,
} from '../src/lib/ai/storyboardGen';

describe('AI Video Storyboard & Chaptering Generator', () => {
  const sampleTranscript: TranscriptLineItem[] = [
    { start: 0.5, end: 3.2, text: 'Stop making this huge video editing mistake right now.' },
    { start: 3.5, end: 8.0, text: 'Most creators spend 10 hours cutting dead air manually.' },
    { start: 8.5, end: 15.0, text: 'Here is how our AI pipeline scales your output with software automation.' },
    { start: 15.5, end: 22.0, text: 'This resulted in 300% growth and massive engagement gains.' },
    { start: 22.5, end: 28.0, text: 'Make sure to hit subscribe and check the link below.' },
  ];

  it('generates semantic chapters with hook identification', () => {
    const chapters = generateSemanticChapters(sampleTranscript, 30.0);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(chapters[0].isHookChapter).toBe(true);
    expect(chapters[0].startS).toBeCloseTo(0.5);
  });

  it('generates visual storyboard cards with contextual B-roll search queries', () => {
    const chapters = generateSemanticChapters(sampleTranscript, 30.0);
    const cards = generateStoryboardCards(chapters, sampleTranscript);

    expect(cards.length).toBeGreaterThanOrEqual(2);
    // Card matching software automation should recommend screen recording
    const softwareCard = cards.find(c => c.brollSearchQuery.includes('software') || c.brollSearchQuery.includes('laptop'));
    expect(softwareCard).toBeDefined();

    // Hook card should be marked wide establishing / energetic
    expect(cards[0].mood).toBe('energetic');
  });

  it('builds full storyboard package with viral summary', () => {
    const pkg = buildVideoStoryboard(sampleTranscript, 30.0);
    expect(pkg.totalDurationS).toBe(30.0);
    expect(pkg.chapters.length).toBeGreaterThan(0);
    expect(pkg.cards.length).toBeGreaterThan(0);
    expect(pkg.viralHookSummary).toContain('Stop making this huge');
  });
});
