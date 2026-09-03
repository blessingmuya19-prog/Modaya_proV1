import { describe, it, expect } from 'vitest';
import {
  generatePublishPackage,
  PLATFORM_SPECS,
  type SocialPlatform,
} from '../src/lib/studio/publisher';

describe('Social Media Multi-Platform Publisher', () => {
  it('generates viral hook titles and formatted copy for TikTok & YouTube Shorts', () => {
    const pkg = generatePublishPackage(
      'tiktok',
      ['AI Video', 'Shorts Strategy', 'Pacing'],
      'How to edit engaging shorts with high viewer retention.',
      45.0
    );

    expect(pkg.platform).toBe('tiktok');
    expect(pkg.titleSuggestions.length).toBeGreaterThanOrEqual(3);
    expect(pkg.titleSuggestions[0]).toContain('AI Video');
    expect(pkg.hashtags.length).toBeLessThanOrEqual(PLATFORM_SPECS.tiktok.hashtagLimit);
    expect(pkg.hashtags.some(h => h === '#aivideo')).toBe(true);
    expect(pkg.recommendedThumbnailTimestamp).toBeGreaterThan(1.0);
  });

  it('generates professional executive copy for LinkedIn videos', () => {
    const pkg = generatePublishPackage(
      'linkedin',
      ['Workflow Automation', 'Production Efficiency'],
      'A deep dive into automating modern video production pipelines.',
      120.0
    );

    expect(pkg.platform).toBe('linkedin');
    expect(pkg.titleSuggestions[0]).toContain('Workflow Automation');
    expect(pkg.hashtags.length).toBeLessThanOrEqual(PLATFORM_SPECS.linkedin.hashtagLimit);
  });

  it('respects character limits on character-constrained platforms like X/Twitter', () => {
    const pkg = generatePublishPackage(
      'x_twitter',
      ['CreatorEconomy', 'SpeedRun'],
      'Long detailed summary that should not overflow the 280-character post limit on X platform.',
      30.0
    );

    expect(pkg.platform).toBe('x_twitter');
    expect(pkg.formattedPostText.length).toBeLessThanOrEqual(280);
  });
});
