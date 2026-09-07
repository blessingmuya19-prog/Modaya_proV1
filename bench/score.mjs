#!/usr/bin/env node
/**
 * Benchmark CLI — merges human ratings and prints the gate report.
 *
 * Usage:
 *   node bench/score.mjs \
 *     --manifest bench/manifest.json \
 *     --ratings bench/results/baseline.jsonl \
 *     [--internal bench/results/internal-scores.jsonl] \
 *     [--baseline-mean 2.9]
 *
 * Ratings JSONL row shape (one per pair × rater):
 *   {"pairId":"p-001","rater":"r1","feel":3,"follow":4,"publish":3,
 *    "why":"The cuts land late compared to the reference.","blind":false}
 *
 * Internal scores JSONL row shape (optional; the honest-score correlation):
 *   {"pairId":"p-001","score":62}
 *
 * Exits 1 when the gate fails, 0 when it passes or --report-only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mean, stdev, agreementWithin1, spearman, evaluateGate,
} from './stats.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const manifestPath = opt('--manifest');
const ratingsPath = opt('--ratings');
const internalPath = opt('--internal');
const baselineMean = Number(opt('--baseline-mean', 'null'));
const reportOnly = args.includes('--report-only');

if (!manifestPath || !ratingsPath) {
  console.error('Usage: node bench/score.mjs --manifest <m.json> --ratings <r.jsonl> [--internal <i.jsonl>] [--baseline-mean N] [--report-only]');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const rows = readFileSync(resolve(ratingsPath), 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean)
  .map(s => JSON.parse(s));

if (!rows.length) {
  console.error(`No ratings in ${ratingsPath}`);
  process.exit(2);
}

const byPair = new Map();
for (const row of rows) {
  const key = row.pairId;
  if (!byPair.has(key)) byPair.set(key, []);
  byPair.get(key).push(row);
}

const validPairs = new Set((manifest.pairs || []).map(p => p.id));
const unknown = [...byPair.keys()].filter(id => !validPairs.has(id));
if (unknown.length) {
  console.error(`Ratings reference unknown pair ids: ${unknown.join(', ')}`);
  process.exit(2);
}

let internalByPair = new Map();
if (internalPath) {
  for (const line of readFileSync(resolve(internalPath), 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    internalByPair.set(row.pairId, row.score);
  }
}

/** Most common one-line "why" across raters (first, if all unique). */
function topWhy(rows) {
  const whys = rows.map(r => (r.why || '').trim()).filter(Boolean);
  if (!whys.length) return null;
  const counts = new Map();
  for (const w of whys) counts.set(w, (counts.get(w) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best[0];
}

const report = {
  run: manifest.name,
  pairsInManifest: manifest.pairs.length,
  rows: rows.length,
  start: new Date().toISOString(),
  // ratings integrity
  raters: [...new Set(rows.map(r => r.rater))].sort(),
  blindRows: rows.filter(r => r.blind).length,
  perPair: [],
  aggregate: null,
  gate: null,
};

for (const pair of manifest.pairs) {
  const rows = byPair.get(pair.id) || [];
  const seen = rows.filter(r => !r.blind);
  const feel = seen.map(r => r.feel);
  const follow = seen.map(r => r.follow);
  const publish = seen.map(r => r.publish);
  const raterVectors = {};
  for (const r of rows) raterVectors[r.rater] = r.feel;
  const entry = {
    pairId: pair.id,
    referenceId: pair.referenceId,
    footageId: pair.footageId,
    nSeen: seen.length,
    feel: mean(feel),
    follow: mean(follow),
    publish: mean(publish),
    feelSD: stdev(feel),
    agreement: agreementWithin1(raterVectors),
    internalScore: internalByPair.get(pair.id) ?? null,
    topWhy: topWhy(rows),
  };
  report.perPair.push(entry);
}

// correlation internal score vs human feel (per pair)
const corrPairs = report.perPair.filter(p => p.internalScore !== null && p.feel !== null);
const correlation = corrPairs.length >= 5
  ? spearman(corrPairs.map(p => p.internalScore), corrPairs.map(p => p.feel))
  : null;

const agg = (k) => {
  const xs = report.perPair.map(p => p[k]).filter(v => v !== null && v !== undefined);
  return mean(xs);
};

/* mean agreement across pairs (null-safe) */
const agreements = report.perPair.map(p => p.agreement).filter(v => v !== null);
const agreement = mean(agreements);

report.aggregate = {
  pairsRated: report.perPair.filter(p => p.nSeen > 0).length,
  meanFeel: agg('feel'),
  meanFollow: agg('follow'),
  meanPublish: agg('publish'),
  meanAgreement: agreement,
  internalVsHumanSpearman: correlation,
  internalPairs: corrPairs.length,
  baselineMeanFeel: Number.isFinite(baselineMean) ? baselineMean : null,
};

report.gate = evaluateGate({
  feelMean: report.aggregate.meanFeel,
  baselineFeelMean: report.aggregate.baselineMeanFeel,
  agreement: agreement,
});

console.log(JSON.stringify(report, null, 2));

if (!reportOnly) process.exit(report.gate.pass ? 0 : 1);
