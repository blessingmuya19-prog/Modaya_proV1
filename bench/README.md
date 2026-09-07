# Modaya Reference-Match Benchmark (Phase 0)

**Goal:** before any rebuild code, get a **human-rated baseline** of how well the
current pipeline matches a reference — and prove or kill the internal match score
with real data. Reference matching is only trusted after this set says it should be.

---

## What gets measured

Each **pair** is `(reference video, user footage, fixed instruction)`. The
pipeline produces an edit; five raters score it on three scales:

| Axis | Question (rater) | 1 | 5 |
|---|---|---|---|
| **Feel-match** | Does this feel like the reference — pacing, emphasis, captions, grade? | Nothing alike | Feels like the same editor made it |
| **Instruction-follow** | Does the edit do what the instruction asked? | Missed it | Exactly as asked |
| **Publish quality** | Would you publish this? | No | Yes, as-is |

Plus a fourth, one-line **why** (free text) — that's the qualitative signal the
numeric axis can't carry.

## Pair set (v1): 12 references × 3 footage = 36 edits

- **References (12):** 4 short-form vertical (fast cuts, captions), 3
  talking-head podcast (steady, cuts on speech), 3 fast-cut montage, 2 calm
  cinematic interview.
- **Footage (3):** one long talking-head (60+ min), one medium vlog (10–20 min),
  one multi-camera interview (30–60 min), each edited against **all 12
  references**.
- **Instruction (fixed for every pair):** *"Match this reference's pacing,
  captions and emphasis on my footage."* — one instruction, so the axis under
  test is reference-matching, not instruction-following (that's part of D4).

## Gate

The new approach replaces the old **only when**:
1. Mean feel-match **≥ 3.5/5** on the 36 pairs, **and**
2. It **beats the old pipeline's baseline** on the same pairs by a margin
   (≥ +0.3 mean feel-match), **and**
3. Rater agreement is usable (pairwise agreement ≥ 0.6 — see `bench/README`),
   and
4. We record the **correlation between the internal match score and human
   feel-match** — if it's not strongly positive, the honest fix is to say so,
   not to trust the number.

## File layout

```
bench/
  README.md            ← you are here (rater instructions below)
  manifest.example.json ← pair manifest schema + example
  stats.mjs            ← pure scoring math (mean, agreement, Spearman)
  score.mjs            ← CLI: merge ratings, produce the report
  media/               ← PUT FILES HERE (gitignored): refs-/footage-/
  results/             ← per-run ratings JSONL (committed — it's the evidence)
```

## How to run

```bash
# 1. Put media in place
bench/media/refs/ref-01-*.mp4 ... bench/media/footage/foot-01-*.mp4

# 2. Fill the manifest (or copy manifest.example.json → manifest.json)
#    - list each reference + footage file with durationS
#    - ids must match filenames

# 3. Produce edits with the CURRENT pipeline (any way that works — the Studio
#    chat, the deterministic composer, or the spike) and export each plan.

# 4. Rate: five raters fill results/<run>.jsonl rows (one per pair × rater)
#    using the schema in score.mjs. Edit-only answers are fine — no video
#    review needed for a plan-level feel-match, but video review is better
#    for publish quality.

# 5. Report
node bench/score.mjs --manifest bench/manifest.json --ratings bench/results/baseline.jsonl
```

## Rater instructions (paste into the sheet)

> You are rating AI video edits against a reference. You did not make the
> edits and you do not know which pipeline made them.
>
> 1. Watch the reference (or its selected section). Note its pacing, where
>    emphasis lands, captions, colour and cut feel.
> 2. Watch the edit of the new footage.
> 3. Score 1–5 on the three axes. 3 = "recognisable attempt, not quite".
>    Free-text why: one sentence on the single biggest difference.
> 4. Do not score what you cannot see. If audio/frames were unavailable,
>    mark the row `"blind": true` — blind rows are excluded from feel-match.

---

*Phase 0 ownership: build the harness, record the baseline. Nothing in the product
changes until the gate passes.*
