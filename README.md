# Modaya

AI video editor. Point it at a reference video and it re-cuts your footage in
that style.

## Running locally

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 101 tests, no browser required
```

## AI setup (optional, free)

The editor runs with **no AI key at all** — requests fall back to a
deterministic rules engine, and every measurement-based feature (reference
style matching, silence detection, cut detection) works regardless, because it
runs locally in the browser.

Adding one free key turns on real language understanding of your requests:

| Provider | Free tier | Get a key |
| --- | --- | --- |
| **Groq** (recommended) | No card, OpenAI-compatible, very fast | <https://console.groq.com/keys> |
| **Google AI Studio** | Free Flash models | <https://aistudio.google.com/apikey> |
| **OpenRouter** | Models with a `:free` suffix | <https://openrouter.ai/keys> |
| **Cloudflare Workers AI** | Free daily allowance | Cloudflare dashboard |
| **Ollama** | Entirely offline, your machine | <https://ollama.com> |

There are three ways to supply the key. Pick the one that matches where the app
is running — a key set in one place is invisible to the others.

**1. Running on your own machine.** Create `.env.local` in the project root:

```bash
GROQ_API_KEY=gsk_...
```

Then confirm it before touching the UI:

```bash
npm run ai:check     # names the provider, sends one request, reports OK or the exact error
```

**2. Without editing files.** Dashboard → Settings → **AI editor**. Paste the
key and press Connect: the server makes a real call to the provider before
saving, so a bad key is rejected immediately instead of silently falling back.
In development the key is written to `.env.local` for you.

**3. Deployed on Vercel.** Settings → Environment Variables → `GROQ_API_KEY`.
Two things catch people out:

- Tick **every environment you use** — Production, Preview and Development. A
  branch that is not your production branch deploys as a Preview and cannot see
  a Production-only variable.
- **Redeploy afterwards.** Variables are read at build time, so a build made
  before you saved the key will never see it. Visit the stable alias
  (`your-project.vercel.app`) rather than a `...-abc123-....vercel.app`
  deployment URL, which pins you to one specific build.

`.env.local` is git-ignored, so a key can never be committed. On Vercel the
filesystem is read-only, so a key entered through the settings page there lasts
only for that serverless instance — use an environment variable instead. The
settings page says which of the two applies.

### When the AI does not answer

The editor never pretends. If a request falls back to the rules engine, the
reply says why, and the cause determines the fix:

| Reply says | Cause | Fix |
| --- | --- | --- |
| "No provider key reached this deployment" | The key is not visible to this build | Check the variable name and environment, then redeploy |
| "could not reach *provider*" | No network route from the server | Firewall, proxy, or an offline sandbox — the key is fine |
| "rejected that key" | Revoked or mistyped key | Regenerate it at the provider |
| "over the free-tier rate limit" | Too many requests | Wait; the key is valid |
| "will not serve this model to your account" | Model not on your tier | Set `LLM_MODEL` to one you can access |

The no-key reply names the commit and environment that answered it, so a stale
deployment is easy to spot. Dashboard → Settings → AI editor lists, by name
only, which provider variables the server can actually see and flags lookalike
misspellings such as `GROK_API_KEY`.

Providers are auto-detected in the order above. Force one with `LLM_PROVIDER`,
and change the model with `LLM_MODEL`.

### Speech recognition

Asking for captions, filler removal, or what was said transcribes the project
first, using Whisper on the **same Groq key** as the editing brain — no second
account. The browser decodes the media to 16 kHz mono, encodes a WAV and
uploads it in chunks split on quiet moments, so a boundary never lands
mid-word. Timestamps come back on the project timeline and are stored with the
project.

It runs on demand, never automatically: it costs a provider call, and most
edits never need words. With a transcript present, `add_captions` writes the
real words at the times they were said, and filler removal cuts only segments
that are *entirely* filler — a segment carrying meaning is never cut for
containing one "um".

### How the AI is wired

The model never edits the timeline directly. It receives the timeline state,
the measured silent spans and any learned reference style, and replies with
JSON: a spoken reply plus a list of **operations** (`remove_ranges`,
`keep_ranges`, `trim_to`, `add_captions`, `punch_in`, `grade`). Those are
validated — unknown ops dropped, timestamps clamped to the video — and then
executed by deterministic code in `src/lib/ai/operations.ts`.

A hallucinated timestamp therefore cannot corrupt a project, and the same
request always produces the same edit.

## Architecture

| Path | What it does |
| --- | --- |
| `src/lib/render/sequence.ts` | Programme model: clips mapping source time onto timeline time |
| `src/lib/render/engine.ts` | Canvas compositor — cuts, push-ins, grading, overlays, double-buffered playback |
| `src/lib/ai/styleProfile.ts` | Measures a reference: cut rhythm, grade, push-ins, captions, beat sync |
| `src/lib/ai/styleTransfer.ts` | Turns a measured style into an edit of your footage |
| `src/lib/ai/analyseReference.ts` | Browser-side frame sampling and audio analysis |
| `src/lib/ai/llm.ts` | Provider-agnostic LLM access with graceful fallback |
| `src/lib/ai/operations.ts` | Validates and executes edit operations |
| `src/lib/mediaDb.ts` | IndexedDB persistence for media and thumbnail frames |

## Data storage — current limitation

`src/lib/db.ts` is an in-process store. In development it persists to
`data/*.json`. **On Vercel it is memory-only**, because the filesystem there is
read-only: accounts, projects and uploads do not survive a new deployment or an
idle instance recycling. Uploaded media is held in the browser's IndexedDB
(`src/lib/mediaDb.ts`), so it is per-device.

This is fine for evaluating the editor and wrong for real use. Connecting a
managed database (Vercel Postgres, Neon or Supabase) is the next step before
anyone stores work they care about.

## Diagnostics

Append `?debug=1` to an editor URL for an overlay showing the render source,
video clock, dropped frames, timeline scroll state and frame extraction
progress. The AI response also carries an `engine` block naming the source
(`llm` or `rules`), the provider, the model, the build, and any failure
reason.
