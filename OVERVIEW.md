# Modaya — what it is, what works, and what doesn't

An honest tour of the project as it stands. This is the document to read before
you demo it, build on it, or hand it to someone: it says plainly **what the app
can do today**, **what is only a shell**, and **where the known rough edges
are**. For setup and env vars see [README.md](./README.md).

---

## 1. What Modaya is

A **browser-based AI video editor** (Next.js 16 + React 19) in the spirit of
CapCut/Descript/OpusClip. You upload footage, then talk to an AI editor in a
chat panel: "cut the silences", "add captions", "find me 5 viral clips", or
"re-cut this like this reference video".

Its central design bargain:

- **It works with no API key at all.** A deterministic measurement engine
  (loudness, silences, visual motion, shot changes) runs locally in the
  browser and answers a surprising amount on its own.
- **With any free key** (Groq recommended), a text LLM reads the request and
  the transcript for real meaning. The model never edits the timeline
  directly — it returns validated JSON operations, and deterministic code
  executes them. A hallucinated timestamp is clamped/snapped/dropped before it
  can touch anything.

Everything degrades gracefully: no key, dead network, rate limit, or a model
that returns garbage all produce a usable fallback and an honest message about
what happened.

---

## 2. The stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Rendering | Custom **canvas compositor** (`src/lib/render/engine.ts`) — cuts, push-ins, grading, overlays, double-buffered playback |
| Persistence (media) | Browser **IndexedDB** (`src/lib/mediaDb.ts`) — per-device |
| Persistence (accounts/projects) | In-process store (`src/lib/db.ts`) — **see limitations** |
| Auth | Email/password, bcrypt hashing, JWT sessions |
| AI text | Provider-agnostic (`src/lib/ai/llm.ts`): Groq, Gemini, OpenRouter, Cloudflare, local Ollama — auto-detected |
| Speech-to-text | Groq Whisper `whisper-large-v3-turbo`, chunked uploads |
| Clip ranking (visual) | Optional **TwelveLabs Pegasus 1.5** (`src/lib/ai/twelvelabs.ts`) |
| Tests | Vitest, **429 tests**, no browser required |

---

## 3. What it **can do** today

### AI chat editing
Ask in plain language; the model returns operations that are validated and run
by deterministic code (`src/lib/ai/operations.ts`):

- **Remove silences / dead air** — cut ranges measured from real audio.
- **Remove filler words** ("um", "uh") — only segments that are *entirely*
  filler are cut; a meaningful segment containing one "um" is kept.
- **Trim / keep ranges** — "give me the strongest 90 seconds", "trim to 30s".
- **Captions** — transcribe, then place the real words at the times they were
  said.
- **On-screen text** — add, move, restyle text (top/centre/lower, alignment,
  weight, colour).
- **Punch-ins** (push to a tighter framing) and **colour grade** hints.
- Undo restores the previous timeline state.

### Reference-style editing
Upload a reference video; the app **measures** its editing style (cut rhythm,
  grade, push-in frequency, caption presence, beat sync — `styleProfile.ts`)
and re-cuts your footage to match (`styleTransfer.ts`). This is heuristic
analysis of real pixels/audio, not a neural style transfer.

### The clipping engine (the headline feature)
Turns one long video into several standalone short-form clips. Two stages:

1. **Viral detection (OpenShorts-style).** Grounded, non-overlapping candidate
   windows are built from the **real transcript sentences** (or a measured grid
   with no transcript). The free LLM only **scores and titles the windows we
   give it** against a virality rubric — hook in under 3 s, self-contained,
   clear payoff, no filler. **The model never invents a timestamp.** Final score
   blends `0.72 × virality + 0.28 × measured energy`. It understands bare
   requests like "30 seconds pls", "give me 5", "1 minute", "at the start",
   and clusters or spreads clips accordingly.
2. **TwelveLabs Pegasus (optional visual ranker).** With
   `TWELVELABS_API_KEY` and a public video URL, Pegasus reads frames+audio and
   boosts action-heavy moments the text model misses. It is strictly additive
   and silent when unconfigured/unreachable.

Each result is a card with a time range, score, title/tags and a
**"Cut to this clip"** button that isolates that range on the timeline.
Clips never overlap, stay within the video, and snap to sentence gaps.

### Real video export
The Export button **produces a downloadable file** of exactly what the preview
shows — cuts, on-screen text/captions, grade and the source audio. A hidden
render of the sequence streams the canvas (`captureStream`) and the media's
audio (WebAudio tap, recorded silently) into `MediaRecorder`, giving an **MP4**
on Chrome/Edge desktop or **WebM** elsewhere, at 480p/720p/1080p and a chosen
bitrate. It records in real time and the file stays on the user's device
(`src/lib/render/exporter.ts`).

### Works with no key
Loudness/excitement curves, silence detection, visual motion and shot-change
detection (`highlights.ts`, `visualScan.ts`) all run locally — so clip finding,
silence cutting and highlight picking work offline and for free.

### Diagnostics & honesty
- `?debug=1` overlay: render source, video clock, dropped frames, extraction
  progress.
- Every AI response carries an `engine` block: source (`ai`/`measurement`),
  provider, model, ranker, build SHA, and failure reason.
- Settings → AI editor validates a key with a real call before saving and
  flags lookalike misspellings (e.g. `GROK_API_KEY`).

---

## 4. What it **can't do** / known imperfections

Read this section before promising anything to a user.

### Big-ticket gaps

