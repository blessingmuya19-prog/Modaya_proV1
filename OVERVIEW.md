# Modaya — what it is, what works, and what doesn't

An honest tour of the project as it stands. This is the document to read before
you demo it, build on it, or hand it to someone: it says plainly **what the app
can do today**, **what is only a shell**, and **where the known rough edges
are**. For setup and env vars see [README.md](./README.md).

---

## 1. What Modaya is

A **browser-based AI video editor** (Next.js 16 + React 19) whose guiding
principle is: *the user supplies footage (and optionally a reference video),
and Modaya does the editing* — "Lovable for video", not Premiere Pro with AI
bolted on.

**Entry — two doors into the same Studio** (`/new`, "What do you want to
create?"):
- **Edit** — the general AI editor: footage + instructions, no reference.
- **Reference Edit** (the hero, visually dominant) — footage + a reference
  (upload or link) whose editing DNA Modaya recreates on the user's footage.
Both mint a draft project (`POST /api/projects/new`, mode recorded) and route
to `/studio/[id]?mode=…`, which only focuses the drop screen; the editor,
engine and every later surface are identical.

The default experience (**Studio**, `/studio/[id]`) is deliberately near-empty
of technical UI:

> Drop footage → (optionally) add a reference by **📁 uploading a video or
> 🔗 pasting a direct video link**, optionally scoped to a section with
> **"Use: 00:12 – 01:04"** → (optionally) drop extra clips into the **B-roll
> library** for cutaways → **Create edit** → watch Modaya run named creative
> stages (understand footage → learn reference → find moments → match pacing →
> captions → build edit → render) → get a finished video with **Export**,
> **Regenerate**, and a **"Tell Modaya what to change"** box.

The **reference is style material, never footage Modaya copies** — Modaya
measures its editing decisions (pacing, cuts, zooms, captions) and applies those
principles to the user's own footage. Two inputs are offered in the Reference
block: one reference card offering **[📁 Upload video]** and **[🔗 Paste video
link]** side by side (a dropped file or the upload button is analysed
in-browser; Paste reveals a URL field) — a server route
(`POST /api/reference/fetch`) streams a public **direct media** link back so
the creator can paste "edit my video like this" without downloading. Platform **watch pages** (YouTube, TikTok, Instagram,
Vimeo, X, …) are recognised and *honestly declined* rather than scraped (their
terms and reliability make that fragile; the user is told to upload or use a
direct file link). The route is SSRF-hardened: http/https only, private/loopback/
link-local names and **resolved IPs** refused (blocking DNS-rebinding names),
redirects followed manually and re-checked at every hop, and a 300 MB cap
enforced by content-length *and* a streaming byte count. An optional **time
range** learns style from just one section of a long reference (frames and audio
onsets are sliced/rebased so the profile describes only that window).

There is **no timeline, codec, keyframe or bitrate setting** the user is
expected to touch. After the stages complete the result lands in two surfaces:

- **Reference vs Result (compare).** A side-by-side of the reference and your
  edit with **synced playback** ("play together") so the user can immediately
  see Modaya recreated the editing pattern. Actions: **Export**, or **Iterate**.
- **Iterate** — the transparent editor. Left: the edited video plus Modaya's
  **Edit Map** — a clean row of Hook / Cut / Zoom / Caption / B-roll markers on
  the programme time axis. It is **visual and inspectable, not manually
  editable**: clicking any edit explains the decision in grounded terms ("Cut
  here and removed 1.4s of dead air to match the reference's pace of about 28
  cuts a minute") and, when a reference exists, **links to the matching moment
  in the reference video** — the editor flips to **Side by side**, seeks the
  reference player to the corresponding cut (our k-th cut ↔ the reference cut at
  the same relative position, derived only from the reference's measured cut
  timestamps), and says why they correspond. Right: the Modaya conversation —
  you tell it what to change. A **Your edit / Reference / Side by side** toggle
  switches the playback.

Every regeneration or refinement is saved as a numbered **Version** (its
deterministic recipe, so it rebuilds byte-identically on any device). The
project never resets and nothing is overwritten: reopening a project restores
the latest version with its reference and instructions; older versions are one
click back. The full pro timeline (`/editor/[id]`) remains under
**"Advanced / Take full control"** as a fallback power tool, not the product.

You can also drive editing conversationally in the pro editor: "cut the
silences", "add captions", "find me 5 viral clips", or "re-cut this like this
reference video".

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
| Persistence (media) | Browser **IndexedDB** (`src/lib/mediaDb.ts`) for instant recovery, plus a durable **server object store** (`src/lib/server/mediaStore.ts` + `mediaCloud.ts`): local disk on self-host, S3/R2 in the cloud, in-memory fallback on serverless |
| Persistence (accounts/projects) | In-process store (`src/lib/db.ts`) — **see limitations** |
| Auth | Email/password, bcrypt hashing, JWT sessions |
| AI text | Provider-agnostic (`src/lib/ai/llm.ts`): Groq, Gemini, OpenRouter, Cloudflare, local Ollama — auto-detected |
| Speech-to-text | Groq Whisper `whisper-large-v3-turbo`, chunked uploads |
| Clip ranking (visual) | Optional **TwelveLabs Pegasus 1.5** (`src/lib/ai/twelvelabs.ts`) |
| Tests | Vitest, **538 tests**, no browser required |

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

### Reference-style editing & the EditPlan brain
Drop footage plus an optional reference and Modaya makes the whole creative
decision as data (`src/lib/studio/editPlan.ts`): it measures the reference
(`styleProfile.ts`), measures the source's energy/transcript, then chooses the
strongest **moments** (the best one leads as the **hook**), cuts dead air to the
reference's pace, adds **punch-ins**, burns in **real captions** (Whisper via a
free key; silent without one), fits the **target format** automatically
(9:16 vertical with cover-crop for shorts, 16:9 for long-form re-cuts), and
inserts silent **B-roll cutaways** while the talk track keeps playing. Those
cutaways prefer an uploaded **B-roll library** — extra clips dropped as
cutaway-only material (multi-file, listed with durations, removable) — and
fall back to visually strong, unused parts of the source when no library
exists. Plain-language refinements ("faster", "more punch-ins", "use captions
more") regenerate the plan. This is heuristic analysis of real pixels/audio,
not a neural style transfer.

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

9. Coverage is **unit/logic-level** (538 Vitest tests). There is no browser
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
| `src/components/studio/Studio.tsx` + `src/app/studio/[id]` | The default simple experience: drop footage/reference → guided pipeline → result/export |
| `src/lib/studio/editPlan.ts` | The EditPlan brain: hook-first moment selection, 9:16/16:9 format, real captions, punch-ins, B-roll cutaways |
| `src/lib/studio/refine.ts` | Maps "make it faster / more punch-ins / more captions" onto the StyleProfile and regenerates the plan |
| `src/lib/studio/pipeline.ts` | Pure Studio spine: ordered stages, progress, grounded reference-match score |
| `src/lib/studio/editMap.ts` | **Edit Map**: turns a plan into transparent Hook/Cut/Zoom/Caption/B-roll markers, each with a grounded Modaya explanation, plus `referenceMoment()` that maps an edit onto the matching cut in the reference video |
| `src/lib/studio/versions.ts` | Edit versions — every cut is saved by its deterministic recipe (profile+seed); nothing is overwritten and the project never resets |
| `src/lib/db.ts` / `mediaDb.ts` | Server project records / browser IndexedDB media |
| `src/lib/server/mediaStore.ts` | Durable object store: S3/R2 (SigV4), local fs, in-memory; signed media URLs |
| `src/lib/mediaKeys.ts` / `mediaCloud.ts` | Isomorphic object-key paths / browser client (capability, upload, cross-device rehydrate) |
| `src/app/api/media/…` | Media routes: PUT bytes, Range-aware GET (cookie or HMAC token), DELETE cascade |

---

## 7. Durable media storage

Source footage lives in the browser (IndexedDB) for instant tab-refresh
recovery, and is *also* uploaded to a durable server object store so a project
reopens on any device and a remote ranker can fetch it.

- `src/lib/server/mediaStore.ts` — swappable object store with no SDK / no new
  dependencies. Drivers chosen by environment: **S3/R2-compatible** (hand-rolled
  SigV4 signing over `fetch`, works with Cloudflare R2, AWS S3, MinIO, B2) when
  the S3 vars are set; **local filesystem** (`<DATA_DIR>/media`, default
  `./data/media`) for dev and self-hosted servers; **in-memory** fallback on
  read-only serverless hosts, where the client quietly keeps using IndexedDB.
- `src/lib/mediaKeys.ts` — isomorphic per-project object keys
  (`<project>/main.<ext>`, `/ref/<n>`, `/broll/<n>`, `/out`).
- `src/app/api/media/…` — `PUT` bytes (auth + ownership checked), `GET` stream
  with HTTP **Range** support for seeking; accepts the session cookie or a
  short-lived **HMAC-signed URL** (`?token&exp`) so an external service can
  reach the footage. Project deletion cascades to stored objects.
- `src/lib/mediaCloud.ts` — browser client: capability probe, fire-and-forget
  upload after a local save, and `getProjectMedia()` which reads IndexedDB
  first then the server copy (re-probing metadata and re-caching locally).
  The B-roll library uses the same machinery (`/broll/<n>` objects, backed up
  when an edit uses them, rehydrated on reopen, trimmed server-side when the
  library shrinks).

With durable storage **and** `PUBLIC_BASE_URL` set, the clips route
automatically mints a signed URL for the footage so TwelveLabs Pegasus can rank
the visuals — no separate upload step. All of it degrades to the old behaviour
when storage is absent.

## 8. Suggested next steps (in priority order)

1. ~~Durable storage + Pegasus upload staging~~ — done (section 7).
2. ~~Separate B-roll upload~~ — done: the drop screen has a B-roll library
   (drop/browse multiple clips, listed and removable) persisted like the other
   media (`/broll/<n>` objects, IndexedDB + durable store, rehydrated on
   reopen), and cutaways prefer it over recycled source windows.
3. Make the left-nav edit panels (effects/transitions/text) actually apply
   operations, or clearly label them as previews.
4. Faster-than-real-time export (WebCodecs/ffmpeg-wasm) for long videos.
