/**
 * D4 reliability scoring — pure math, no I/O.
 *
 * Implements the five locked reliability numbers plus the ambiguous-
 * instruction exclusion signal, so Phase 2's reporter only has to collect
 * execution evidence and call these. No judgment calls live here: the
 * timecode check is boundary-vs-anchor math inside the ±0.12s tolerance,
 * order fidelity is array equality, determinism is canonical-JSON equality
 * within (footage, reference, seed) replay groups.
 *
 * Evidence row shape (JSONL, one per instruction execution):
 *   {
 *     pairId:        'p-001',
 *     instruction:   'cut the dead air',
 *     ambiguous:     false,            // not machine-interpretable → excluded from #1/#2
 *     changeRequested: true,           // #2 denominator (did the user ask for a change)
 *     intentMatch:   1,                // rater binary (0|1) — #1
 *     changed:       false,            // execution result — #2 (no-op if false while change requested)
 *     planOrder:     ['a','b'],        // proposed order — #3
 *     executedOrder: ['a','b'],        // actual applied order — #3
 *     clips: [{ startS, endS, flagged? }],   // #4; flagged = explicitly "no measured anchor"
 *     anchors:       [0, 12.0, 40.0],  // measured cuts/onsets in seconds — #4
 *     planJson:      '{...}',          // canonical plan JSON — #5
 *     footageId: 'foot-talk', referenceId: 'ref-x', seed: 's1'   // #5 group key
 *   }
 */
import { mean } from './stats.mjs';
import { exclusionRate, evaluateExclusion, EXCLUSION_LIMIT } from './stats.mjs';

/** D4 #4 tolerance: a boundary must land within 0.12s of a measured anchor. */
export const TC_TOLERANCE_S = 0.12;

/* ── #1 ─────────────────────────────────────────────────────────────────── */

/** Proportion of eligible rows whose edit matched the stated intent. */
export function intentMatch(rows) {
  const xs = rows
    .filter(r => !r.ambiguous && (r.intentMatch === 0 || r.intentMatch === 1))
    .map(r => r.intentMatch);
  return xs.length ? mean(xs) : null;
}

/* ── #2 ─────────────────────────────────────────────────────────────────── */

/** No-op rate: of change-requesting, eligible rows, the fraction that changed nothing. */
export function noOpRate(rows) {
  const xs = rows.filter(r => !r.ambiguous && r.changeRequested === true);
  if (!xs.length) return null;
  return xs.filter(r => r.changed !== true).length / xs.length;
}

/* ── #3 ─────────────────────────────────────────────────────────────────── */

/** Orders are equal when same length and element-wise identical. */
function orderEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

/** Order fidelity: fraction of rows where executed order === proposed order. */
export function orderFidelity(rows) {
  const xs = rows.filter(r => Array.isArray(r.planOrder) && Array.isArray(r.executedOrder));
  if (!xs.length) return null;
  return xs.filter(r => orderEquals(r.planOrder, r.executedOrder)).length / xs.length;
}

/* ── #4 ─────────────────────────────────────────────────────────────────── */

/**
 * A clip's timecodes are valid when every boundary lands on a measured
 * anchor (± TC_TOLERANCE_S) — or when the clip is explicitly flagged as
 * having no measured anchor (honest report beats invention; the flag is
 * data, not an excuse to skip the check).
 */
export function clipTimecodesValid(clip, anchors) {
  if (!clip || ![clip.startS, clip.endS].every(Number.isFinite)) return false;
  if (clip.flagged === true) return true;
  const a = (anchors || []).filter(Number.isFinite);
  const near = (t) => a.some(x => Math.abs(x - t) <= TC_TOLERANCE_S);
  return near(clip.startS) && near(clip.endS);
}

/** Timecode validity: fraction of measured clips that are valid; 0 when none. */
export function timecodeValidity(rows) {
  let total = 0;
  let valid = 0;
  for (const r of rows) {
    const anchors = r.anchors ?? [];
    for (const clip of r.clips ?? []) {
      total++;
      if (clipTimecodesValid(clip, anchors)) valid++;
    }
  }
  return total ? valid / total : null;
}

/* ── #5 ─────────────────────────────────────────────────────────────────── */

/** Canonical JSON: recursively sort object keys, so formatting never breaks determinism. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * Deterministic reproducibility: within each (footage, reference, seed)
 * replay group, the fraction of pairwise plan comparisons that are
 * identical. Rows without a group key or plan are reported, not scored.
 */
export function reproducibility(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.planJson || !r.seed) continue;
    const key = [r.footageId, r.referenceId, r.seed].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  let comparisons = 0;
  let identical = 0;
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        comparisons++;
        let same = false;
        try {
          same = canonicalJson(JSON.parse(group[i].planJson)) ===
                 canonicalJson(JSON.parse(group[j].planJson));
        } catch {
          same = false;   // unparsable plan is not an identical plan
        }
        if (same) identical++;
      }
    }
  }
  return comparisons ? identical / comparisons : null;
}

/* ── Exclusion signal + the combined report ──────────────────────────────── */

/** Fraction of all instructions the system could not machine-interpret. */
export function ambiguousExclusionRate(rows) {
  return exclusionRate(rows.filter(r => r.ambiguous === true).length, rows.length);
}

const ok = (v, min) => v !== null && v >= min;   // missing data never passes a gate

/** The full D4 verdict; every unlocked number must hold, and so must the exclusion signal. */
export function evaluateReliability(rows) {
  const r = {
    intentMatch,
    noOpRate,
    orderFidelity,
    timecodeValidity,
    reproducibility,
  };
  const values = {
    intentMatch: intentMatch(rows),
    noOpRate: noOpRate(rows),
    orderFidelity: orderFidelity(rows),
    timecodeValidity: timecodeValidity(rows),
    reproducibility: reproducibility(rows),
  };
  const exclusion = evaluateExclusion(ambiguousExclusionRate(rows));
  const checks = {
    intentMatch: ok(values.intentMatch, 0.90),
    noOpRate: noOpRate(rows) === null ? false : values.noOpRate <= 0.10,
    orderFidelity: ok(values.orderFidelity, 0.95),
    timecodeValidity: values.timecodeValidity === 1,          // strict: 100%
    reproducibility: ok(values.reproducibility, 0.99),
    exclusionSignal: exclusion !== null && exclusion.pass,
  };
  return {
    values,
    exclusionRate: ambiguousExclusionRate(rows),
    exclusionLimit: EXCLUSION_LIMIT,
    exclusionSignal: exclusion,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}
