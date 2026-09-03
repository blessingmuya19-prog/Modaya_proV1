/**
 * AI Video Storyboard, Chaptering & Visual Cue Generator.
 *
 * Provides semantic chapter segmentation, viral hook discovery,
 * structured visual storyboard cards, and B-roll shot recommendations
 * from video transcripts.
 *
 * Fully deterministic and zero-dependency.
 */

export type StoryboardShotType =
  | 'close_up'
  | 'wide_establishing'
  | 'screen_recording'
  | 'motion_graphic'
  | 'reaction_cut'
  | 'product_detail';

export interface StoryboardCard {
  id: string;
  timestampStartS: number;
  timestampEndS: number;
  chapterTitle: string;
  dialogueSnippet: string;
  recommendedShotType: StoryboardShotType;
  visualDescription: string;
  brollSearchQuery: string;
  onScreenGraphicText?: string;
  mood: 'energetic' | 'informative' | 'dramatic' | 'playful';
}

export interface VideoChapter {
  id: string;
  title: string;
  startS: number;
  endS: number;
  summary: string;
  keyTakeaway: string;
  isHookChapter?: boolean;
}

export interface VideoStoryboardPackage {
  chapters: VideoChapter[];
  cards: StoryboardCard[];
  viralHookSummary: string;
  totalDurationS: number;
}

export interface TranscriptLineItem {
  start: number;
  end: number;
  text: string;
}

/**
 * Generate semantic chapters from transcript lines.
 */
export function generateSemanticChapters(
  transcript: TranscriptLineItem[] = [],
  totalDurationS = 60.0
): VideoChapter[] {
  if (!transcript.length) {
    return [
      {
        id: 'chap-1',
        title: 'Full Video',
        startS: 0,
        endS: totalDurationS,
        summary: 'Complete video recording.',
        keyTakeaway: 'Overview of main topic.',
        isHookChapter: true,
      },
    ];
  }

  const chapters: VideoChapter[] = [];
  const minChapterDuration = Math.max(10.0, totalDurationS / 5);
  let curChapterLines: TranscriptLineItem[] = [];
  let chapterIndex = 1;

  for (let i = 0; i < transcript.length; i++) {
    curChapterLines.push(transcript[i]);
    const chapterStart = curChapterLines[0].start;
    const chapterEnd = transcript[i].end;
    const elapsed = chapterEnd - chapterStart;

    if (elapsed >= minChapterDuration || i === transcript.length - 1) {
      const allText = curChapterLines.map(l => l.text).join(' ');
      const words = allText.split(/\s+/).slice(0, 5).join(' ');
      const isHook = chapterIndex === 1;

      chapters.push({
        id: `chap-${chapterIndex}`,
        title: isHook ? `Hook: ${words}...` : `Chapter ${chapterIndex}: ${words}...`,
        startS: parseFloat(chapterStart.toFixed(2)),
        endS: parseFloat(chapterEnd.toFixed(2)),
        summary: allText.slice(0, 160) + (allText.length > 160 ? '...' : ''),
        keyTakeaway: curChapterLines[Math.floor(curChapterLines.length / 2)]?.text || allText.slice(0, 80),
        isHookChapter: isHook,
      });

      chapterIndex++;
      curChapterLines = [];
    }
  }

  return chapters;
}

/**
 * Generate visual storyboard cards and shot suggestions across timeline.
 */
export function generateStoryboardCards(
  chapters: VideoChapter[],
  transcript: TranscriptLineItem[] = []
): StoryboardCard[] {
  const cards: StoryboardCard[] = [];
  let cardIdCounter = 1;

  for (const chapter of chapters) {
    const chapterLines = transcript.filter(
      l => l.start >= chapter.startS - 0.05 && l.end <= chapter.endS + 0.05
    );

    const targetLines = chapterLines.length
      ? chapterLines
      : [{ start: chapter.startS, end: chapter.endS, text: chapter.summary }];

    for (let idx = 0; idx < targetLines.length; idx++) {
      const line = targetLines[idx];
      const textLower = line.text.toLowerCase();

      let shotType: StoryboardShotType = 'close_up';
      let mood: StoryboardCard['mood'] = 'informative';
      let brollQuery = 'person talking camera';
      let graphicText: string | undefined;

      if (chapter.isHookChapter && idx === 0) {
        shotType = 'wide_establishing';
        mood = 'energetic';
        brollQuery = 'dynamic cinematic video opening hook';
        graphicText = 'WATCH THIS';
      } else if (textLower.includes('code') || textLower.includes('app') || textLower.includes('computer') || textLower.includes('software')) {
        shotType = 'screen_recording';
        mood = 'informative';
        brollQuery = 'laptop screen software workflow typing hands';
      } else if (textLower.includes('money') || textLower.includes('growth') || textLower.includes('percent') || textLower.includes('revenue')) {
        shotType = 'motion_graphic';
        mood = 'energetic';
        brollQuery = 'financial growth upward stock chart graphic';
        graphicText = '3X RESULTS';
      } else if (textLower.includes('secret') || textLower.includes('mistake') || textLower.includes('stop')) {
        shotType = 'reaction_cut';
        mood = 'dramatic';
        brollQuery = 'dramatic shocked expression zoom';
        graphicText = 'WARNING';
      } else {
        shotType = 'product_detail';
        mood = 'playful';
        brollQuery = 'modern clean creative workspace';
      }

      cards.push({
        id: `card-${cardIdCounter++}`,
        timestampStartS: parseFloat(line.start.toFixed(2)),
        timestampEndS: parseFloat(line.end.toFixed(2)),
        chapterTitle: chapter.title,
        dialogueSnippet: line.text,
        recommendedShotType: shotType,
        visualDescription: `Cutaway illustration matching: "${line.text.slice(0, 60)}"`,
        brollSearchQuery: brollQuery,
        onScreenGraphicText: graphicText,
        mood,
      });
    }
  }

  return cards;
}

/**
 * Generate complete storyboard package from raw video transcript.
 */
export function buildVideoStoryboard(
  transcript: TranscriptLineItem[] = [],
  totalDurationS = 60.0
): VideoStoryboardPackage {
  const chapters = generateSemanticChapters(transcript, totalDurationS);
  const cards = generateStoryboardCards(chapters, transcript);

  const hookChapter = chapters.find(c => c.isHookChapter) || chapters[0];
  const viralHookSummary = hookChapter
    ? `Strong opening hook focused on: "${hookChapter.summary.slice(0, 100)}"`
    : 'Engaging introduction.';

  return {
    chapters,
    cards,
    viralHookSummary,
    totalDurationS,
  };
}
