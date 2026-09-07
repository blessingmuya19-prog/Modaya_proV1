#!/usr/bin/env node
/**
 * Rater sheet generator — turns the pair manifest into 5 ready-to-fill,
 * individually shuffled rating sheets plus empty JSONL rows for score.mjs.
 *
 * Usage:
 *   node bench/make-rater-sheets.mjs --manifest bench/manifest.example.json \
 *     [--raters r1,r2,r3,r4,r5] [--seed 42] [--out bench/ratings/]
 *
 * Output (committed when generated — it's the evidence):
 *   bench/ratings/<rater>.sheet.tsv   human sheet (pairs shuffled per rater)
 *   bench/ratings/<rater>.jsonl       empty rows: pairId,rater,feel,follow,
 *                                     publish,why,blind — one per pair
 *
 * Deterministic: the same manifest + seed always gives the same shuffle, so
 * regeneration never invalidates existing ratings.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const manifestPath = opt('--manifest');
if (!manifestPath) {
  console.error('Usage: node bench/make-rater-sheets.mjs --manifest <m.json> [--raters r1,r2,r3,r4,r5] [--seed 42] [--out bench/ratings/]');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const raters = (opt('--raters', 'r1,r2,r3,r4,r5') || '').split(',').map(s => s.trim()).filter(Boolean);
const seed = Number(opt('--seed', '42'));
const outDir = opt('--out', resolve('bench/ratings'));

if (!raters.length || !manifest.pairs?.length) {
  console.error('Need at least one rater and one pair in the manifest.');
  process.exit(2);
}

/** Deterministic PRNG (mulberry32) — same seed, same shuffle, forever. */
function rng(seedValue) {
  let a = seedValue >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(xs, seedValue) {
  const rand = rng(seedValue);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

mkdirSync(outDir, { recursive: true });

for (const [i, rater] of raters.entries()) {
  const pairs = shuffled(manifest.pairs, seed + i * 7919);
  const header = [
    '# pairId', 'referenceId', 'footageId', 'instruction',
    'feel (1-5)', 'follow (1-5)', 'publish (1-5)', 'why (one sentence)',
  ].join('\t');
  const lines = pairs.map(p => [
    p.id, p.referenceId, p.footageId,
    (manifest.instruction || 'Match this reference\'s pacing, captions and emphasis on my footage.'),
    '', '', '', '',
  ].join('\t'));
  writeFileSync(join(outDir, `${rater}.sheet.tsv`), [header, ...lines].join('\n') + '\n');

  const rows = pairs.map(p => JSON.stringify({
    pairId: p.id, rater,
    feel: null, follow: null, publish: null, why: '', blind: false,
  }));
  writeFileSync(join(outDir, `${rater}.jsonl`), rows.join('\n') + '\n');
  console.log(`${rater}: ${pairs.length} pairs → ${join(outDir, `${rater}.sheet.tsv`)}`);
}

console.log(`\n${raters.length} sheets generated (seed ${seed}). Fill them, then:\n` +
  `  cat bench/ratings/*.jsonl > bench/results/<run>.jsonl\n` +
  `  node bench/score.mjs --manifest ${manifestPath} --ratings bench/results/<run>.jsonl`);
