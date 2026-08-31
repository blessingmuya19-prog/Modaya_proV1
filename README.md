# Modaya

AI video editor. Point it at a reference video and it re-cuts your footage in
that style.

## Running locally

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 71 tests, no browser required
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

Copy `.env.example` to `.env.local` and set one key:

```bash
GROQ_API_KEY=gsk_...
```

Providers are auto-detected in the order above. Force one with `LLM_PROVIDER`,
and change the model with `LLM_MODEL`.

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

## Diagnostics

Append `?debug=1` to an editor URL for an overlay showing the render source,
video clock, dropped frames, timeline scroll state and frame extraction
progress.
