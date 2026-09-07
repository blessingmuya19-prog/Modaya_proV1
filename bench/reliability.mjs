#!/usr/bin/env node
/**
 * D4 reliability CLI — the Phase 2 measuring stick.
 *
 * Usage:
 *   node bench/reliability.mjs --corpus bench/reliability.example.jsonl \
 *     [--report-only]
 *
 * Corpus: one evidence row per instruction execution (see
 * bench/reliability-stats.mjs for the row shape). The report prints all five
 * D4 numbers with their denominators, the ambiguous-instruction exclusion
 * rate, and the verdict. Exits 1 when any check fails (or data is missing
 * for a check) unless --report-only.
 *
 * This is measurement only: no pipeline is wired to it yet. The moment Phase
 * 2 can emit plan + executed-order + clip evidence, the same report becomes
 * the Phase 2 exit gate.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateReliability } from './reliability-stats.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const reportOnly = args.includes('--report-only');

const corpusPath = opt('--corpus');
if (!corpusPath) {
  console.error('Usage: node bench/reliability.mjs --corpus <evidence.jsonl> [--report-only]');
  process.exit(2);
}

const rows = readFileSync(resolve(corpusPath), 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean)
  .map(s => JSON.parse(s));

if (!rows.length) {
  console.error(`No evidence rows in ${corpusPath}`);
  process.exit(2);
}

const report = evaluateReliability(rows);
const fmt = (v) => v === null ? 'n/a (no data)' : `${(v * 100).toFixed(1)}%`;
const pct = (v) => v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;

console.log(JSON.stringify({
  runs: rows.length,
  d4: {
    '1_intent_match_ge_90': {
      value: report.values.intentMatch, display: pct(report.values.intentMatch),
      pass: report.checks.intentMatch,
    },
    '2_no_op_le_10': {
      value: report.values.noOpRate, display: pct(report.values.noOpRate),
      pass: report.checks.noOpRate,
    },
    '3_order_fidelity_ge_95': {
      value: report.values.orderFidelity, display: pct(report.values.orderFidelity),
      pass: report.checks.orderFidelity,
    },
    '4_timecode_validity_100': {
      value: report.values.timecodeValidity, display: pct(report.values.timecodeValidity),
      pass: report.checks.timecodeValidity,
    },
    '5_reproducibility_ge_99': {
      value: report.values.reproducibility, display: pct(report.values.reproducibility),
      pass: report.checks.reproducibility,
    },
    ambiguous_exclusion_rate: {
      value: report.exclusionRate, display: fmt(report.exclusionRate),
      limit: report.exclusionLimit,
      signal: report.exclusionSignal,
      pass: report.checks.exclusionSignal,
    },
  },
  gate: { pass: report.pass },
}, null, 2));

if (!reportOnly) process.exit(report.pass ? 0 : 1);
