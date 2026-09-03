import { describe, it, expect } from 'vitest';
import {
  extractKeywords,
  extractTranscriptTopics,
  scoreBrollMatch,
  generateSmartBrollPlacements,
} from '@/lib/ai/brollMatcher';

describe('smart B-roll auto-matcher & semantic topic clustering', () => {
  it('extracts clean semantic keywords and filters common stopwords', () => {
    const text = 'And then we went into the coffee shop and started coding in Python';
    const keywords = extractKeywords(text);
    expect(keywords).toContain('coffee');
    expect(keywords).toContain('shop');
    expect(keywords).toContain('coding');
    expect(keywords).toContain('python');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('and');
    expect(keywords).not.toContain('into');
  });

  it('scores B-roll relevance based on keyword match and tag overlap', () => {
    const topic = {
      startS: 10,
      endS: 16,
      text: 'Here is a chart showing our massive revenue growth',
      keywords: ['chart', 'showing', 'massive', 'revenue', 'growth'],
    };

    const broll1 = {
      id: 'broll-finance',
      name: 'financial_growth_chart.mp4',
      durationS: 10,
      tags: ['finance', 'growth', 'charts'],
      visualEnergy: 0.8,
    };

    const broll2 = {
      id: 'broll-nature',
      name: 'forest_trees.mp4',
      durationS: 8,
      tags: ['nature', 'trees', 'outdoor'],
    };

    const match1 = scoreBrollMatch(topic, broll1);
    const match2 = scoreBrollMatch(topic, broll2);

    expect(match1.score).toBeGreaterThan(match2.score);
    expect(match1.matchedKeywords).toContain('chart');
    expect(match1.matchedKeywords).toContain('growth');
  });

  it('generates non-overlapping, well-paced B-roll cutaway placements', () => {
    const topics = [
      { startS: 2.0, endS: 8.0, text: 'We built an incredible AI application in Python', keywords: ['built', 'incredible', 'application', 'python'] },
      { startS: 10.0, endS: 12.0, text: 'Boom!', keywords: ['boom'], isPunchline: true },
      { startS: 14.0, endS: 22.0, text: 'Look at the server telemetry charts running smoothly', keywords: ['server', 'telemetry', 'charts', 'running', 'smoothly'] },
    ];

    const library = [
      { id: 'broll-code', name: 'python_code_screen.mp4', durationS: 12, tags: ['coding', 'python', 'tech'] },
      { id: 'broll-server', name: 'datacenter_server_racks.mp4', durationS: 15, tags: ['server', 'tech'] },
    ];

    const placements = generateSmartBrollPlacements(topics, library, {
      minCutawayDurationS: 2.0,
      maxCutawayDurationS: 4.0,
      avoidPunchlines: true,
    });

    expect(placements).toHaveLength(2);

    // First cutaway placed in the first topic
    expect(placements[0].brollId).toBe('broll-code');
    expect(placements[0].timelineIn).toBeGreaterThanOrEqual(2.0);
    expect(placements[0].timelineOut).toBeLessThanOrEqual(8.0);
    expect(placements[0].matchedKeywords).toContain('python');

    // Punchline at 10.0s should be avoided, next placement in 3rd topic
    expect(placements[1].brollId).toBe('broll-server');
    expect(placements[1].timelineIn).toBeGreaterThanOrEqual(14.0);
  });
});
