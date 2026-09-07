# Baseline sourcing plan — media + five raters

**Status:** the only item on the critical path. Engineering keeps moving
without it; nothing about "new beats old" can be claimed until this lands.
This document makes the media and rater sourcing as cheap and fast as it can
be — it does not change the locked design (36 pairs, 5 raters, D2 gate).

---

## 1. What the media actually requires

Twelve references + three footage files. The **footage files are the heavy
part** — the pipeline analyses the whole file even though raters only watch
the edit.

### References (12 files, small)

| Id | File name | Category | Spec | Real duration | Notes |
|---|---|---|---|---|---|
| ref-short-01..04 | `short-0N.mp4` | short-form vertical | 9:16, 1080×1920, 30–60s | 45 / 40 / 52 / 38s | must show captions (reference "caption style" is a test axis) |
| ref-talk-01..03 | `talk-0N.mp4` | talking-head podcast | 16:9, 10 min any res ≥720p | 600 / 720 / 540s | **must have real speech** — transcript + captions depend on it; raters watch `rangeS [0,60]` |
| ref-mont-01..03 | `mont-0N.mp4` | fast-cut montage | 16:9 or 9:16, 30–45s | 35 / 30 / 42s | many cuts, music is fine |
| ref-cine-01..02 | `cine-0N.mp4` | calm cinematic | 16:9, 90–110s | 90 / 110s | slow, graded look |

Total: ~1 GB. The three talking-head refs only need their first 60s to be
usable, but the analysis runs the full file — keep them real duration.

### Footage (3 files, heavy)

| Id | File name | Type | Spec | Real duration | Rough size |
|---|---|---|---|---|---|
| foot-talk | `talk-long.mp4` | long talking-head (podcast/vlog) | 16:9, ≥720p, single take | 60 min | ~1–2 GB |
| foot-vlog | `vlog-medium.mp4` | medium vlog (cuts + speech) | 16:9 or 9:16 | 15 min | ~200–400 MB |
| foot-interv | `interview.mp4` | multi-camera interview | 16:9, ≥720p | 40 min | ~1 GB |

Both refs and footage need **real audio** (energy/onsets measurement) and
speech where the test touches captions. Watermarked or obviously-AI renders
would poison the benchmark — no Pexels-style same-10-clips-on-every-channel
selection either; the references should look like three different editors
made them.

**Hard requirement:** the exact same footage files are used for the old
baseline and the later spike A/B. Don't source twice.

---

## 2. Two sourcing paths

### Path A — your own footage (recommended for the 3 footage files)

The footage files are "user footage" in the spec — your own recordings are
both cheaper and more honest. If you have a podcast/vlog/interview archive,
this is a day of copying + trimming, not a day of sourcing. The refs can
then come from stock (Path B) without affecting validity.

### Path B — stock, for the 12 references

Sites with free commercial licenses (no attribution, no watermark):

- **Pexels / Pixabay** — fast-cut montage and cinematic refs are easy to
  find; search per category: `vertical fast cut vlog`, `podcast interview
  two people talking`, `cinematic slow aerial`.
- **Mixkit** — good for montage/cinematic.
- **YouTube CC / archive.org** — only if you can verify the license; never
  use "free to use" claims, check the actual license text.

Per-reference checklist before adding to `bench/media/refs/`:

