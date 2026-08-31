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
import { detectProvider, chatDetailed, explainFailure, ProviderName } from '@/lib/ai/llm';

const ENV_VAR: Record<string, string> = {
  groq:       'GROQ_API_KEY',
  gemini:     'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const mask = (k: string) =>
  k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`;

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
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  return NextResponse.json(status());
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

  // Apply to the running process, remembering what to restore on failure
  const varName  = ENV_VAR[provider];
  const previous = process.env[varName];
  process.env[varName]  = key;
  process.env.LLM_PROVIDER = provider;

  const rollback = () => {
    if (previous === undefined) delete process.env[varName];
    else process.env[varName] = previous;
    delete process.env.LLM_PROVIDER;
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

  return NextResponse.json({ ...status(), verified: true, persisted: keep() });
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
