/**
 * Semantic asset router: request semantics → asset vectors → cosine ranking.
 * Deterministic and inspectable — no black-box embeddings.
 */
import { describe, it, expect } from 'vitest';
import {
  semanticVectorFor, demandedTags, cosine,
  rankAssetsFor, semanticPickText,
} from '@/lib/ai/assetRouter';
import type { AssetInfo } from '@/lib/ai/assetTags';

const KIT: AssetInfo[] = [
  { name: 'swish_04.wav', mimeType: 'audio/wav', durationS: 0.4 },
  { name: 'boom_hit.mp3', mimeType: 'audio/mpeg', durationS: 0.8 },
  { name: 'ambient-pad.mp3', mimeType: 'audio/mpeg', durationS: 30 },
  { name: 'logo.png', mimeType: 'image/png' },
  { name: 'city-broll.mp4', mimeType: 'video/mp4', durationS: 8 },
];

describe('semanticVectorFor', () => {
  it('reads swish names as fast visual-slide transitions', () => {
    const v = semanticVectorFor(KIT[0]);
    expect(v.transition).toBe(1);
    expect(v.visual_slide).toBe(1);
    expect(v.forward_motion).toBe(1);
    expect(v.fast).toBe(1);
  });

  it('does not over-tag a music bed', () => {
    const v = semanticVectorFor(KIT[2]);
    expect(v.calm).toBe(1);
    expect(v.transition).toBe(0.5);             // generic audio implies, never asserts
    expect(v.visual_slide).toBeUndefined();     // that needs the name to say it
  });
});

describe('demandedTags', () => {
  it('parses the request into the same controlled vocabulary', () => {
    const d = demandedTags('put a fast whoosh transition on the slide');
    expect(d.transition).toBe(1);
    expect(d.fast).toBe(1);
    expect(d.whoosh).toBe(1);
  });
});

describe('rankAssetsFor', () => {
  it('picks swish_04 for a fast slide — above the generic audio types', () => {
    const ranked = rankAssetsFor(KIT, 'give me a fast visual slide transition');
    expect(ranked[0].name).toBe('swish_04.wav');
  });

  it('picks the boom for drama and the bed for calm', () => {
    expect(rankAssetsFor(KIT, 'dramatic impact')[0].name).toBe('boom_hit.mp3');
    expect(rankAssetsFor(KIT, 'slow calm ambient')[0].name).toBe('ambient-pad.mp3');
  });

  it('returns nothing when the request has no semantic tags', () => {
    expect(rankAssetsFor(KIT, 'add captions please')).toEqual([]);
  });
});

describe('cosine / semanticPickText', () => {
  it('scores identical vectors 1 and orthogonal vectors 0', () => {
    const v = { transition: 1, fast: 1 };
    expect(cosine(v, { ...v })).toBeGreaterThan(0.999);
    expect(cosine(v, { calm: 1, slow: 1 })).toBe(0);
  });

  it('names the best asset in the context block', () => {
    const line = semanticPickText(KIT, 'fast visual slide transition')!;
    expect(line).toContain('"swish_04.wav"');
    expect(line).toMatch(/\d\.\d\d/);   // score, so it is verifiable
    expect(line).toContain('transition');
  });

  it('is silent when nothing matches', () => {
    expect(semanticPickText(KIT, 'just caption it')).toBeNull();
  });
});
