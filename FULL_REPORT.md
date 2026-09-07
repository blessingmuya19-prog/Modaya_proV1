# Modaya — Full Capability Report

**Status:** audited against the actual code at commit **`f9de063`** (branch `arena/01a06cd9-modaya-prov1`)
**Verification:** 686 tests pass across 59 test files · `tsc --noEmit` clean · `next build` clean
**Date:** 2026-09-07

This replaces the older `MODAYA_BREAKDOWN.md` (which was written before the AI context layer, the kinetic layer, and the zoom/transition fixes). Everything below was checked in the source — where something is claimed, there is a file behind it.

---

## 1. TL;DR

**Modaya is a working, browser-based AI video editor with a real editing brain — but it is an *AI-driven* editor, not a manual NLE, and it ships one output format: a flat video file.**

| | Verdict |
|---|---|
| Day-to-day editing (drop footage → AI cuts it → chat to refine → export) | ✅ Works end-to-end |
| Style matching to a reference video (measured, honest score) | ✅ Works |
| AI understanding (transcript, picture, frames, asset kit, vibe) | ✅ Works (needs an AI key for free-form) |
| Real animated zooms + whip/dissolve transitions in the render | ✅ Works |
| Captions, text overlays, colour grade, punch-ins, B-roll cutaways | ✅ Works |
| Versions, undo, edit map, reference comparison | ✅ Works |
| Export to a *video* file (MP4/WebM) | ✅ Works |
| Export to an *editable timeline* (FCPXML / EDL / Premiere XML / SRT) | ❌ **Does not exist** |
| Manual timeline editing (drag, trim, layers) | ❌ Removed with the old editor |
| AI voiceover, music, image/graphic/SFX placement | ❌ Not possible today |
| Audio mixing UI, speed ramps, motion-tracked text, auto-reframe UI | ⚠️ Engines exist, **not wired** |
| Teams, brand kits, approvals, collaboration | ❌ Not built (Phase 4) |

---

## 2. What it CAN do (wired into the UI, verified)

### 2.1 The core flow
```
Drop footage (+ optional reference) → measured pipeline → AI/deterministic edit
→ preview + edit map → chat "make it punchier" → new version → Export MP4/WebM
```
Files: `src/components/studio/Studio.tsx` (the whole Studio), `src/lib/studio/editPlan.ts` (the decision brain), `src/lib/studio/aiBridge.ts` (AI ⇄ plan bridge), `src/lib/render/engine.ts` (compositor), `src/lib/render/exporter.ts` (export).

### 2.2 Inputs
- **Footage** — any video/audio file a browser can decode. Stored in IndexedDB locally; a durable server copy is attempted when storage exists (`src/lib/mediaCloud.ts`).
- **Reference video** — upload a file **or paste a direct URL** (`/api/reference/fetch`, SSRF-guarded; YouTube/TikTok/Instagram/Vimeo/Facebook *watch pages* are declined honestly — `src/lib/referenceGuard.ts`).
- **Reference section** — "use 0:30–1:10" (parsed by `src/lib/referenceLink.ts`).
- **B-roll library** — extra **video** clips used as cutaways; persisted + cloud-backed up, rehydrated on reopen.
- **Drop-screen brief** — type anything ("add bold captions, keep it all"); **Version 1 is made by the AI** from it (`mode: 'generate'` in `/api/projects/[id]/ai`).
- **Drop-screen presets** — faster, remove mistakes, highlights, captions, clean up, vertical.

### 2.3 What the pipeline actually measures
- **Source analysis** (`analyseAudio`, `analyseReference`, `visualScan`): loudness/RMS envelope, **onsets/beat grid**, silences, per-second interest curve, frame samples, shot-change cuts, motion, brightness, dark spans.
- **Reference → Style Profile** (`styleProfile.ts`): cuts-per-minute, shot mean/median/variance, pacing class, colour grade (brightness/contrast/saturation/warmth), **punch-in rate**, caption presence/position/emphasis, beat-sync, BPM, energy.
- **4-track reference deconstruction** (`referenceAnalysis.ts`): narrative / visual / overlay / sonic events, each with a one-sentence *reason*, capped at 300, sent to the AI as a pre-computed vocabulary.
- **Style rule card** (`styleRules.ts`) + **asset classification** (`assetTags.ts`) + **semantic asset router** (`assetRouter.ts`, controlled-vocabulary cosine — no embedding API) + **vibe brief** (`vibe.ts`) — all travel with the AI request.