1. **Export records in real time, in the browser.** The Export modal now
   produces a real downloadable file: a hidden render of the finished sequence
   streams its canvas (`captureStream`) plus the source media's audio (tapped
   via WebAudio, silent during recording) into `MediaRecorder`, which muxes an
   **MP4** where the browser supports it (Chrome/Edge desktop) else **WebM**.
   Honest limitations of this approach: it runs **in real time** (a 60 s edit
   takes ~60 s; faster-than-real needs WebCodecs/ffmpeg), resolution never
   upscales past the source, and it needs the media present in this browser
   (re-upload if missing). Code: `src/lib/render/exporter.ts`.

2. **Data does not persist on a serverless host.** `db.ts` is an in-process
   store. In development it writes `data/*.json`; **on Vercel the filesystem is
   read-only and memory is recycled**, so accounts, projects and uploads do not
   survive a redeploy or an idle instance. Source media lives in the browser's
   IndexedDB, so it is **per-device** — a project uploaded on one computer
   isn't on another. A managed database (Postgres/Neon/Supabase) plus object
   storage (S3/R2) is required before storing anything important.

3. **TwelveLabs can't see browser uploads.** Pegasus needs a **publicly
   reachable video URL**; it cannot fetch an IndexedDB blob. The ranker
   therefore stays dormant unless `videoUrl`/`TWELVELABS_URL` points to hosted
   media. The upload route that would stage a file and produce such a URL does
   not exist yet.

### AI / quality caveats

4. **Virality scoring needs a transcript, which needs a Groq key.** With no
   key, clips are chosen by **loudness/energy**, not by what is said — fine for
   action content, blind to a quiet punchline. Transcription quality is
   Whisper's; there is **no speaker diarization**, and very long audio is split
   into chunks.

5. **The LLM judges content, not truth.** Clip titles/scores reflect the model's
   read of the transcript; bounds are safe (clamped/snapped/non-overlapping) but
   a clip's *semantic* quality is best-effort, not guaranteed. Free-tier models
   and rate limits can change availability outside our control.

6. **Reference-style transfer is heuristic**, not generative — it approximates
   rhythm/grade/pacing from measurements; it doesn't truly replicate a creator's
   look.

### UI that is cosmetic

7. The left-nav panels — **Transitions, Effects, Overlays, Colour**, and the
   **Uploads** list — are static mockups built for the visual design. Selecting
   options there does **not** alter the video. Real edits happen through the AI
   chat (and clip cutting). The standalone `AIChatPanel`/`AIEditPanel`
   components under `components/editor/` are earlier mockups; the live editor is
   `EditorShell.tsx`.

8. **Manual timeline editing is limited.** Scrubbing, zoom, keyboard transport
   and cut-to-clip work, but there is no drag-to-move, split/razor, or
   multi-track assembly by hand — the AI performs the edits.

### Testing / ops

9. Coverage is **unit/logic-level** (429 Vitest tests). There is no browser
   E2E suite, and the canvas renderer/export path isn't covered end-to-end.
10. `npm run lint` has pre-existing issues; the enforced gates are
    `tsc --noEmit`, `vitest run`, and `next build`.

---

## 5. Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Recommended | LLM brain **and** Whisper transcription (same free key) — <https://console.groq.com/keys> |
| `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `CLOUDFLARE_API_TOKEN` / `OLLAMA_BASE_URL` | Optional | Alternative LLM providers, auto-detected |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_VISION_MODEL` | Optional | Force provider / override models |
| `TWELVELABS_API_KEY` | Optional | Enables the Pegasus visual ranker — <https://platform.twelvelabs.io> |
| `TWELVELABS_URL` / `TWELVELABS_BASE_URL` / `TWELVELABS_MODEL` | Optional | Public video URL / API base (default `https://api.twelvelabs.io/v1.3`) / model (default `pegasus1.5`) |

On Vercel: set keys for the **Production** environment (and Preview if you use
branch deploys), then **redeploy** — variables are read at build time.

---

## 6. Where things live

| Path | What it does |
| --- | --- |
| `src/lib/ai/clips.ts` | Clipping engine: measurement search, grounded viral candidates, scoring/blend, de-overlap |
| `src/lib/ai/twelvelabs.ts` | Optional Pegasus visual ranker (fails silent) |
| `src/lib/ai/llm.ts` | Provider-agnostic LLM access + fallback |
| `src/lib/ai/operations.ts` | Validates and executes edit operations |
| `src/lib/ai/transcribe` (`src/app/api/projects/[id]/transcribe`) | Whisper transcription endpoint |
| `src/lib/ai/styleProfile.ts` / `styleTransfer.ts` / `analyseReference.ts` | Reference-style learning & re-cut |
| `src/lib/ai/highlights.ts` / `visualScan.ts` | Browser loudness & pixel measurements |
| `src/lib/render/engine.ts` | Canvas compositor + `captureStream`/`wireAudio` (export) |
| `src/lib/render/exporter.ts` | Real export: canvas+audio → MediaRecorder → MP4/WebM download |
| `src/app/api/projects/[id]/clips/route.ts` | Clips API: viral detection + Pegasus ranking |
| `src/components/editor/EditorShell.tsx` | The live editor (timeline, preview, AI chat) |
| `src/lib/db.ts` / `mediaDb.ts` | Server store (ephemeral on Vercel) / browser media |

---

## 7. Suggested next steps (in priority order)

1. **Durable storage** — managed DB for accounts/projects + object storage for
   media; this also unlocks a public URL for the TwelveLabs ranker. (Real-time
   browser export now exists; a future ffmpeg/WebCodecs path could export
   faster than real time.)
2. **Pegasus upload staging** — a route that hosts/links uploaded video so the
   visual ranker works on browser uploads.
3. Make the left-nav edit panels (effects/transitions/text) actually apply
   operations, or clearly label them as previews.
4. Faster-than-real-time export (WebCodecs/ffmpeg-wasm) for long videos.
