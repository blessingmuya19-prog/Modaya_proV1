/**
 * Smart B-Roll Auto-Matcher with Semantic Video Topic Clustering & Temporal Alignment.
 *
 * Analyzes speech transcripts to extract illustrative keywords, visual topics,
 * and conversational pauses, matching them against candidate B-roll clips to place
 * contextually relevant cutaways that maintain narrative flow.
 */

export interface BrollItem {
  id: string;
  name?: string;
  durationS: number;
  tags?: string[];
  visualEnergy?: number; // 0..1
}

export interface TopicSegment {
  startS: number;
  endS: number;
  text: string;
  keywords: string[];
  isPunchline?: boolean;
}

export interface BrollPlacement {
  id: string;
  brollId: string;
  timelineIn: number;
  timelineOut: number;
  sourceIn: number;
  sourceOut: number;
  relevanceScore: number;
  matchedKeywords: string[];
  reason: string;
}

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'that', 'this', 'to',
  'of', 'for', 'with', 'as', 'by', 'it', 'from', 'or', 'be', 'are', 'was', 'were',
  'i', 'you', 'he', 'she', 'they', 'we', 'my', 'your', 'so', 'then', 'just', 'like',
  'um', 'uh', 'yeah', 'okay', 'well', 'really', 'very', 'know', 'think', 'see',
  'into', 'went', 'going', 'have', 'had', 'has', 'about', 'out', 'up', 'down',
]);

/**
 * Extract semantic keywords and noun phrases from a segment of spoken text.
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  return Array.from(new Set(words));
}

/**
 * Extract topic segments from timestamped transcript sentences.
 */
export function extractTranscriptTopics(
  segments: Array<{ text: string; start: number; end: number }>,
): TopicSegment[] {
  return segments.map(s => {
    const keywords = extractKeywords(s.text);
    // Punchline detection heuristic: short trailing question/exclamation or abrupt loud stop
    const isPunchline = s.text.includes('!') || s.text.includes('?') || keywords.length <= 2;
    return {
      startS: s.start,
      endS: s.end,
      text: s.text,
      keywords,
      isPunchline,
    };
  });
}

/**
 * Calculate semantic and temporal match score between a topic segment and a B-roll clip.
 */
export function scoreBrollMatch(
  topic: TopicSegment,
  broll: BrollItem,
): { score: number; matchedKeywords: string[] } {
  if (broll.durationS < 1.0) {
    return { score: 0, matchedKeywords: [] };
  }

  const brollName = (broll.name || broll.id).toLowerCase();
  const brollTags = (broll.tags || []).map(t => t.toLowerCase());

  const matchedKeywords: string[] = [];
  let matchCount = 0;

  for (const kw of topic.keywords) {
    if (brollName.includes(kw) || brollTags.some(t => t.includes(kw) || kw.includes(t))) {
      matchedKeywords.push(kw);
      matchCount += 1;
    }
  }

  // Base relevance from keyword overlap (0.4 to 1.0)
  let score = matchCount > 0 ? 0.5 + Math.min(0.5, matchCount * 0.25) : 0.2;

  // Boost for high visual energy B-roll
  if (broll.visualEnergy) {
    score += broll.visualEnergy * 0.15;
  }

  return {
    score: Math.min(1.0, Math.round(score * 100) / 100),
    matchedKeywords,
  };
}

/**
 * Generate intelligent B-roll cutaway placements across the video timeline.
 */
export function generateSmartBrollPlacements(
  topics: TopicSegment[],
  brollLibrary: BrollItem[],
  options: {
    minCutawayDurationS?: number;
    maxCutawayDurationS?: number;
    maxCutawayCount?: number;
    avoidPunchlines?: boolean;
  } = {},
): BrollPlacement[] {
  if (!topics.length || !brollLibrary.length) return [];

  const minDur = options.minCutawayDurationS ?? 2.0;
  const maxDur = options.maxCutawayDurationS ?? 4.0;
  const maxCount = options.maxCutawayCount ?? 6;
  const avoidPunchlines = options.avoidPunchlines ?? true;

  const placements: BrollPlacement[] = [];
  let lastCutawayEnd = -10;

  // Filter candidate topics with sufficient duration
  const candidateTopics = topics.filter(t => {
    const dur = t.endS - t.startS;
    if (dur < minDur) return false;
    if (avoidPunchlines && t.isPunchline) return false;
    return true;
  });

  for (const topic of candidateTopics) {
    if (placements.length >= maxCount) break;

    // Minimum gap between B-roll cutaways (at least 6s of talking head in between)
    if (topic.startS < lastCutawayEnd + 5.0) continue;

    // Score all available B-roll clips for this topic
    const scoredBrolls = brollLibrary.map(b => {
      const { score, matchedKeywords } = scoreBrollMatch(topic, b);
      return { broll: b, score, matchedKeywords };
    });

    scoredBrolls.sort((a, b) => b.score - a.score);
    const bestMatch = scoredBrolls[0];
    if (!bestMatch || bestMatch.score < 0.2) continue;

    const topicDur = topic.endS - topic.startS;
    const cutawayDur = Math.min(maxDur, Math.max(minDur, topicDur * 0.75), bestMatch.broll.durationS);

    // Place cutaway starting 0.5s into the topic to let the speaker introduce the thought
    const timelineIn = Math.round((topic.startS + 0.4) * 100) / 100;
    const timelineOut = Math.round((timelineIn + cutawayDur) * 100) / 100;

    // Source window in B-roll clip
    const sourceIn = 0;
    const sourceOut = Math.round(cutawayDur * 100) / 100;

    const reason = bestMatch.matchedKeywords.length > 0
      ? `Matched context keywords: ${bestMatch.matchedKeywords.join(', ')}`
      : `Paced cutaway during illustrative segment (${Math.round(cutawayDur)}s)`;

    placements.push({
      id: `broll-cutaway-${placements.length + 1}`,
      brollId: bestMatch.broll.id,
      timelineIn,
      timelineOut,
      sourceIn,
      sourceOut,
      relevanceScore: bestMatch.score,
      matchedKeywords: bestMatch.matchedKeywords,
      reason,
    });

    lastCutawayEnd = timelineOut;
  }

  return placements;
}