### 2.4 What the copy edits do (the operation vocabulary)
From `/api/projects/[id]/ai` and `src/lib/ai/operations.ts` — this is the full, honest list:

| Operation | What it does |
|---|---|
| `remove_ranges` | Removes measured silences/dead air; reports seconds saved |
| `keep_ranges` | Keeps the strongest measured window (never "first N seconds") |
| `trim_to` | Shortens to a target length |
| `add_captions` | Writes the **actual transcribed words** at their timestamps, or honest empty `Caption` slots when no transcript exists |
| `add_text` | Places the exact words you gave ("Write *My Name* on screen") |
| `move_text` | Moves **existing** text — never duplicates it |
| `remove_text` | Removes one text clip (by words/position, or `all`) |
| `style_text` | Restyles: 5 fonts, 3 sizes, colours, box/shadow/none, bold, uppercase, 9 placements |
| `punch_in` | Sets the push-in rate |
| `grade` | Brightness/contrast/saturation (+ warmth via profile) |
| `none` / questions | Clarifying questions, answers, and honest refusal to guess |

Plus: **undo** (one step back), **find me N viral clips** (returns standalone clips with title/score/reason — one tap cuts to it as its own version), **"what's happening?"** (answer from frames+measurements, or a plain "no model can see this").

The AI route also **reasons before editing** (scene understanding → step decomposition → operations), returns a `reason`, and **refuses any plan that deletes every frame**.

### 2.5 What the creative engine does (static, deterministic, tested)
- **Moment selection** — hook = strongest window, never defaulted to the start; interest-driven.
- **Rhythm matching** — cadence (`60/cutsPerMin`), measured shot-length variance as the spread, **beat snapping** to measured onsets (1.2 s window beat-synced / 0.35 s otherwise).
- **Short / full / uncut modes**, frame ratios 9:16, 1:1, 16:9.
- **Animated zooms** — shot push-ins become **keyframed ramps 1.0 → target (clamped 1.05–1.45)** starting **exactly at the measured onset**, held on the punchline, settled before the cut (`src/lib/render/transitions.ts` + `editPlan.ts` `applyKineticLayer`).
- **Transitions** — at genuine source jumps only: **whip** for energetic + beat-synced (or heavy punch-ins), **crossfade** for calm; never a fake dissolve on a continuous source. Rendered by overlap-compositing both clips (`engine.ts`).
- **Captions** — real words, 9 placements, kinetic word-by-word pop/glow/box/typewriter, 5 local fonts (nothing fetched).
- **B-roll cutaways** — from your library, or unused strong windows of the source; silent by design.
- **Colour grade** — from the measured profile (brightness/contrast/saturation/temperature matrix).
- **Vibe sliders** (Aggression, Caption literalism) — re-cut in place, centered so 0.5 = as-measured.

### 2.6 Iteration & trust features
- **Versions** — every change is a new version; AI-made versions store an exact timeline snapshot; deterministic versions rebuild identically from recipe. Restore any.
- **Regenerate** — same direction, fresh seed.
- **Undo** — one step in chat.
- **Edit Map** — clickable markers on the timeline (Hook/Cut/Zoom/Caption/B-roll) each with a plain-English *reason* from the measurements.
- **Diff chips, summary chips, seconds-saved** — what actually changed, not what was intended.
- **Reference comparison** — Mine / Reference / Side-by-side with progress-locked synced playback.
- **Honesty layer** — no fake "done", no invented accuracy, honest vision ("no model can see this"), honest fallback ("I'm running without an AI model"), whole-video protection, neutral `Caption` slots, no filename-as-evidence, punch-in rate and match score measured **from the plan itself** (zooms count as punch-ins).

### 2.7 Export
- **Canvas-accurate** — records exactly what the preview shows (cuts, captions, grade, **animated zooms and transitions**).
- **MP4** (H.264/AAC when the browser supports it) or **WebM** (VP8/VP9 + Opus), with WebCodecs preferred and MediaRecorder fallback; capability detection with graceful errors.
- **1080p / 720p / 480p**, selectable FPS and video bitrate; audio at 160 kbps; real-time progress; file download.

