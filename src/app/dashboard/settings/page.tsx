'use client';
import React, { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '@/lib/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Check, ChevronRight, Eye, EyeOff, HardDrive, Zap, Shield, Sparkles, X } from 'lucide-react';

const F = "'Uni Neue','Manrope',system-ui,-apple-system,sans-serif";
const C = {
  bg: '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b: '#111', b2: '#141414', b3: '#1a1a1a',
  text: '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  accent: '#FAFAFA', accentH: '#D4D4D8',
  success: '#4ade80', danger: '#f87171', dangerBg: 'rgba(248,113,113,0.07)',
};

const PLANS = [
  {
    id: 'starter', label: 'Starter', price: 'Free',
    perks: ['5 videos / month', '720p export', '30 min footage', 'AI editing'],
  },
  {
    id: 'pro', label: 'Pro', price: '$24 / mo',
    perks: ['Unlimited videos', '4K export', '3 hr footage', 'Priority queue', 'Custom branding'],
    highlight: true,
  },
  {
    id: 'team', label: 'Team', price: '$79 / mo',
    perks: ['Everything in Pro', 'Shared workspace', 'Analytics', 'API access', 'Dedicated support'],
  },
];

/* ── shared field row ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 16 }}>
      <label style={{ fontFamily: F, fontSize: 13, fontWeight: 500, color: C.muted, letterSpacing: '-0.01em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/* ── styled text input ── */
function TInput({
  value, onChange, type = 'text', placeholder = '', disabled = false,
  suffix,
}: {
  value: string; onChange?: (v: string) => void; type?: string;
  placeholder?: string; disabled?: boolean; suffix?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={type} value={value} placeholder={placeholder} disabled={disabled}
        onChange={e => onChange?.(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: disabled ? C.s2 : C.s3,
          border: `1px solid ${focused ? C.accent + '55' : C.b3}`,
          borderRadius: 9, padding: suffix ? '10px 40px 10px 14px' : '10px 14px',
          fontFamily: F, fontSize: 14, color: disabled ? C.muted : C.text,
          outline: 'none', transition: 'border-color 150ms',
          cursor: disabled ? 'not-allowed' : 'text',
        }}
      />
      {suffix && (
        <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
          {suffix}
        </div>
      )}
    </div>
  );
}

/* ── section card ── */
function Section({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.b2}`,
      borderRadius: 14, overflow: 'hidden', marginBottom: 16,
      animation: 'fade-up 360ms cubic-bezier(0.22,1,0.36,1) both',
    }}>
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.b}` }}>
        <h2 style={{ fontFamily: F, fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em',
          color: C.text, margin: 0 }}>{title}</h2>
        {description && (
          <p style={{ fontFamily: F, fontSize: 13, color: C.muted, margin: '4px 0 0', lineHeight: 1.5 }}>
            {description}
          </p>
        )}
      </div>
      <div style={{ padding: '20px 24px' }}>{children}</div>
    </div>
  );
}

/* ── save button ── */
function SaveBtn({ loading, saved }: { loading: boolean; saved: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '9px 20px', fontFamily: F, fontSize: 13, fontWeight: 600,
        letterSpacing: '-0.01em', border: 'none', borderRadius: 9, cursor: loading ? 'not-allowed' : 'pointer',
        background: saved ? 'rgba(74,222,128,0.15)' : C.accent,
        color: saved ? C.success : '#fff',
        boxShadow: saved ? 'none' : `0 2px 16px ${C.accent}33`,
        transition: 'all 200ms',
      }}
    >
      {saved ? <><Check size={13} /> Saved</> : loading ? 'Saving…' : 'Save changes'}
    </button>
  );
}

