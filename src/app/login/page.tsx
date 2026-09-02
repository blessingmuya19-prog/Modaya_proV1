'use client';
import React, { useState, FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui/Logo';
import { apiLogin } from '@/lib/useAuth';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';

const F = "'Inter Tight', Inter, system-ui, sans-serif";
const C = {
  bg: '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b: '#111', b2: '#141414', b3: '#1a1a1a',
  text: '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  accent: '#8B5CF6', accentH: '#A78BFA', err: '#f87171',
};

// ── Inner component that calls useSearchParams() ──────────────────────────────
function LoginForm() {
  const params = useSearchParams();
  const next   = params.get('next') ?? '/dashboard';

  const [email,    setEmail   ] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw  ] = useState(false);
  const [error,    setError   ] = useState('');
  const [loading,  setLoading ] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    const data = await apiLogin(email, password);
    setLoading(false);
    if (data.error) { setError(data.error); return; }
    // Hard redirect so the browser re-sends the new cookie on the next request
    window.location.href = next;
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '24px', fontFamily: F }}>
      <style>{`@keyframes page-rise { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }`}</style>

      {/* Card */}
      <div style={{ width: '100%', maxWidth: 420, animation: 'page-rise 420ms cubic-bezier(0.22,1,0.36,1) both' }}>
        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
          <Logo size={28} />
        </div>

        <h1 style={{ fontFamily: F, fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em',
          color: C.text, margin: '0 0 6px', textAlign: 'center' }}>
          Welcome back
        </h1>
        <p style={{ fontFamily: F, fontSize: 14, fontWeight: 400, color: C.muted,
          margin: '0 0 20px', textAlign: 'center' }}>
          Sign in to continue editing
        </p>

        {/* Demo notice */}
        <div style={{ padding: '10px 14px', background: 'rgba(139,92,246,0.06)',
          border: '1px solid rgba(139,92,246,0.18)', borderRadius: 8, marginBottom: 20 }}>
          <p style={{ fontFamily: F, fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.5 }}>
            <span style={{ color: C.accent, fontWeight: 600 }}>Demo mode:</span>{' '}
            This is a hosted demo — accounts reset between sessions.
            If you can&apos;t sign in, <a href="/signup" style={{ color: C.accent, textDecoration: 'none' }}>create a new account</a> to continue.
          </p>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8,
              fontFamily: F, fontSize: 13, color: C.err }}>
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label style={{ fontFamily: F, fontSize: 12, fontWeight: 500, color: C.sec,
              display: 'block', marginBottom: 6, letterSpacing: '-0.01em' }}>
              Email
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoComplete="email"
              style={{ width: '100%', background: C.s3, border: `1px solid ${C.b3}`,
                borderRadius: 9, padding: '11px 14px', fontFamily: F, fontSize: 14,
                color: C.text, outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 150ms' }}
              onFocus={e  => { e.currentTarget.style.borderColor = C.accent + '66'; }}
              onBlur={e   => { e.currentTarget.style.borderColor = C.b3; }}
            />
          </div>

          {/* Password */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontFamily: F, fontSize: 12, fontWeight: 500, color: C.sec,
                letterSpacing: '-0.01em' }}>
                Password
              </label>
              <Link href="#" style={{ fontFamily: F, fontSize: 12, color: C.accent,
                textDecoration: 'none', letterSpacing: '-0.01em' }}>
                Forgot password?
              </Link>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required autoComplete="current-password"
                style={{ width: '100%', background: C.s3, border: `1px solid ${C.b3}`,
                  borderRadius: 9, padding: '11px 42px 11px 14px', fontFamily: F, fontSize: 14,
                  color: C.text, outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms' }}
                onFocus={e => { e.currentTarget.style.borderColor = C.accent + '66'; }}
                onBlur={e  => { e.currentTarget.style.borderColor = C.b3; }}
              />
              <button type="button" onClick={() => setShowPw(s => !s)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex' }}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button type="submit" disabled={loading}
            style={{ marginTop: 4, width: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 8, padding: '13px', fontFamily: F, fontSize: 14,
              fontWeight: 600, letterSpacing: '-0.01em', background: loading ? C.b3 : C.accent,
              color: loading ? C.muted : '#fff', border: 'none', borderRadius: 10,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : `0 4px 20px ${C.accent}44`, transition: 'all 150ms' }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = C.accentH; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.accent; }}
          >
            {loading ? 'Signing in…' : <><span>Sign in</span><ArrowRight size={14}/></>}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
          <div style={{ flex: 1, height: 1, background: C.b2 }} />
          <span style={{ fontFamily: F, fontSize: 11, color: C.dim }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.b2 }} />
        </div>

        <p style={{ fontFamily: F, fontSize: 13, color: C.muted, textAlign: 'center', margin: 0 }}>
          Don&apos;t have an account?{' '}
          <Link href="/signup" style={{ color: C.accent, textDecoration: 'none', fontWeight: 500 }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Default export wraps LoginForm in Suspense (required by Next.js 15+) ─────
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#050505', display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #8B5CF6',
          borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