### 2.8 Account & persistence
- Register/login/logout/session, bcrypt + JWT, per-user project isolation (`src/lib/auth.ts`, `/api/auth/*`).
- Dashboard: grid/list, status filters, rename, delete; thumbnails.
- Settings → AI: provider key management (name-only display, never echoed), verify, forget, plain-language diagnostics (`model_unavailable`, `unauthorized`, stale build).
- Providers: **Groq, Google Gemini, OpenRouter, Cloudflare, local Ollama**; vision-capable chains for Groq/Gemini/OpenRouter/Ollama (`src/lib/ai/llm.ts`).

---

## 3. Built and tested engines — NOT wired into the Studio UI

These are real, tested modules with full unit coverage, but the Studio never calls them, so the user cannot reach them. **Engine-ready ≠ available.**

| Engine | File | What it would do | Why it's not live |
|---|---|---|---|
| Auto-reframe (subject-aware) | `render/autoReframe.ts` | Continuous subject centring 16:9 → 9:16/1:1/4:5/21:9 | `buildSequence` in Studio passes no `autoReframe` config; deterministic reframe is crop-only |
| Motion-tracked text/callouts | `ai/motionTracker.ts` | Anchors text to a tracked subject | Nothing produces `motionTrack` clips in the Studio flow |
| Jump-cut morph smoothing | `render/jumpCutSmoother.ts` | Morph/optical-flow across removed silences | No `morphCut` config passed |
| Speed ramping | `render/speedRamp.ts` | 0.25×–8× non-linear curves | Not referenced by Studio/engine path |
| LUT film looks | `render/colorGrading.ts` | Teal&Orange, Kodak 35mm, Noir, Cyberpunk… | Profile grade (temperature matrix) is used; LUT presets are engine-capable only |
| Auto-ducking | `audio/ducking.ts` | Music/SFX duck under speech | No UI/config path |
| Multi-track mixer | `audio/soundMixer.ts` | Voice/music/SFX/B-roll tracks, compression, master | Engine supports `audioMix`; Studio sends none → default mixer |
| Voice enhancer | `audio/voiceEnhancer.ts` | EQ, de-esser, broadcast presets | Not wired |
| Procedural SFX | `audio/sfxEngine.ts` | Beat-synced whoosh/pop/impact/riser | Not wired |
| Diarization | `ai/diarization.ts` | Speaker turns + level balancing | Not wired |
| B-roll topic matching | `ai/brollMatcher.ts` | Transcript topic → library clip at pauses | Studio uses deterministic spread cutaways instead |
| Storyboard / chapters | `ai/storyboardGen.ts` | Semantic chapters + storyboard cards | Not wired |
| TwelveLabs viral scoring | `ai/twelvelabs.ts` | Pegasus clip virality | Config-gated, not wired |
| Publisher presets | `studio/publisher.ts` | Platform captions/hashtags/thumbnail timing with export | Export modal ships raw file only |
| Timeline snapping / edit history | `studio/timelineSnapping.ts`, `studio/editHistory.ts`, `ai/styleTransfer.ts` | Legacy editor helpers | **Orphaned** — only their tests import them (leftovers of the removed Pro Editor; no production caller) |

---

## 4. What it CANNOT do (hard limits, verified)

### 4.1 The big architectural gaps
1. **No editable-timeline export.** There is no FCPXML, CMX-3600 EDL, Premiere XML, or SRT *anywhere* in the repo (searched). Export is **only** a flat MP4/WebM render (`exporter.ts`). If your moat is "AI context layer → editable timeline file", **Phase 1 is still not built.**
2. **No manual editing surface.** Drag-to-trim, keyframe curves, multi-track stacking, ripple/overwrite tools — all removed with the old editor (`src/components/editor/*`, `/editor` route, `/api/projects/[id]/clips`, `refine.ts`, `proAi.ts`). The only way to edit is **through the AI chat** (or regenerate/undo/restore versions).
3. **Not a Premiere/Resolve plugin** — by explicit architecture decision it's a browser SaaS.

### 4.2 Media & asset limits
4. **Asset kit is advisory, not placeable.** Graphics (images), fonts, and SFX are classified, labelled, semantically routed, and described to the AI — but there is **no code path** that puts an image, font, or sound effect on the timeline (`asset` appears in `editPlan.ts`/`aiBridge.ts`/`engine.ts` **zero times**). Only **video** B-roll clips become cutaways; images/SFX are context the model can only talk about.
5. **No music.** The B-roll drop accepts **video files only** (`addBrollFiles` filters `video/*`); there is no music/SFX track upload, no audio asset type, no royalty-free library.
6. **No AI voiceover / TTS** — nothing synthesizes speech; there is only **ASR** (transcription). No narrate-my-video, no text-to-speech.
7. **No image generation, no stock footage fetch, no AI-generated B-roll.** The "AI" picks from what *you* uploaded.
8. **No multi-language output** — transcription is language-detected by Whisper, but captions are not translated, and there is no subtitle file export.

