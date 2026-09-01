#!/usr/bin/env node
/**
 * Verify the configured AI provider.
 *
 *   npm run ai:check
 *
 * Reads .env.local, works out which provider is configured, sends one tiny
 * request and reports what came back. Never prints the key itself.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

// ── load .env.local without a dependency ──
for (const file of ['.env.local', '.env']) {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k] && v) process.env[k] = v.replace(/^["']|["']$/g, '');
  }
}

const env = k => (process.env[k] ?? '').trim();
const mask = k => (k ? `${k.slice(0, 4)}…${k.slice(-4)} (${k.length} chars)` : '');

const providers = [
  { name: 'groq',       key: () => env('GROQ_API_KEY'),
    model: 'openai/gpt-oss-120b',
    call: (key, model) => openai('https://api.groq.com/openai/v1', key, model) },
  { name: 'gemini',     key: () => env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'),
    model: 'gemini-2.5-flash', call: (key, model) => gemini(key, model) },
  { name: 'openrouter', key: () => env('OPENROUTER_API_KEY'),
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    call: (key, model) => openai('https://openrouter.ai/api/v1', key, model) },
  { name: 'cloudflare', key: () => env('CLOUDFLARE_API_TOKEN') && env('CLOUDFLARE_ACCOUNT_ID'),
    model: '@cf/meta/llama-3.1-8b-instruct', call: (key, model) => cloudflare(model) },
  { name: 'ollama',     key: () => env('OLLAMA_BASE_URL'),
    model: env('LLM_MODEL') || 'llama3.1', call: (key, model) => ollama(model) },
];

const PROMPT = 'Reply with exactly: OK';

async function openai(base, key, model) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 10 }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${body.slice(0, 300)}`);
  return JSON.parse(body).choices?.[0]?.message?.content ?? '(empty reply)';
}

async function gemini(key, model) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT }] }] }) });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${body.slice(0, 300)}`);
  return JSON.parse(body).candidates?.[0]?.content?.parts?.[0]?.text ?? '(empty reply)';
}

async function cloudflare(model) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env('CLOUDFLARE_ACCOUNT_ID')}/ai/run/${model}`,
    { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('CLOUDFLARE_API_TOKEN')}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: PROMPT }] }) });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${body.slice(0, 300)}`);
  return JSON.parse(body).result?.response ?? '(empty reply)';
}

async function ollama(model) {
  const r = await fetch(`${env('OLLAMA_BASE_URL').replace(/\/$/, '')}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], stream: false }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${body.slice(0, 300)}`);
  return JSON.parse(body).message?.content ?? '(empty reply)';
}

const forced = env('LLM_PROVIDER').toLowerCase();
const candidates = forced ? providers.filter(p => p.name === forced) : providers;
const chosen = candidates.find(p => p.key());

if (!chosen) {
  console.log('\n  No AI provider configured.\n');
  console.log('  Add a key to .env.local, for example:');
  console.log('    GROQ_API_KEY=gsk_...        from https://console.groq.com/keys\n');
  console.log('  The editor still works without one — it falls back to the rules engine.\n');
  process.exit(1);
}

const model = env('LLM_MODEL') || chosen.model;
const keyVal = typeof chosen.key() === 'string' ? chosen.key() : '';
console.log(`\n  Provider : ${chosen.name}`);
console.log(`  Model    : ${model}`);
if (keyVal) console.log(`  Key      : ${mask(keyVal)}`);
process.stdout.write('  Testing  : ');

const started = Date.now();
try {
  const reply = await chosen.call(keyVal, model);
  console.log(`OK (${Date.now() - started}ms)`);
  console.log(`  Reply    : ${String(reply).trim().slice(0, 60)}\n`);
  console.log('  The AI panel will now understand requests in your own words.\n');
} catch (err) {
  console.log('FAILED');

  // Say which of these it actually was. "Bad key" is the wrong advice when the
  // machine simply has no route to the provider.
  const msg    = String(err.message ?? err);
  const cause  = err.cause instanceof Error ? err.cause.message : '';
  const status = Number((msg.match(/HTTP (\d{3})/) || [])[1] || 0);
  const offline = !status && /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network|getaddrinfo|timeout/i.test(msg + cause);

  if (offline) {
    console.log(`  Reason   : cannot reach ${chosen.host ?? chosen.name}${cause ? ` — ${cause}` : ''}`);
    console.log('\n  This is a network problem, not a problem with your key.');
    console.log('  Check your connection, a firewall, or an outbound proxy.');
    console.log('  The key is still saved and will work wherever the app can reach the provider.\n');
  } else if (status === 401 || status === 403) {
    console.log(`  Reason   : ${chosen.name} rejected the key (HTTP ${status})`);
    console.log('\n  Copy it again from the provider dashboard — keys get revoked,');
    console.log('  and a paste that drops a character looks exactly like this.\n');
  } else if (status === 429) {
    console.log('  Reason   : over the free-tier rate limit (HTTP 429)');
    console.log('\n  The key is valid. Wait a minute and run this again.\n');
  } else if (status === 404 || /model/i.test(msg)) {
    console.log(`  Reason   : ${chosen.name} will not serve "${model}" to this account`);
    console.log('\n  The key is fine. Set LLM_MODEL in .env.local to a model you can access.\n');
  } else {
    console.log(`  Error    : ${msg}\n`);
  }
  process.exit(1);
}