1. No watermark, no channel logo, no on-screen text unrelated to the test.
2. Real audio track (not a silent render).
3. Speech present in the talking-head refs.
4. Category look is distinct from the other refs in the same group (so
   raters judge the edit, not the file's identity).
5. Trim to the real duration in the manifest (short refs can be trimmed
   from a longer source; ranges are declared, not silently rebased).

### If sourcing is genuinely the blocker — the honest options

1. **Trim the set rather than stall (needs your explicit decision, this
   changes the locked design):** e.g. 12 refs × 1 footage = 12 pairs keeps
   every reference category and cuts media/rating work ~3×. The gate stays
   identical; the set is smaller and weaker on footage variety. I will not
   do this silently — tell me and I'll note it as a decision.
2. **Use refs-only stock and your own single footage file** — 12 pairs
   minimum viable, 36 when the other two footage files arrive.

---

## 3. Five raters — three realistic routes

Workload first, because it decides cost: **5 raters × 36 pairs = 180
ratings.** Each rating = watch reference snippet (≈40–60s) + watch the edit
(1–3 min) + score 3 axes + one-line why ≈ **4–6 min** → **~2.5–3.5 h per
rater**. Nobody does this in one sitting: split into **3 sessions of 12
pairs** (~1–1.25 h each).

### Route 1 — your network + local students (cheapest, ZA)

- Cost: near zero; coffee or a small e-voucher (R50–150 per session).
- **Who:** 5 people who watch short-form video regularly. Recruit through
  your own circle + a student group (Wits/UJ/CPUT media courses) — state
  the task, the ~3h total commitment, and that they must not know you.
- **Risk:** friends over-rate (mitigate: blind rows, shuffle order, and
  score the `publish` axis honestly — see protocol below). Never use the
  person who built the pipeline.
- **Time:** ~1 week to line up, next-weekend rating sprint.

### Route 2 — Prolific (most rigorous, moderate cost, works from ZA)

- Prolific accepts **South African participants** and pays £6–9/hr minimum
  (recommended £9 / ~R200/hr) ([1](https://beermoney.co.za/platform/prolific),
  [4](https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing)).
- Study design: 3 waves (12 pairs each), ~70 min/wave, £9–11/hr ⇒
  £9–12 per rater per wave.
- Budget: **5 raters × 3 waves × ~£10 ≈ £150 participant pay + ~33%
  (academic/non-profit) or ~43% (corporate) platform fee ≈ £200–215
  (~R4,500–5,000).** Screening payouts (~£0.10/head) add a rounding error.
- **Caveat:** video-watch studies on Prolific are fine, but the study must
  host or link the media — put per-pair videos on a public static URL
  (Vercel blob/object storage) and link each pair's rating row. No media
  on the sandbox preview.
- **Time:** setup 1–2 days; recruitment fills in hours; full data in ~1
  week.

### Route 3 — mixed (recommended when cost matters but rigor doesn't)

3 paid Prolific raters (pay for independence) + 2 network raters (free) =
the 5 required. Agreement and Spearman still compute; the blind protocol
protects against the network over-rating. Cost ≈ £120–130 (~R3,000).

### Anti-bias protocol (non-negotiable, all routes)

1. Raters never see old vs new side-by-side (baseline only has old anyway).
2. Pair order is **shuffled per rater** — no fixed p-001→p-036 order.
3. Rows are `blind: true` when a rater reports they couldn't watch
   something; blind rows are excluded from feel-match (already in the
   manifest + scorer).
4. One-line "why" is mandatory — it's the qualitative signal.
5. **Calibration demo before session 1:** one example pair, scored aloud,
   so "3 = recognisable attempt, not quite" means the same thing to all
   five. This is what makes agreement ≥0.6 achievable at all.
6. Attention check: one pair repeated at the end of a session; a rater who
   scores it wildly differently (and the `why` doesn't explain) gets their
   session excluded rather than silently averaged in.

---

## 4. Exact next actions (in order)

1. **You:** confirm media source — own footage + stock refs (Path A+B),
   all-stock, or the trimmed 12-pair set. (This is the only decision I
   need.)
2. **You:** drop files into `bench/media/refs/` and `bench/media/footage/`
   with the file names above (small trim step — I can give exact ffmpeg
   commands if your sources aren't the right length/format).
3. **Me (once files exist):** run the analysis + old-pipeline edits for all
   36 pairs, host per-pair outputs, generate the rater sheets + JSONL
   templates, run the calibration, and hand you the rating link set.
4. **Raters:** 3 sessions of 12 pairs (Route 1/2/3 per your call).
5. **Me:** `node bench/score.mjs --manifest bench/manifest.json --ratings
   bench/results/baseline.jsonl` → baseline recorded, then the spike A/B
   against the same pairs — only then any comparison claim.

---

## 5. What I can do right now (no media needed)

- Generate the exact `manifest.json` once you tell me real durations (or a
  `bench/make-manifest.mjs` that reads ffprobe and fills it in — say the
  word).
- Build `bench/make-rater-sheets.mjs` — produces 5 shuffled per-rater
  sheets + the empty JSONL rating rows, keys off the manifest.
- Draft the rater recruitment post (network version) and the Prolific study
  description + consent/attention-check text.
- Prepare the ffmpeg trim/transcode commands for whatever source files you
  actually have.
