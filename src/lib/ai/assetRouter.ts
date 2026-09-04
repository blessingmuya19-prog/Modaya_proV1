/**
 * Semantic asset router — the "semantic mapping" between a reference request
 * ("fast visual slide at 00:08") and the user's kit ("swish_04.wav").
 *
 * The honest version of embedding similarity without an embedding API:
 * every asset gets a semantic tag VECTOR from a controlled vocabulary keyed
 * off its name/type, and a request gets a demanded-tag vector parsed from
 * the user's own words; the best asset is the highest cosine. Deterministic,
 * zero-dependency, testable — and the vectors are inspectable, so a bad pick
 * can be explained instead of blamed on a black box.
 */
import type { AssetInfo } from './assetTags';

/** The vocabulary. Every word here is meaningful in an edit-brief. */
export const SEMANTIC_TAGS = [
  'transition', 'energy', 'fast', 'slow', 'visual_slide', 'forward_motion',
  'dramatic', 'warning', 'comedic', 'calm', 'impact', 'whoosh', 'rise', 'fall',
  'text', 'highlight', 'logo', 'b-roll', 'nature', 'city', 'clean', 'money',
] as const;

export type SemanticTag = typeof SEMANTIC_TAGS[number];

export type TagVector = Partial<Record<SemanticTag, number>>;

/* ── asset → semantic vector ────────────────────────────────────────────── */

const NAME_MAP: Array<[RegExp, SemanticTag[], number]> = [
  [/(swoosh|swish|whoosh|slide|transition|wipe|whip)/, ['transition', 'whoosh', 'visual_slide', 'forward_motion', 'fast'], 1],
  [/(impact|boom|hit|stinger|punch|thud|drop)/,        ['impact', 'dramatic', 'energy'], 1],
  [/(riser|rise|build|upsweep)/,                        ['rise', 'energy', 'dramatic'], 1],
  [/(fall|down|drop|descend|downward)/,                 ['fall', 'transition'], 1],
  [/(whoop|sweep|zen|ambient|pad|drone)/,               ['calm', 'slow'], 1],
  [/(warning|alert|alarm|danger|error)/,                ['warning', 'dramatic', 'text'], 1],
  [/(comedy|funny|laugh|cartoon|boing)/,                ['comedic', 'energy'], 1],
  [/(logo|icon|brand|stamp|watermark)/,                 ['logo', 'text', 'clean'], 1],
  [/(highlight|accent|callout|arrow|pointer)/,          ['highlight', 'text'], 1],
  [/(title|headline|label|font|type|text)/,             ['text', 'highlight'], 1],
  [/(nature|forest|ocean|sky|landscape|mount)/,         ['nature', 'calm'], 1],
  [/(city|street|urban|traffic|downtown)/,              ['city', 'energy'], 1],
  [/(money|cash|dollar|wealth|profit)/,                 ['money', 'dramatic'], 1],
  [/(b-?roll|cutaway|footage|shot)/,                    ['b-roll'], 1],
];

/** An asset's semantic vector — tags from its name/type, weight 1 (or 0.6
 *  when only the generic type implies it). */
export function semanticVectorFor(a: AssetInfo): TagVector {
  const name = (a.name ?? '').toLowerCase();
  const mime = (a.mimeType ?? '').toLowerCase();
  const out: TagVector = {};
  for (const [re, tags, w] of NAME_MAP) {
    if (re.test(name)) for (const t of tags) out[t] = Math.max(out[t] ?? 0, w);
  }
  if (mime.startsWith('image/')) { out.text = Math.max(out.text ?? 0, 0.6); out.logo = Math.max(out.logo ?? 0, 0.4); }
  if (mime.startsWith('audio/')) { out.transition = Math.max(out.transition ?? 0, 0.5); }
  if (mime.startsWith('video/')) { out['b-roll'] = Math.max(out['b-roll'] ?? 0, 0.6); }
  return out;
}

/** User's words → demanded tags. The same controlled vocabulary, so a
 *  request never asks for a tag the kit cannot carry. */
export function demandedTags(text: string): TagVector {
  const s = text.toLowerCase();
  const out: TagVector = {};
  const hit = (re: RegExp, tags: SemanticTag[]) => { if (re.test(s)) for (const t of tags) out[t] = 1; };
  hit(/(slide|swoosh|whoosh|wipe|transition)/, ['transition', 'visual_slide', 'whoosh', 'fast', 'forward_motion']);
  hit(/(fast|quick|snappy|rapid|energetic|aggressive|punchy)/, ['fast', 'energy', 'impact']);
  hit(/(slow|calm|smooth|gentle|soft)/, ['slow', 'calm']);
  hit(/(drama|dramatic|serious|tense|intense|big moment)/, ['dramatic', 'energy', 'impact']);
  hit(/(funny|comedy|laugh|joke)/, ['comedic', 'energy']);
  hit(/(warning|alert|danger|error)/, ['warning']);
  hit(/(logo|brand)/, ['logo']);
  hit(/(highlight|emphas\w+|callout|text|title)/, ['highlight', 'text']);
  hit(/(money|cash|profit|wealth)/, ['money']);
  return out;
}

/* ── scoring ────────────────────────────────────────────────────────────── */

const TAGS = SEMANTIC_TAGS;

export function cosine(a: TagVector, b: TagVector): number {
  let dot = 0, na = 0, nb = 0;
  for (const t of TAGS) {
    const x = a[t] ?? 0, y = b[t] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Rank the kit against a request. Returns the semantic pick line for the
 *  context block — the model can NAME the asset instead of guessing. */
export function rankAssetsFor(
  assets: AssetInfo[], text: string,
): Array<{ name: string; score: number; tags: SemanticTag[] }> {
  const need = demandedTags(text);
  if (!Object.keys(need).length) return [];
  return assets
    .map(a => {
      const v = semanticVectorFor(a);
      const score = cosine(v, need);
      const tags = TAGS.filter(t => (v[t] ?? 0) >= 1);
      return { name: a.name, score: Number(score.toFixed(2)), tags };
    })
    .filter(r => r.score > 0.12)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5);
}

/** The context-block line: which asset fits the request's semantics. */
export function semanticPickText(assets: AssetInfo[], text: string): string | null {
  const ranked = rankAssetsFor(assets, text);
  if (!ranked.length) return null;
  const top = ranked[0];
  const rest = ranked.slice(1, 4).map(r => `${r.name} (${r.score})`).join(', ');
  const line = `best semantic asset for this request: "${top.name}" (${top.score})` +
    ` — matches [${top.tags.join(', ')}]`;
  return rest ? `${line}; also ${rest}` : line;
}