/* ════════════════════════════════════════ */
export default function SettingsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  /* Profile */
  const [name,         setName        ] = useState('');
  const [email,        setEmail       ] = useState('');
  const [savingProf,   setSavingProf  ] = useState(false);
  const [savedProf,    setSavedProf   ] = useState(false);

  /* Password */
  const [curPw,        setCurPw       ] = useState('');
  const [newPw,        setNewPw       ] = useState('');
  const [showCur,      setShowCur     ] = useState(false);
  const [showNew,      setShowNew     ] = useState(false);
  const [savingPw,     setSavingPw    ] = useState(false);
  const [savedPw,      setSavedPw     ] = useState(false);

  /* Seed from user */
  useEffect(() => {
    if (user) {
      setName(user.name ?? '');
      setEmail(user.email ?? '');
    }
  }, [user]);

  /* Password strength */
  const strength = newPw.length === 0 ? 0
    : newPw.length < 8 ? 1
    : /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? 3 : 2;
  const strengthLabel = ['', 'Weak', 'Fair', 'Strong'][strength];
  const strengthColor = ['', '#f87171', '#fbbf24', '#4ade80'][strength];

  /* ── AI provider key ── */
  const [aiProvider, setAiProvider] = useState('groq');
  const [aiKey,      setAiKey     ] = useState('');
  const [showKey,    setShowKey   ] = useState(false);
  const [aiBusy,     setAiBusy    ] = useState(false);
  const [aiError,    setAiError   ] = useState('');
  const [aiCanForce, setAiCanForce] = useState(false);
  const [aiStatus,   setAiStatus  ] = useState<{
    configured: boolean; provider: string; model: string; keyHint: string; persisted: boolean;
    vision?: { provider: string; model: string } | null;
    note?: string;
    diagnostics?: {
      present: string[]; lookalike: string[]; keyShapedName: string[];
      providers?: { groq: boolean; gemini: boolean; openrouter: boolean };
      vercelEnv: string | null; onVercel: boolean; commit: string | null;
    };
  } | null>(null);

  useEffect(() => {
    fetch('/api/settings/ai')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setAiStatus(d); })
      .catch(() => {});
  }, []);

  const submitAiKey = async (force: boolean) => {
    if (!aiKey.trim()) { addToast('Paste your API key first.', 'error'); return; }
    setAiBusy(true);
    setAiError('');
    try {
      const res  = await fetch('/api/settings/ai', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ provider: aiProvider, key: aiKey.trim(), force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? 'Could not verify that key.');
        setAiCanForce(data.canSaveAnyway === true);
        return;
      }
      setAiStatus(data);
      setAiKey('');
      setAiCanForce(false);
      addToast(
        data.verified
          ? (data.note ? `Key verified. ${data.note}` : `Connected to ${data.provider}. The AI editor is live.`)
          : `Key saved for ${data.provider}, but it could not be tested from here.`,
        data.verified ? 'success' : 'info');
      if (!data.verified && data.warning) setAiError(data.warning);
    } catch {
      setAiError('Could not reach the server.');
    } finally {
      setAiBusy(false);
    }
  };

  const saveAiKey = async (e: FormEvent) => { e.preventDefault(); await submitAiKey(false); };

  const removeAiKey = async () => {
    setAiBusy(true);
    try {
      const res = await fetch('/api/settings/ai', { method: 'DELETE' });
      if (res.ok) { setAiStatus(await res.json()); addToast('Key removed.', 'success'); }
    } finally {
      setAiBusy(false);
    }
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { addToast('Name cannot be empty.', 'error'); return; }
    setSavingProf(true);
    // In a real app: PATCH /api/user { name }
    await new Promise(r => setTimeout(r, 700));
    setSavingProf(false);
    setSavedProf(true);
    addToast('Profile updated.', 'success');
    setTimeout(() => setSavedProf(false), 2500);
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!curPw || !newPw) { addToast('Both fields required.', 'error'); return; }
    if (newPw.length < 8) { addToast('Password must be at least 8 characters.', 'error'); return; }
    setSavingPw(true);
    await new Promise(r => setTimeout(r, 700));
    setSavingPw(false);
    setSavedPw(true);
    setCurPw(''); setNewPw('');
    addToast('Password changed.', 'success');
    setTimeout(() => setSavedPw(false), 2500);
  };

  const plan = user?.plan ?? 'starter';
  const storagePct = Math.min(100, ((user?.storageUsedMb ?? 0) / 5120) * 100);

  return (
    <div className="dashboard-content" style={{ maxWidth: 640 }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: F, fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em',
          color: C.text, margin: '0 0 4px' }}>Settings</h1>
        <p style={{ fontFamily: F, fontSize: 13, color: C.muted, margin: 0 }}>
          Manage your account, plan and preferences.
        </p>
      </div>

      {/* ── Profile ── */}
      <Section title="Profile" description="Your public name and login email.">
        <form onSubmit={saveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Display name">
            <TInput value={name} onChange={setName} placeholder="Your name" />
          </Field>
          <Field label="Email">
            <TInput value={email} disabled placeholder="you@example.com" />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <SaveBtn loading={savingProf} saved={savedProf} />
          </div>
        </form>
      </Section>

      {/* ── Password ── */}
      <Section title="Password" description="Use a strong password you don't use elsewhere.">
        <form onSubmit={savePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Current password">
            <TInput type={showCur ? 'text' : 'password'} value={curPw} onChange={setCurPw}
              placeholder="••••••••"
              suffix={
                <button type="button" onClick={() => setShowCur(s => !s)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', padding: 0 }}>
                  {showCur ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              }
            />
          </Field>
          <Field label="New password">
            <TInput type={showNew ? 'text' : 'password'} value={newPw} onChange={setNewPw}
              placeholder="Min. 8 characters"
              suffix={
                <button type="button" onClick={() => setShowNew(s => !s)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', padding: 0 }}>
                  {showNew ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              }
            />
          </Field>
          {newPw.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4, paddingLeft: 156 }}>
              <div style={{ flex: 1, display: 'flex', gap: 3 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ flex: 1, height: 3, borderRadius: 9999, background: i <= strength ? strengthColor : C.b3, transition: 'background 200ms' }} />
                ))}
              </div>
              <span style={{ fontFamily: F, fontSize: 11, color: strengthColor, fontWeight: 500, minWidth: 36 }}>{strengthLabel}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <SaveBtn loading={savingPw} saved={savedPw} />
          </div>
        </form>
      </Section>

      {/* ── AI provider ── */}
      <Section title="AI editor"
        description="Connect a free AI provider so the editor understands requests in your own words. Without one it still works, using measurement-based rules.">

        {aiStatus && !aiStatus.configured && aiStatus.diagnostics?.onVercel && (
          <div style={{ marginBottom: 16, padding: '12px 14px',
            background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 10, fontFamily: F, fontSize: 12, color: C.text, lineHeight: 1.7 }}>
            <strong style={{ fontWeight: 600 }}>No provider key reached this deployment.</strong>
            <div style={{ marginTop: 6, color: C.dim }}>
              This build is the{' '}
              <span style={{ color: C.text }}>{aiStatus.diagnostics.vercelEnv ?? 'unknown'}</span>{' '}
              environment
              {aiStatus.diagnostics.commit && (
                <> , commit <code style={{ color: C.text }}>{aiStatus.diagnostics.commit}</code></>
              )}.{' '}
              {aiStatus.diagnostics.vercelEnv === 'preview' &&
                'In Vercel, a variable saved for Production only is invisible here — tick Preview as well, then redeploy.'}
              {aiStatus.diagnostics.vercelEnv === 'production' &&
                'Check the variable is saved for Production, then redeploy — env vars are read at build time.'}
            </div>
            {aiStatus.diagnostics.keyShapedName.length > 0 && (
              <div style={{ marginTop: 8, color: C.text }}>
                An API key appears to have been typed into the <em>name</em> field:{' '}
                <code>{aiStatus.diagnostics.keyShapedName.join(', ')}</code>.
                {' '}On Vercel the field labelled &ldquo;Key&rdquo; means the variable&rsquo;s name.
                {' '}Delete that entry and add one whose <em>name</em> is{' '}
                <code>GROQ_API_KEY</code>, <code>GEMINI_API_KEY</code> or{' '}
                <code>OPENROUTER_API_KEY</code>, with your key as the <em>value</em>.
              </div>
            )}

            {aiStatus.diagnostics.lookalike.length > 0 && (
              <div style={{ marginTop: 8, color: C.dim }}>
                Similar names the app does not read:{' '}
                <code style={{ color: C.text }}>{aiStatus.diagnostics.lookalike.join(', ')}</code>.
                {' '}The name must be exactly <code style={{ color: C.text }}>GROQ_API_KEY</code>,{' '}
                <code style={{ color: C.text }}>GEMINI_API_KEY</code> or{' '}
                <code style={{ color: C.text }}>OPENROUTER_API_KEY</code>.
              </div>
            )}
            <div style={{ marginTop: 8, color: C.dim }}>
              Provider variables visible to the server:{' '}
              <code style={{ color: C.text }}>
                {aiStatus.diagnostics.present.length ? aiStatus.diagnostics.present.join(', ') : 'none'}
              </code>
            </div>
          </div>
        )}

        {aiStatus?.configured ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.25)', display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={16} color={C.success} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: C.text }}>
                Connected to {aiStatus.provider}
              </div>
              <div style={{ fontFamily: F, fontSize: 12, color: C.muted }}>
                {aiStatus.model}{aiStatus.keyHint ? ` · key ${aiStatus.keyHint}` : ''}
                {aiStatus.persisted ? ' · saved locally' : ' · this session only'}
              </div>
              {aiStatus.diagnostics && (
                <div style={{ fontFamily: F, fontSize: 12, color: C.dim, marginTop: 2 }}>
                  Keys this build can see:{' '}
                  <code style={{ color: C.text }}>
                    {aiStatus.diagnostics.present.filter(n => /KEY|TOKEN|URL/.test(n)).join(', ') || 'none'}
                  </code>
                  {aiStatus.diagnostics.onVercel && (
                    <> · {aiStatus.diagnostics.vercelEnv ?? 'unknown'} build
                      {aiStatus.diagnostics.commit ? ` ${aiStatus.diagnostics.commit}` : ''}</>
                  )}
                  {!aiStatus.vision && (
                    <> · nothing here can see the video. Variables are read when the build is
                       made, so if you have just added one, redeploy</>
                  )}
                </div>
              )}
              <div style={{ fontFamily: F, fontSize: 12, color: C.dim, marginTop: 2 }}>
                {aiStatus.vision
                  ? `Can see the video · ${aiStatus.vision.model}` +
                    (aiStatus.vision.provider !== aiStatus.provider ? ` via ${aiStatus.vision.provider}` : '')
                  : 'Cannot look at frames — add a Google AI Studio key for that'}
              </div>
            </div>
            <button onClick={removeAiKey} disabled={aiBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px',
                background: 'none', border: `1px solid ${C.b3}`, borderRadius: 8,
                fontFamily: F, fontSize: 12, color: C.muted, cursor: 'pointer' }}>
              <X size={12} /> Remove
            </button>
          </div>
        ) : (
          <form onSubmit={saveAiKey} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Provider">
              <select value={aiProvider} onChange={e => setAiProvider(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', background: C.s2,
                  border: `1px solid ${C.b3}`, borderRadius: 9, color: C.text,
                  fontFamily: F, fontSize: 13, outline: 'none' }}>
                <option value="groq">Groq — free, fastest</option>
                <option value="gemini">Google Gemini — free tier</option>
                <option value="openrouter">OpenRouter — free models</option>
              </select>
            </Field>

            <Field label="API key">
              <TInput type={showKey ? 'text' : 'password'} value={aiKey} onChange={setAiKey}
                placeholder={aiProvider === 'groq' ? 'gsk_…'
                           : aiProvider === 'gemini' ? 'AIza…'
                           : 'sk-or-…'}
                suffix={
                  <button type="button" onClick={() => setShowKey(s => !s)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      color: C.muted, display: 'flex', padding: 0 }}>
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                }
              />
            </Field>

            <p style={{ fontFamily: F, fontSize: 12, color: C.dim, margin: 0, paddingLeft: 156, lineHeight: 1.6 }}>
              Get a free key at{' '}
              <a href={
                aiProvider === 'groq'   ? 'https://console.groq.com/keys'
              : aiProvider === 'gemini' ? 'https://aistudio.google.com/apikey'
              :                           'https://openrouter.ai/keys'}
                target="_blank" rel="noreferrer" style={{ color: C.accent }}>
                {aiProvider === 'groq'   ? 'console.groq.com/keys'
               : aiProvider === 'gemini' ? 'aistudio.google.com/apikey'
               :                           'openrouter.ai/keys'}
              </a>. It is verified before saving, kept on the server, and never shown again.
            </p>

            {aiError && (
              <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)', borderRadius: 9,
                fontFamily: F, fontSize: 12, color: C.text, lineHeight: 1.6 }}>
                {aiError}
                {aiCanForce && (
                  <button type="button" onClick={() => submitAiKey(true)} disabled={aiBusy}
                    style={{ display: 'block', marginTop: 8, padding: '6px 12px',
                      background: 'transparent', border: `1px solid ${C.b3}`, borderRadius: 8,
                      fontFamily: F, fontSize: 12, color: C.text,
                      cursor: aiBusy ? 'default' : 'pointer' }}>
                    Save it anyway, without testing
                  </button>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="submit" disabled={aiBusy}
                style={{ padding: '8px 18px', background: C.accent, border: 'none', borderRadius: 9,
                  fontFamily: F, fontSize: 13, fontWeight: 600, color: '#fff',
                  cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.6 : 1 }}>
                {aiBusy ? 'Verifying…' : 'Connect'}
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* ── Plan ── */}
      <Section title="Plan" description="Your current plan and usage.">
        {/* Usage */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.1)',
            border: `1px solid rgba(255,255,255,0.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HardDrive size={16} color={C.accent} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontFamily: F, fontSize: 12, color: C.sec, fontWeight: 500 }}>Storage used</span>
              <span style={{ fontFamily: F, fontSize: 12, color: C.muted }}>
                {(user?.storageUsedMb ?? 0).toFixed(0)} MB / 5 GB
              </span>
            </div>
            <div style={{ height: 4, background: C.b3, borderRadius: 9999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${storagePct}%`, background: C.accent,
                borderRadius: 9999, transition: 'width 600ms ease' }} />
            </div>
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 4 }}>
          {PLANS.map(p => {
            const active = plan === p.id;
            return (
              <div key={p.id} style={{
                padding: '14px 14px 16px', borderRadius: 11,
                background: active ? 'rgba(255,255,255,0.07)' : C.s2,
                border: `1px solid ${active ? C.accent + '44' : C.b2}`,
                position: 'relative', transition: 'all 150ms',
              }}>
                {p.highlight && !active && (
                  <div style={{ position: 'absolute', top: -1, right: -1, background: C.accent,
                    borderRadius: '0 10px 0 8px', padding: '2px 8px',
                    fontFamily: F, fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
                    POPULAR
                  </div>
                )}
                <p style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: C.text, margin: '0 0 2px' }}>{p.label}</p>
                <p style={{ fontFamily: F, fontSize: 12, color: C.muted, margin: '0 0 10px' }}>{p.price}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                  {p.perks.map((perk, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Check size={10} style={{ color: active ? C.accent : C.dim, flexShrink: 0 }} />
                      <span style={{ fontFamily: F, fontSize: 11, color: active ? C.sec : C.muted }}>{perk}</span>
                    </div>
                  ))}
                </div>
                {active ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5,
                    fontFamily: F, fontSize: 11, fontWeight: 600, color: C.accent }}>
                    <Shield size={11} /> Current plan
                  </div>
                ) : (
                  <button style={{
                    width: '100%', padding: '7px 0', fontFamily: F, fontSize: 12, fontWeight: 600,
                    background: p.highlight ? C.accent : 'transparent',
                    color: p.highlight ? '#fff' : C.muted,
                    border: `1px solid ${p.highlight ? C.accent : C.b3}`,
                    borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 4, transition: 'all 150ms',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = p.highlight ? C.accentH : C.b3; }}
                    onMouseLeave={e => { e.currentTarget.style.background = p.highlight ? C.accent : 'transparent'; }}
                  >
                    {p.highlight ? <><Zap size={11}/> Upgrade</> : <>Select <ChevronRight size={11}/></>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Danger zone ── */}
      <Section title="Danger zone">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', background: C.dangerBg,
          border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10 }}>
          <div>
            <p style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: C.danger, margin: '0 0 3px' }}>
              Delete account
            </p>
            <p style={{ fontFamily: F, fontSize: 12, color: C.muted, margin: 0 }}>
              Permanently remove your account and all data. This cannot be undone.
            </p>
          </div>
          <button
            onClick={() => addToast('Account deletion is disabled on the demo.', 'info')}
            style={{
              flexShrink: 0, marginLeft: 20, padding: '8px 16px',
              fontFamily: F, fontSize: 12, fontWeight: 600,
              background: 'transparent', color: C.danger,
              border: '1px solid rgba(248,113,113,0.35)',
              borderRadius: 8, cursor: 'pointer', transition: 'all 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.dangerBg; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            Delete account
          </button>
        </div>
      </Section>

      <style>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
