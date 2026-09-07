# Modaya — Complete Capability Breakdown

> **⚠️ Superseded (2026-09-07):** this document predates the AI context layer, the
> kinetic layer (real zooms/transitions) and the fixes that made them render.
> The current, code-audited report is **`FULL_REPORT.md`** at commit `f9de063`.

*Everything Modaya can do, in one document. Written from the actual code in this
repository — nothing here is marketing. Where a capability exists as a built,
tested engine but is not yet exposed in the Studio UI, it is marked
**engine-ready**.*

---

## 1. What Modaya is

Modaya is a **browser-based AI video editor**. You drop footage (and optionally
a reference video), and Modaya does the editing: it analyses the audio and the
pixels, understands what you type, builds an edit, and lets you refine it in
plain words — then exports the finished video.

There is **one AI** in the product. Every instruction — the initial brief on the
drop screen and every chat refinement — goes to the same server route
(`/api/projects/[id]/ai`). There is no second, smaller "local AI" pretending to
understand you.

The flow is deliberately simple:

```
Drop footage (+ optional reference) → Modaya runs the pipeline
→ You see the result + the edit map → Type what to change → new version
→ Export (MP4 / WebM)
```

---

## 2. Inputs

| Input | Details |
|---|---|
| **Footage** | Any video/audio file the browser can decode. Stored locally (IndexedDB) + a durable server copy where available. |
| **Reference video** | Upload a video, or **paste a public URL** (`/api/reference/fetch`). The reference is *style DNA only* — never copied into your edit. Platform watch pages (TikTok/YouTube/Instagram) are declined politely. |
| **Reference range** | "Use: 0:30 – 1:10" — learn the style from just a section of the reference. |
| **B-roll library** | Upload extra clips as cutaways. Modaya uses them for cutaway shots instead of reusing your own footage. Persisted locally and backed up to cloud. |
| **Drop-screen presets** | One-tap briefs: *Make it faster · Remove mistakes · Find highlights · Add captions · Clean up · Make vertical*. |
| **Drop-screen brief** | Type anything ("Add bold captions and keep the whole thing") — Version 1 is built from it by the AI. |
| **AI key** | Groq, Google AI Studio / Gemini, OpenRouter, Cloudflare, or local Ollama. Set in Settings → AI (the key is never stored in the DB or echoed). |

---

## 3. The Pipeline (what happens when you "Run")

Named stages the user watches complete (honest outcomes, not fake progress):

1. **Understanding your footage** — audio decoded in the browser: loudness
   envelope, RMS, onsets/beats, silence intervals, per-second interest curve.
2. **Learning your reference** (skipped without one) — frames sampled + cut
   detection + audio analysis → a **Style Profile**: cuts-per-minute, shot
   length stats, pacing class, colour grade (brightness/contrast/saturation/
   warmth), punch-in rate, caption presence & position, beat sync, energy.
3. **Finding the strongest moments** — interest (loudness/speech density)
   ranked; the hook is chosen from the strongest window, **never** defaulted to
   the start of the video.
4. **Matching reference pacing & cuts** — or the AI making the first cut from
   your brief (`generate` mode): it edits a full-length seed clip and returns
   the actual plan.
5. **Adding captions & emphasis** — on-demand transcription (Whisper via
   `/api/projects/[id]/transcribe`), chunked with quiet-boundary splitting.
6. **Building the edit** — the creative decision as data (see §6).
7. **Rendering** — preview and export from the composited sequence.

A **reference match score** (0–100%) is shown for reference edits — computed
from *measurable* agreement (cuts/min, punch-in rate, caption presence), never
fabricated.

---

## 4. What the ONE AI can do (the full instruction vocabulary)

### Understanding
- **Reads the transcript** (the real spoken words with timestamps) — quotes,
  searches, cuts from it; answers "what is this about?" from speech, not
  filenames.
- **Reads picture measurements** — shot changes, motion, brightness, dark
  spans, measured by scanning the footage in the browser; facts, not guesses.
