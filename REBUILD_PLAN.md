# Modaya Rebuild — Spec Response & Decision Recommendations

**Companion to `modaya-rebuild-spec.md` (draft).** Everything verified against the
repository at commit `2676af4` (686 tests, 59 files, tsc + build clean).
This document does **not** replace the spec — it answers the open questions with
code-grounded recommendations so they can be locked down.

## Decision status — locked 2026-09-07

| # | Decision | Status |
|---|---|---|
| D1 | Vision provider + fallback | **LOCKED**: provider-agnostic vision (existing Groq/Gemini/OpenRouter/Ollama chains, Cloudflare stays text-only). No-key mode = metrics-only, **labelled in the UI as lower fidelity** ("matching without an AI key uses basic measurements only"). Feature never blocked behind a key |
| D2 | Benchmark before prototype | **LOCKED**: benchmark-first (Phase 0). Human-rated set defined in Part B; `bench/` harness built |
| D3 | Op vocabulary | **LOCKED (owner's list — overrides the draft table below)**: v1 = `remove_ranges`, `keep_ranges`, `trim_to`, `add_captions`, `add_text`/`move_text`/`remove_text`, `style_text`, `grade`, `uncut`. **Deferred**: `punch_in` op and reference-driven pacing/beat-matching — both stay dormant until the new reference-matching path (§3) is validated |
| D4 | Definition of "reliable" | **PROPOSED (5 numbers, Part B) — awaiting one-line sign-off** |
| D5 | Client vs server | **LOCKED**: staged hybrid (recommendation adopted) — keep analysis/preview client-side; project state + AI pipeline become one server-side source of truth; cloud render deferred to a v1.1 gate (worker+queue, never serverless headless browser) |
| D6 | Orphaned engines | **LOCKED**: none in v1. Re-enter one at a time, wired in the same PR: auto-reframe → LUTs → ducking/mixer → motion-tracked text |
| C1 | Editable timeline export | Named phase after reference-matching v1 (was missing from the spec; flagged, not silently dropped) |
| C2 | Asset placement | Deferred; assets remain **advisory** (classified + described, never placed) until a named phase |

D4 is the only open item. The proposal below (intent ≥90%, no-op ≤10%, order
fidelity ≥95%, timecode validity 100%, reproducibility ≥99%) is ready to be
accepted or adjusted in one line.

---

## Part A — Spec verification (what the code actually says)

| Spec claim | Verdict | Evidence |
|---|---|---|
| AI editing unreliable; op vocabulary is one big plan-and-justify call | ✅ Confirmed | All 12+ ops + reasoning live in one 1300-line route (`/api/projects/[id]/ai/route.ts`); intent → operations → apply in one LLM pass |
| Reference signal is lossy — model reconstructs "feel" from a metrics sheet | ✅ **Confirmed, and worse than stated** | `analyseReference` samples reference frames (`sampleFrames`) but returns only `{profile, audio}`. Reference frames **never leave the browser**. The model receives: style rule card (text) + 4-track event list (text). Only the **user's** footage frames are ever sent (`Studio.tsx:957/1347` → `needsVision`) |
| Rewriting feel from numbers is the likely upstream cause of (1) | ✅ Agreed | Deterministic metrics feed the plan, but the multimodal comparison the model would need ("like 0:12 in the reference") is impossible today — the pixels are not in the request |
| App is technically fragile | ✅ Confirmed | `Studio.tsx` = 3,237 lines; AI route = 1,302 lines; the old-editor deletion left orphans (`timelineSnapping.ts`, `editHistory.ts`, `styleTransfer.ts`) imported only by their own tests; `db.ts` is memory-only in production (Vercel); timeline lives in browser IndexedDB |
| ~10 tested-but-unwired engines | ✅ Confirmed | autoReframe, motionTracker, speedRamp, jumpCutSmoother, colorGrading LUTs, ducking, soundMixer, voiceEnhancer, sfxEngine, storyboardGen, brollMatcher, twelvelabs, publisher — the Studio wires **none** of them (verified: no `audioMix`/`morphCut`/`autoReframe`/LUT usage in the Studio sequence) |
| Old match score never validated against human judgment | ✅ Confirmed | `referenceMatchDetail`/`matchPlan` measure 4–5 axes (cuts/min, beat-snap, punch-in, captions, grade). No benchmark set, no human-rating code or data anywhere in the repo |
| Export/analysis client-side | ✅ Confirmed | `exporter.ts` uses WebCodecs → `captureStream` → MediaRecorder, real-time, in the tab |

**One correction to the spec's framing:** the second root cause isn't only "metrics
are the only reference channel" — it's that `composeStudioPlan` (deterministic)
and the AI path are **two different brains** with different ideas of "right".
The rebuild's reference-matching work must fix the signal AND converge one
definition of the target style in both paths.

---

## Part B — Open decisions: recommendations

### D1. Vision provider(s) + deterministic-mode fallback

**Recommendation:** ship with the providers already wired — **Groq
(`qwen/qwen3.6-27b`) and Gemini (2.5-Flash), with OpenRouter
(`google/gemma-4-31b-it:free`) and local Ollama (`llava`) as supported
extras; Cloudflare stays text-only (its model can't see).** No new provider
integration is needed for the rebuild — the multimodal plumbing exists
(multi-image messages are already used for user frames).

**Fallback: deterministic mode degrades gracefully — and already does.**
Without a vision provider (or any key), reference matching falls back to the
existing metrics-only path (`composeStudioPlan` + measured StyleProfile),
which is exactly the current behavior. The rebuild should make that a
declared contract: **multimodal = best, metrics = fallback, never a silent
in-between.** The UI already says "no model can see this" — keep that.

### D2. Definition of "match" — human-evaluated benchmark

**Recommendation — build the benchmark before the feature.** Concretely:

- **Set:** 12 reference videos (mix: short-form vertical, talking-head podcast,
  fast-cut montage, calm cinematic interview) × 3 user footage clips = **36
  reference→edit pairs**. Each pair gets one **fixed instruction** ("match the
  reference's pace, captions and emphasis").
- **Task:** 5 independent raters score each output on three 1–5 scales:
  **Feel-match** (does this feel like the reference?), **Instruction-follow**
  (does it do what was asked?), **Editing quality** (would you publish it?).
- **Gate:** mean feel-match ≥ 3.5/5 with inter-rater agreement (not just a
  mean) before the new approach replaces the old. Also record the **correlation
  of the internal match score vs human feel-match** — the spec's suspicion is
  right, and we should prove or kill the automated score with data.
- **Tooling:** a small script + JSONL dataset in the repo (`bench/`), runnable
  offline; the old pipeline can be A/B'd against the new one on the same set.

### D3. Operation vocabulary: full vs narrowed v1

**LOCKED — owner's call (2026-09-07):** v1 keeps the *foundational and
testable* set:

| v1 (ship) | Deferred (until reference-matching §3 is validated) |
|---|---|
| `remove_ranges` (dead air/filler) | `punch_in` |
| `keep_ranges` (highlight selection) | reference-driven pacing/beat-matching |
| `trim_to` | everything else (already engine-ready) |
| `add_captions` | |
| `add_text` / `move_text` / `remove_text` | |
| `style_text` | |
| `grade` | |
| `uncut` | |

Rationale (owner's): the ops most entangled with the broken reference signal
are exactly the ones to freeze until the new multimodal reference path is
proven. `punch_in` and reference pacing stay in the *profile/kinetic layer* as
data, but are not driven by unreliable reference reconstruction for v1. Chat
still understands every phrase — the parser narrows, not the UX. (`uncut` is
kept alongside the owner's list as a foundational op that doesn't touch
reference matching.)

### D4. Definition of "reliable" (measurable)

**Recommendation — five numbers, tracked per release against the fixed test
set (D2):**
1. **Intent match ≥ 90%** — manual binary: does the edit match the stated intent?
2. **No-op rate ≤ 10%** — replies that changed nothing when change was asked for.
3. **Order fidelity ≥ 95%** — the plan executes in the order the model proposed
   (validated by the planned validation between steps).
4. **Timecode validity 100%** — every clip lands on a measured cut/onset or is
   explicitly reported (no invented times — already the honesty rule).
5. **Deterministic reproducibility ≥ 99%** — same footage + reference + seed →
   same edit (fixes the "unstable" complaint; today the score/plan can drift).

### D5. Client-side vs server-side — the central architecture call

**Recommendation: staged hybrid, not a full move.**

- **Keep client-side (v1):** audio/frame *analysis* (it's cheap, free, and
  already works; a 2-hour file analysed in-browser is not the fragile part)
  and live preview compositing.
- **Move server-side first (v1):** one thing — **project state + the AI
  pipeline as the single source of truth**. Concretely: persist the plan
  (`StudioPlan` + `StyleLayer`) and versions to the server, parallel to
  IndexedDB, so reopening the project on any device restores the edit, and the
  AI route stops reconciling two timelines (server copy vs browser copy —
  today's real fragility seam).
- **Defer (v1.1 gate):** cloud render queue (server-side encode). This is the
  expensive part and the one thing the spec is right to call out. It should be
  gated on a simple metric: **"can users finish a 20-min export without the
  tab open before we're willing to pay for render infra?"** If the honesty
  layer says "your hardware, your time" clearly enough, v1 ships without it.
- **Never do:** headless-browser rendering on a serverless function (Vercel
  functions can't hold a 20-minute MediaRecorder job). If/when cloud render
  happens it's a worker + queue (e.g. ffmpeg worker or Step/Inngest-style
  queue), which is a separate project.

The spec's framing is right; my recommendation is that the *highest-leverage*
fix for "fragile" is **state durability + one pipeline**, not render
infrastructure — the latter solves a real but secondary pain.

### D6. Which orphaned engines make the v1 cut

**Recommendation: none — by design.** The rebuild's first goal is proving
reference matching (D2). Shipping another engine without wiring it into a
validated feel pipeline recreates the same gap. Each engine is kept
engine-ready and **re-entered one at a time, wired in the same PR**:
1. Auto-reframe (subject-aware) — *highest value, medium cost*
2. LUT colour grades — *cheap, high visible value*
3. Audio ducking / multi-track mixer — *needs audio-export work first*
4. Motion-tracked text — *needs auto-reframe to land first*
5. Everything else — explicit backlog, no UI promises until wired.

Process rule (adopt as standing): **no PR lands an engine without its UI path;
no PR claims an engine in the UI without its tests.**

---

## Part C — Two decisions the spec doesn't cover (flagging, not resolving)

1. **Editable timeline export (EDL / FCPXML / Premiere XML).** Your earlier
   architecture decision made this the moat ("context layer → editable
   timeline file"), and the audit confirmed **it doesn't exist — export is a
   flat MP4/WebM only.** The rebuild spec omits it entirely. Recommend:
   schedule it *after* reference-matching v1 (it's pure deterministic code
   from `StudioPlan`/`StyleLayer`, cheap once the plan is stable) — but make
   it a named phase, not a silent drop.
2. **Asset placement (images/fonts/SFX).** Audit found the asset kit is
   classified and described to the AI but **never placed on the timeline**
   (only video B-roll becomes clips). The spec doesn't address it. Recommend
   deferring, but recording that "the AI understands your assets" is
   currently **advisory**, not editing.

---

## Part D — Recommended sequence (with gates)

```
Phase 0 — Decision lock + benchmark (no product code)
  · adopt/deny decisions above
  · build bench/: 12 refs × 3 footage × fixed instruction, rater sheet,
    scoring script, JSONL dataset
  · exit: first 10 pairs rated; baseline numbers recorded for the OLD pipeline

Phase 1 — Reference-matching prototype (the root cause)
  · send reference keyframes + cut/onset snapshots to the model alongside
    the user's footage (multimodal comparison; frames already sampled —
    they're just dropped today)
  · keep metrics as grounding + fallback; A/B on the benchmark
  · exit: feel-match mean ≥ 3.5/5 and ≥ old pipeline on the same pairs
  · STATUS: steps 1–3 built (`b4b4e32`): analyseReference samples 6
    reference keyframes, route attaches them after footage frames with
    an IMAGE ORDER + cite-by-timestamp prompt, honest no-key fallback.
    Step 4 is HELD until the old-pipeline baseline is human-rated — no
    A/B result may be claimed before that baseline exists.

Phase 2 — Editing pipeline rebuild
  · separate intent classification from execution; six v1 primitives (D3);
    validate between steps; deterministic-repro test
  · single source of truth for project state (D5-lean, no cloud render yet)
  · exit: D4's five numbers on the benchmark set

Phase 3 — Fragility cleanup
  · split the 3,200-line Studio; retire orphan modules + their tests
    (timelineSnapping, editHistory, styleTransfer) or rewire them
  · exit: no code imported only by tests; build + full suite green

Phase 4 — Re-introduce engines, wired one by one (D6 order)
  · exit: every engine reachable from the UI, with its own tests
```

---

## Part E — What I'd build first (spike, 1–2 days)

The smallest change that tests the root-cause hypothesis end-to-end:

1. `analyseReference` → also return 6–10 keyframes (they're already sampled;
   today they're discarded after metrics).
2. `styleForAi` → include a `REFERENCE FRAMES` block (data URLs + timestamps)
   alongside the existing rule card, when a vision provider is configured.
3. Route prompt: teach the model to reference them ("like the reference at
   0:12") and to say when it can't see them.
4. A/B the old vs new on the first 10 benchmark pairs.

No timing-keyframe plumbing, no re-architecture — just the lost signal added
to the existing request. Everything else waits for the Phase 0 numbers.