### 4.3 Editing capabilities
9. **Reframing is not subject-aware in practice.** The deterministic path declines/crops (it can't subject-track without a model), and the Studio never feeds the autoReframe engine even though it exists.
10. **No motion-tracked text in the product flow** (engine-ready only).
11. **No speed ramps, morph cut smoothing, LUT presets, audio mixing/ducking/SFX in the UI** (all engine-ready only; B-roll cutaways render **silent** by design because the plan marks them muted and no audioMix is configured).
12. **No per-clip audio editing** (no music cut, no SFX lane, no fade envelopes, no separate audio export).
13. **No AI clip-selection beyond "find me N clips"** — no auto-assembly of a montage from multiple sources, no scene-to-scene narrative planning, no multi-camera.

### 4.4 AI limits
14. **Free-form intelligence needs a key.** Without a configured provider, only the deterministic vocabulary works (dead air, highlights, captions, text, uncut, clips). The route says so plainly.
15. **Vision needs a vision-capable provider** — Cloudflare's Llama chain can't see; frames are only sent to Groq/Gemini/OpenRouter/Ollama vision models. No OpenAI provider at all.
16. **Asset routing is deliberately vocabulary-based** — no embeddings/vector DB, no semantic search across your library beyond the controlled tag set (design decision, but it caps "find me something like X").
17. **All analysis is browser-side** — audio/frame scanning cost grows with source length on the user's machine; very long sources are capped by hardware, memory, and the 400-event/60-asset/6-frame context budgets.

### 4.5 Platform, ops & business
18. **No cloud rendering.** Export records the canvas in real time on the user's tab — a 20-minute export takes ~20 minutes and must keep the tab open; no server-side render queue.
19. **Server data is ephemeral in production.** `db.ts` is explicitly memory-only on Vercel (file persistence only in dev); the Studio timeline is browser-owned (IndexedDB). Another device/new browser restores only what the browser kept, unless durable media storage (fs/S3/R2) is configured behind `/api/media`.
20. **No collaboration** — no team workspaces, no shared projects, no comments/approvals, no role permissions, no brand kits or templates; `plan: 'team'` exists on the user record but does nothing.
21. **No direct publishing** — download file only; "TikTok/YouTube presets" live in the engine-ready publisher, not in the export modal.
22. **No 4K / transparency** — export caps at 1080p long-edge; no alpha-channel WebM.
23. **No timeline backup/restore in an open format** — versions live in the browser exactly (snapshots), but they cannot be opened in any other editor.
24. **No public/share links for results** — everything is behind login with no share tokens.

---

## 5. Honest scoreboard (what the app actually delivers)

| Promise in older docs | Reality today |
|---|---|
| "Match a reference video's style" | ✅ Measured, honest score; zooms/transitions now real and rendered |
| "AI understands your video" | ✅ Transcript + measurements + up to 6 frames when a vision model exists |
| "Every refinement is safe" | ✅ Versions, undo, whole-video protection |
| "Cutaways auto-match topics" | ⚠️ Engine-ready only; live cutaways are deterministic placement |
| "Auto-reframe / tracked text / speed ramp / SFX / audio mixing" | ⚠️ Engine-ready only — **not reachable from the UI** |
| "Export for editors / social" | ❌ Only MP4/WebM; no timeline files, no publisher wiring |

---

## 6. Health

- **Tests:** 686 passing / 59 files (engine, edit plan, AI bridge, transitions, exports, auth, providers, assets, reference analysis, vibe, etc.)
- **TypeScript:** clean · **Production build:** clean · **Dev server:** boots and serves
- **Recent work:** real animated zooms + transitions (`6fb2e07`) and the fix that made them reach the canvas (`f9de063`); multimodal context layer (`7ada7c6`); smart context layer (`0db68ca`); rhythm engine (`80a4437`); caption transitions (`370067d`); honest match score (`4e139fa`).

---

*Generated by auditing the repository at `f9de063`. Claims are file-backed; anything marked engine-ready was verified by checking that nothing in the app calls it.*
