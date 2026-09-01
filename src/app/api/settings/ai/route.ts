/**
 * GET  /api/settings/ai   → what provider is configured (never the key itself)
 * POST /api/settings/ai   → set a key from the UI, verify it, and keep it
 * DELETE /api/settings/ai → forget it
 *
 * Why this exists: editing .env.local isn't possible for everyone (hosted
 * previews, non-technical users). The key is applied to the running process
 * immediately, and in development it is also written to .env.local so it
 * survives a restart. It is never echoed back, never logged, and never stored
 * in the database.
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCurrentUser } from '@/lib/auth';
import { visionRoute, detectProvider, chatDetailed, explainFailure, ProviderName } from '@/lib/ai/llm';

const ENV_VAR: Record<string, string> = {
  groq:       'GROQ_API_KEY',
  gemini:     'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const mask = (k: string) =>
  k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`;

/** Every variable name the app actually reads. */
const KNOWN = [
  'GROQ_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OLLAMA_BASE_URL',
  'LLM_PROVIDER', 'LLM_MODEL',
];

/**
 * Names only — never values. This answers the two questions that actually go
 * wrong on a hosted deploy: was the variable given to *this* environment, and
 * was it spelled the way the app reads it.
 */
function diagnostics() {
  const present = KNOWN.filter(k => (process.env[k] ?? '').trim() !== '');

  /* "I added the key to Vercel" fails in three ways: saved for the wrong
     environment, spelled differently, or saved after this build was made.
     Naming each provider variable and whether it arrived answers all three
     at a glance — and it is names only, never values. */
  const providers = {
    groq:       (process.env.GROQ_API_KEY ?? '').trim() !== '',
    gemini:     (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim() !== '',
    openrouter: (process.env.OPENROUTER_API_KEY ?? '').trim() !== '',
  };

  // Anything key-shaped the app does not read — catches GROK_API_KEY,
  // GROQ_KEY, or a trailing space in the name.
  const lookalike = Object.keys(process.env)
    .filter(k => !KNOWN.includes(k))
    .filter(k => /GROQ|GROK|GEMINI|GOOGLE|AISTUDIO|AI_STUDIO|VISION|OPENROUTER|OPEN_ROUTER|CLAUDE|OPENAI|LLM|AI_KEY|API_KEY/i.test(k))
    .map(k => (k !== k.trim() ? `"${k}" (has whitespace in the name)` : k))
    .slice(0, 12);

  // Vercel labels the name field "Key", so the API key itself gets typed there
  // with the value left blank. The variable name is then the secret, which is
  // why only its shape is reported, never the text.
  const keyShapedName = Object.keys(process.env)
    .filter(k => /^(gsk_|sk-|sk_or_|AIza|hf_|xai-|csk-)/i.test(k))
    .map(k => `${k.slice(0, 4)}… (${k.length} chars)`)
    .slice(0, 4);

  return {
    present,
    lookalike,
    keyShapedName,
    providers,
    // 'preview' here with an empty `present` means the variable was saved for
    // Production only — the single most common mistake.
    vercelEnv: process.env.VERCEL_ENV ?? null,
    onVercel:  !!process.env.VERCEL,
    commit:    (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
  };
}

function status() {
  const cfg = detectProvider();
  const name = cfg.name as ProviderName;
  const key  = name in ENV_VAR ? (process.env[ENV_VAR[name]] ?? '') : '';
  return {
    configured: cfg.ready,
    provider:   cfg.name,
    model:      cfg.model,
    keyHint:    key ? mask(key) : '',
    persisted:  process.env.NODE_ENV === 'development',
    /* Sight is a separate capability from answering, and worth stating: a
       working key does not mean the editor can look at the video. */
    vision:     (() => {
      const route = visionRoute(cfg.name);
      return route ? { provider: route.provider, model: route.model } : null;
    })(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  return NextResponse.json({ ...status(), diagnostics: diagnostics() });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body     = await req.json().catch(() => ({}));
  const provider = String(body.provider ?? 'groq').toLowerCase();
  const key      = String(body.key ?? '').trim();

  if (!(provider in ENV_VAR)) {
    return NextResponse.json({ error: 'Unsupported provider.' }, { status: 400 });
  }
  if (key.length < 8 || /\s/.test(key)) {
    return NextResponse.json(
      { error: 'That does not look like an API key — check for a missing character or a stray space.' },
      { status: 400 });
  }

  /* Catch the key that belongs to a different provider before asking that
     provider to reject it. The shapes are distinctive enough to be sure. */
  const shapeComplaint =
      provider === 'gemini'     && key.startsWith('gsk_')
        ? 'That is a Groq key (they start with gsk_). A Google AI Studio key starts with AIza.'
    : provider === 'gemini'     && key.startsWith('sk-or-')
        ? 'That is an OpenRouter key. A Google AI Studio key starts with AIza.'
    : provider === 'gemini'     && !key.startsWith('AIza')
        ? 'Google AI Studio keys start with AIza and are about 39 characters. ' +
          'Check you copied the API key from aistudio.google.com/apikey, not a project id or an OAuth token.'
    : provider === 'groq'       && !key.startsWith('gsk_')
        ? 'Groq keys start with gsk_. Check you copied the whole key from console.groq.com/keys.'
    : provider === 'openrouter' && !key.startsWith('sk-or-')
        ? 'OpenRouter keys start with sk-or-. Check you copied the whole key from openrouter.ai/keys.'
    : null;

  if (shapeComplaint && body.force !== true) {
    return NextResponse.json({ error: shapeComplaint, reason: 'wrong_shape', canSaveAnyway: true },
                             { status: 400 });
  }

  // Apply to the running process, remembering what to restore on failure
  const varName  = ENV_VAR[provider];
  const previous = process.env[varName];
  const before   = detectProvider();

  /* Someone who already has a working provider and adds a second key is
     usually adding a capability, not replacing what works. Keep whoever was
     answering in charge; the new key is still used wherever it is better —
     frames, for one. Nothing to switch back and forth. */
  const alreadyWorking = before.ready && before.name !== provider;
  const previousForced = process.env.LLM_PROVIDER;

  process.env[varName] = key;

  /* Point the verification ping at the provider whose key this is. Without
     this it tests whoever happened to be answering already, and a Google key
     is "verified" by a Groq reply — which is no verification at all. */
  process.env.LLM_PROVIDER = provider;

  /** Where LLM_PROVIDER should end up once the check is done. */
  const settle = () => {
    if (!alreadyWorking) { process.env.LLM_PROVIDER = provider; return; }
    if (previousForced === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previousForced;
  };

  const rollback = () => {
    if (previous === undefined) delete process.env[varName];
    else process.env[varName] = previous;
    if (previousForced === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previousForced;
  };

  const keep = () => {
    const persisted = process.env.NODE_ENV === 'development' ? writeEnvLocal(varName, key) : false;
    return persisted;
  };

  // Verify against the real provider before we keep it
  const out = await chatDetailed([{ role: 'user', content: 'Reply with exactly: OK' }], { timeoutMs: 15_000 });

  if (!out.ok) {
    const message = explainFailure(out.reason, provider, out.detail);

    // The key itself is fine — the network, the model choice or a rate limit is
    // the problem. Refusing to save would be wrong, so offer to save anyway.
    const keyNotAtFault = out.reason === 'unreachable' || out.reason === 'timeout';
    if (keyNotAtFault && body.force === true) {
      const persisted = keep();
      settle();
      return NextResponse.json({ ...status(), verified: false, persisted, warning: message });
    }

    rollback();
    const httpStatus =
      out.reason === 'unauthorized'      ? 400 :
      out.reason === 'rate_limited'      ? 429 :
      out.reason === 'unreachable'       ? 503 :
      out.reason === 'timeout'           ? 504 :
      out.reason === 'model_unavailable' ? 502 : 502;

    return NextResponse.json(
      { error: message, reason: out.reason, canSaveAnyway: keyNotAtFault },
      { status: httpStatus });
  }

  settle();

  const now  = status();
  const note = alreadyWorking
    ? `${before.name} still answers your requests; the ${provider} key is added alongside it` +
      (now.vision?.provider === provider ? ' and now handles looking at frames.' : '.')
    : now.vision?.provider === provider
      ? `${provider} is answering, and it can look at frames.`
      : `${provider} is answering. No model here can look at frames yet.`;

  return NextResponse.json({ ...now, verified: true, persisted: keep(), note });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  for (const v of Object.values(ENV_VAR)) delete process.env[v];
  delete process.env.LLM_PROVIDER;
  if (process.env.NODE_ENV === 'development') {
    for (const v of Object.values(ENV_VAR)) writeEnvLocal(v, '');
  }
  return NextResponse.json(status());
}

/** Update a single variable in .env.local, leaving everything else intact. */
function writeEnvLocal(name: string, value: string): boolean {
  try {
    const path = resolve(process.cwd(), '.env.local');
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, 'm');

    const next = pattern.test(existing)
      ? existing.replace(pattern, line)
      : `${existing.replace(/\s*$/, '')}\n${line}\n`;

    writeFileSync(path, next.startsWith('\n') ? next.slice(1) : next, 'utf8');
    return true;
  } catch {
    return false;      // read-only filesystem (e.g. Vercel) — runtime only
  }
}