- **Sees frames** — when the question needs eyes ("what is happening", "what
  colour is the jersey", "describe the video"), up to 6 keyframes are sent so a
  vision-capable model can actually look. If no model can see, it says so
  plainly.
- **Knows the reference style** — the learned Style Profile is summarised and
  sent with the request, so "match the reference" is grounded, not invented.

### Reasoning (new)
- **Thinks before answering**: scene understanding → step decomposition →
  operations. Compound requests ("like the reference but shorter, with bold
  captions") become ordered plans: structural edits first, then text, then
  looks.
- **Explains its plan**: every edit returns a `reason` — shown in the chat as a
  💡 thinking line. Deterministic steps narrate "Step 1: … · Step 2: …".
- **Asks when unclear**: ambiguous requests get a clarifying question and the
  reason states exactly what is unclear. No edit is guessed.
- **Safety reasoning**: any plan that would remove every frame of footage is
  refused with an explanation. An empty timeline is never delivered.

### Editing operations
| You say | It does |
|---|---|
| "Cut the dead air / pauses" | Removes measured silent spans (`remove_ranges`), reports seconds saved. |
| "Remove the ums and stutters" | Removes filler-word ranges — needs a transcript, and says so if there isn't one. |
| "Keep the best 2 minutes / highlights" | `keep_ranges` over the measured strongest window (never just "first N seconds"). |
| "Make it tighter / shorter" | Trims to a length or removes low-interest spans. |
| "Add captions / subtitles" | Writes the **actual transcribed words** at their timestamps; with no transcript it places honest empty `Caption` slots and tells you. |
| "Put captions at the top / bottom left" | Positions text in the frame (9 placements: top/centre/lower × left/centre/right) — placement is about the frame, not tracks. |
| "Write *My Name* on screen" | Adds the exact words you gave as a text overlay, at a start/end if you say when. |
| "Move it up / no, the other corner" | Moves **existing** text — never creates a duplicate. |
| "Remove the bottom title" | Takes off one text clip (by words or position); `all` removes every overlay. |
| "Make captions bold/serif/red/box" | Restyles existing text without re-running recognition: 5 fonts, 3 sizes, colours, box/shadow/none backgrounds, bold, uppercase. |
| "Grade it / make it vibrant/warm" | Applies brightness/contrast/saturation (+ warmth) — rendered immediately, kept in the profile. |
| "Add punch-ins" | Push-in rate change (look-only op, applied and saved). |
| "Don't cut anything" | Real `uncut` intent — keeps 100% of footage. |
| "Make it vertical for TikTok" | 9:16 (deterministic fallback says the truth: it can't subject-track without a model; the LLM path plans the reframe). |
| "Find me 5 viral clips" | Returns standalone short clips (title, score, hook, reason, tags, AI-pick vs measured) — **one tap cuts to the chosen clip** as its own programme/version. |
| "Undo" | One step back — the exact previous timeline state (version list keeps everything anyway). |
| "What's happening in this video?" / "describe" | Answers from frames/measurements; honest about what it hasn't seen. |

**Without a model configured**, the same route answers with its deterministic
rules engine: it performs only edits it can justify from measurements, and it
*never claims work it didn't do* ("I'm running without an AI model…", "I can't
reframe yet — that needs subject tracking").

---

## 5. Refinements, versions and iteration

- **Every refinement is a new version** — old versions are never overwritten.
  Version recipes are deterministic; AI-made versions also store a timeline
  snapshot so they restore *exactly*.
- **Regenerate** — same creative direction, fresh seed, new timing choices, new
  version.
- **Restore any version** — one click, rebuilds that exact cut.
- **Undo** — in-chat one-step undo that restores the previous timeline state.
- **Edit Map** — the transparent view of every AI decision: markers for Hook,
  Cut, Zoom, Caption, B-roll on the timeline, each with a plain-English reason
  derived from measurements. Click a marker = "why did you do that?"
- **Reference comparison** — your edit vs the reference, toggleable Mine /
  Reference / Side-by-side with **synced playback** (progress-fraction locked).
- **Reference sections** — select a time range of the reference and compare the
  specific section.
- **Diff chips** — after each AI change, the chat shows what changed: Footage,
  Color Grade, Pacing, Aspect Ratio, Captions.
- **Summary chips + seconds saved** — the actual outcome of every edit.
- **Smart follow-up suggestions** — context-aware chips after each reply.

---

## 6. What the creative engine knows how to do (the hidden craft)

These are the pure, deterministic, fully tested libraries driving the decisions:

### Cut & pacing
- **Moment selection** from per-second interest + onsets (loudness, speech
  density, beat energy), hook-first ordering.
- **Beat snapping** — cuts snap to measured onsets so edits land on the rhythm.
- **Reference pacing matching** — shots per minute, mean/median shot length,
  variance (rhythm regularity), pacing class.
- **Uncut mode**, short-form vs long-form re-cut modes.
- **Silence & filler detection** (`silenceRemover`, `transcript.fillerRanges`),
  **diarization** (speaker-turn detection + level balancing) — *engine-ready*.

### Frame & picture
- **Auto-reframe** — 16:9 → 9:16 / 1:1 / 4:5 / 21:9 with continuous subject
  centering and camera-pan smoothing (deadzone hysteresis + EMA).
- **Smart zoom / punch-ins** — speaker-emphasis push-ins, slow creeps, rhythmic
  jump zooms, easing curves.
- **Motion tracking** — tracks a subject and anchors text/callouts to follow it
  with damping.
- **Jump-cut smoothing** — detects head-snap cuts after silence removal and
  synthesises morph transitions (optical flow / feature morph / dissolve).
- **Speed ramping** — non-linear speed curves, action/montage presets —
  *engine-ready* (0.25×–8×).
- **Colour grading** — cinematic LUTs (Teal & Orange, Kodak 35mm, Fuji Chrome,
  Noir, Cyberpunk, Bleach Bypass, Golden Hour) + temperature/tint matrix +
  skin-tone-preserving vibrance.

### Captions & text
- Real-word captions from transcription; tiled neutral slots without a
  transcript.
- **Kinetic caption styles** — word-by-word karaoke (pop/glow/box/typewriter),
  pill backgrounds, outlines, highlight colours, 5 local fonts (nothing fetched,
  so a caption can never render in a substitute face).
- Text overlays, nine placements, tracked callouts.

### Audio
- **Auto-ducking** — music/SFX/B-roll audio ducks under speech automatically.
- **Multi-track mixer** — voice/dialogue, music, SFX, B-roll tracks, soft-knee
  compression, master level.
- **Voice enhancer** — noise floor estimation, 3-band vocal EQ, de-esser,
  broadcast presets (Studio Broadcast, Podcast Clean, Outdoor De-Noise…) —
  *engine-ready*.
- **Procedural SFX** — whoosh/pop/impact/riser/click/ding synthesized with
  WebAudio, beat-synced to cuts and reveals.

### Structure
- **B-roll auto-matching** — transcript topics matched to library clips,
  placed at natural pauses — *engine-ready* (manual B-roll windows are used
  today).
- **Storyboard / chaptering** — semantic chapters, hook discovery, visual
  storyboard cards — *engine-ready*.
- **TwelveLabs Pegasus** visual virality ranking for clips when configured —
  *engine-ready*.

---

## 7. Export

- **Canvas-accurate export**: records exactly what the preview compositor shows
  (sequence, cuts, text, grade, captions).
- **Formats**: MP4 where the browser supports it, WebM otherwise.
- **Resolutions**: 1080p / 720p / 480p (long-edge).
- **FPS and bitrate** selectable; **progress** by time; **WebCodecs** support
  detection with graceful fallback.
- Download to device; **platform presets** (TikTok, YouTube Shorts/Long,
  Instagram Reels/Feed, LinkedIn, X) with correct aspect ratio, hook titles,
  hashtags and thumbnail timing — *publisher engine-ready*.

---

## 8. Project management

- **Dashboard**: all projects with grid/list views, status filters (all /
  ready / processing / draft), rename, delete.
- **Media memory**: footage + reference + B-roll stored locally and backed up
  (cloud) so a reopened project on any device rehydrates.
- **Thumbnails/posters** captured and stored per project.
- **Auth**: sign-up / login / session; projects are per-user and protected
  server-side.
- **Settings → AI**: check which provider is configured (names only, never key
  values), paste a key, verify it, forget it. Diagnostics explain stale builds
  and dead models (`model_unavailable`, `unauthorized`, timeouts) in plain
  words.

---

## 9. The honesty guarantees

These were hard-won bugs, now behaviours:

- **Never claims work it didn't do.** No fake "done!" — the reply reports what
  actually happened (or the model's answer when it only asked a question).
- **No invented accuracy.** No "98% accuracy" figures; no invented timestamps;
  no hallucinated clip timecodes (every model timestamp is clamped, snapped to
  sentence edges and re-validated).
- **No filename-as-evidence.** "footage.mp4" never becomes a description of
  someone in the video.
- **No duplicate text.** Moving existing text never adds a second copy.
- **Neutral captions.** Without a transcript, slots are labelled `Caption` —
  never the reference/footage filename.
- **Honest vision.** No model can see → it says so and answers from
  measurements only.
- **Honest fallback.** No key → deterministic rules engine + a note saying
  which build/deployment is missing the key.
- **Whole-video protection.** A plan that deletes everything is refused.
- **Version safety.** Every change is a new version; nothing is ever
  overwritten, and AI snapshots restore exactly.

---

## 10. Honest limits (today)

- **Free-form AI requires a provider key.** Without one, only the deterministic
  vocabulary (cuts, silences, highlights, captions, text, uncut, clips) works.
- **Reframing** is only planned by the AI route; the deterministic fallback
  declines rather than cropping badly (subject tracking needs a model).
- **Clip hunting's meaning layer needs a transcript** (real titles/scores come
  from the LLM; measurement-only clips still work with no key).
- **TwelveLabs, diarization, storyboarding, speed ramping, voice enhancement,
  B-roll topic matching** are built and tested engines not yet wired into the
  Studio UI — marked *engine-ready* above.
- Everything runs in-browser & on your machine: heaviest jobs (decode, scan,
  render) are capped by hardware, and files remain local unless you back them
  up.

---

*Last updated from the code at commit `02fadc2`.*
