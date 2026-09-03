/**
 * Social Media Multi-Platform Publisher & Video Metadata Generator.
 *
 * Provides platform-tailored presets (TikTok, YouTube Shorts, Instagram Reels,
 * LinkedIn, X), automated viral hook titles, hashtag generation from transcript
 * topics, and optimal thumbnail frame extraction.
 *
 * Fully deterministic and zero-dependency.
 */

export type SocialPlatform =
  | 'tiktok'
  | 'youtube_shorts'
  | 'youtube_long'
  | 'instagram_reels'
  | 'instagram_feed'
  | 'linkedin'
  | 'x_twitter';

export interface PlatformPublishSpec {
  id: SocialPlatform;
  displayName: string;
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  targetWidth: number;
  targetHeight: number;
  maxDurationSeconds: number;
  hashtagLimit: number;
  titleMaxLength: number;
  descriptionMaxLength: number;
  supportsCaptionsBurnIn: boolean;
}

export const PLATFORM_SPECS: Record<SocialPlatform, PlatformPublishSpec> = {
  tiktok: {
    id: 'tiktok',
    displayName: 'TikTok',
    aspectRatio: '9:16',
    targetWidth: 1080,
    targetHeight: 1920,
    maxDurationSeconds: 180,
    hashtagLimit: 6,
    titleMaxLength: 100,
    descriptionMaxLength: 2200,
    supportsCaptionsBurnIn: true,
  },
  youtube_shorts: {
    id: 'youtube_shorts',
    displayName: 'YouTube Shorts',
    aspectRatio: '9:16',
    targetWidth: 1080,
    targetHeight: 1920,
    maxDurationSeconds: 60,
    hashtagLimit: 5,
    titleMaxLength: 100,
    descriptionMaxLength: 5000,
    supportsCaptionsBurnIn: true,
  },
  youtube_long: {
    id: 'youtube_long',
    displayName: 'YouTube Video',
    aspectRatio: '16:9',
    targetWidth: 1920,
    targetHeight: 1080,
    maxDurationSeconds: 43200, // 12 hours
    hashtagLimit: 15,
    titleMaxLength: 100,
    descriptionMaxLength: 5000,
    supportsCaptionsBurnIn: true,
  },
  instagram_reels: {
    id: 'instagram_reels',
    displayName: 'Instagram Reels',
    aspectRatio: '9:16',
    targetWidth: 1080,
    targetHeight: 1920,
    maxDurationSeconds: 90,
    hashtagLimit: 8,
    titleMaxLength: 80,
    descriptionMaxLength: 2200,
    supportsCaptionsBurnIn: true,
  },
  instagram_feed: {
    id: 'instagram_feed',
    displayName: 'Instagram Post',
    aspectRatio: '4:5',
    targetWidth: 1080,
    targetHeight: 1350,
    maxDurationSeconds: 60,
    hashtagLimit: 10,
    titleMaxLength: 80,
    descriptionMaxLength: 2200,
    supportsCaptionsBurnIn: true,
  },
  linkedin: {
    id: 'linkedin',
    displayName: 'LinkedIn Video',
    aspectRatio: '1:1',
    targetWidth: 1080,
    targetHeight: 1080,
    maxDurationSeconds: 600,
    hashtagLimit: 4,
    titleMaxLength: 120,
    descriptionMaxLength: 3000,
    supportsCaptionsBurnIn: true,
  },
  x_twitter: {
    id: 'x_twitter',
    displayName: 'X (Twitter)',
    aspectRatio: '16:9',
    targetWidth: 1920,
    targetHeight: 1080,
    maxDurationSeconds: 140,
    hashtagLimit: 3,
    titleMaxLength: 100,
    descriptionMaxLength: 280,
    supportsCaptionsBurnIn: true,
  },
};

export interface VideoPublishPackage {
  platform: SocialPlatform;
  titleSuggestions: string[];
  description: string;
  hashtags: string[];
  formattedPostText: string;
  recommendedThumbnailTimestamp: number; // Seconds
}

/**
 * Generate platform-tailored titles, descriptions, and hashtags from video topic keywords & transcript.
 */
export function generatePublishPackage(
  platform: SocialPlatform,
  keywords: string[] = [],
  summary = '',
  totalDuration = 30.0
): VideoPublishPackage {
  const spec = PLATFORM_SPECS[platform] || PLATFORM_SPECS.tiktok;
  const primaryTopic = keywords[0] || 'Content Creation';
  const secondaryTopic = keywords[1] || 'Video Editing';

  // Platform specific title formulas
  const titleSuggestions: string[] = [];
  if (platform === 'youtube_shorts' || platform === 'tiktok' || platform === 'instagram_reels') {
    titleSuggestions.push(`The truth about ${primaryTopic} nobody talks about 🤫`);
    titleSuggestions.push(`Stop doing ${primaryTopic} like this! ❌`);
    titleSuggestions.push(`How to master ${primaryTopic} in 30 seconds ⚡`);
  } else if (platform === 'linkedin') {
    titleSuggestions.push(`3 Key Takeaways on ${primaryTopic} for Modern Creators`);
    titleSuggestions.push(`Why ${primaryTopic} is Transforming Content Strategy in 2026`);
    titleSuggestions.push(`A Practical Guide to Optimizing ${primaryTopic}`);
  } else {
    titleSuggestions.push(`Mastering ${primaryTopic}: Complete Breakdown`);
    titleSuggestions.push(`Why ${primaryTopic} & ${secondaryTopic} Matter More Than Ever`);
    titleSuggestions.push(`How We Scaled Our Workflow with ${primaryTopic}`);
  }

  // Format hashtags
  const defaultTags = ['video', 'editing', 'ai', 'creator', 'modaya'];
  const mergedTags = Array.from(new Set([...keywords.map(k => k.toLowerCase().replace(/\s+/g, '')), ...defaultTags]));
  const hashtags = mergedTags.slice(0, spec.hashtagLimit).map(t => `#${t}`);

  // Build platform description
  const cleanSummary = summary.trim() || `In this video, we break down essential insights on ${primaryTopic} and how to level up your workflow.`;
  const hashtagBlock = hashtags.join(' ');
  
  let formattedPostText = '';
  if (platform === 'x_twitter') {
    formattedPostText = `${titleSuggestions[0]}\n\n${hashtagBlock}`;
    if (formattedPostText.length > spec.descriptionMaxLength) {
      formattedPostText = formattedPostText.slice(0, spec.descriptionMaxLength - 3) + '...';
    }
  } else {
    formattedPostText = `${titleSuggestions[0]}\n\n${cleanSummary}\n\n${hashtagBlock}`;
  }

  // Choose optimal thumbnail timestamp (around 20-30% into video, avoiding first 0.5s fade-in)
  const recommendedThumbnailTimestamp = Math.min(totalDuration * 0.25, Math.max(1.2, totalDuration * 0.15));

  return {
    platform,
    titleSuggestions,
    description: cleanSummary,
    hashtags,
    formattedPostText,
    recommendedThumbnailTimestamp,
  };
}
