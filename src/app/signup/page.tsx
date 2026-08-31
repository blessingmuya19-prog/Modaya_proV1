'use client';
import React, { useState, FormEvent } from 'react';
import Link from 'next/link';

import { Logo } from '@/components/ui/Logo';
import { apiRegister } from '@/lib/useAuth';
import { Eye, EyeOff, ArrowRight, Check } from 'lucide-react';

const F = "'Inter Tight', Inter, system-ui, sans-serif";
const C = {
  bg: '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b: '#111', b2: '#141414', b3: '#1a1a1a',
  text: '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  accent: '#4F8CFF', accentH: '#6EA3FF', err: '#f87171', green: '#34D399',
};

const PERKS = [
  '7-day free trial, no credit card required',
  'Upload up to 10 videos in your trial',
  'Cancel anytime',
];

export default function SignupPage() {


  const [name,     setName    ] = useState('');
  const [email,    setEmail   ] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw  ] = useState(false);
  const [error,    setError   ] = useState('');
  const [loading,  setLoading ] = useState(false);

  const pwStrength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : 3;
  const strengthLabel = ['', 'Weak', 'Good', 'Strong'];
  const strengthColor = ['', '#f87171', '#fb923c', '#34D399'];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    const data = await apiRegister(name, email, password);
    setLoading(false);
    if (data.error) { setError(data.error); return; }
    // Hard redirect so the browser re-sends the new cookie on the next request
    window.location.href = '/dashboard';
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '24px', fontFamily: F }}>
      <style>{`@keyframes page-rise { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }`}</style>

      <div style={{ width: '100%', maxWidth: 440, animation: 'page-rise 420ms cubic-bezier(0.22,1,0.36,1) both' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
          <Logo size={28} />
        </div>

        <h1 style={{ fontFamily: F, fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em',
          color: C.text, margin: '0 0 6px', textAlign: 'center' }}>
          Start for free
        </h1>
        <p style={{ fontFamily: F, fontSize: 14, color: C.muted, margin: '0 0 28px', textAlign: 'center' }}>
          Upload your first video in under a minute
        </p>

        {/* Perks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
          {PERKS.map(p => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(52,211,153,0.12)',
                border: '1px solid rgba(52,211,153,0.3)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0 }}>
                <Check size={9} color={C.green} />
              </div>
              <span style={{ fontFamily: F, fontSize: 12, color: C.sec }}>{p}</span>
            </div>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8,
              fontFamily: F, fontSize: 13, color: C.err }}>{error}</div>
          )}

          {/* Name */}
          <div>
            <label style={{ fontFamily: F, fontSize: 12, fontWeight: 500, color: C.sec,
              display: 'block', marginBottom: 6, letterSpacing: '-0.01em' }}>Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Your name" required autoComplete="name"
              style={{ width: '100%', background: C.s3, border: `1px solid ${C.b3}`, borderRadius: 9,
                padding: '11px 14px', fontFamily: F, fontSize: 14, color: C.text, outline: 'none',
                boxSizing: 'border-box', transition: 'border-color 150ms' }}
              onFocus={e => { e.currentTarget.style.borderColor = C.accent + '66'; }}
              onBlur={e  => { e.currentTarget.style.borderColor = C.b3; }}
            />
          </div>

          {/* Email */}
          <div>
            <label style={{ fontFamily: F, fontSize: 12, fontWeight: 500, color: C.sec,
              display: 'block', marginBottom: 6, letterSpacing: '-0.01em' }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoComplete="email"
              style={{ width: '100%', background: C.s3, border: `1px solid ${C.b3}`, borderRadius: 9,
                padding: '11px 14px', fontFamily: F, fontSize: 14, color: C.text, outline: 'none',
                boxSizing: 'border-box', transition: 'border-color 150ms' }}
              onFocus={e => { e.currentTarget.style.borderColor = C.accent + '66'; }}
              onBlur={e  => { e.currentTarget.style.borderColor = C.b3; }}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{ fontFamily: F, fontSize: 12, fontWeight: 500, color: C.sec,
              display: 'block', marginBottom: 6, letterSpacing: '-0.01em' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters" required autoComplete="new-password"
                style={{ width: '100%', background: C.s3, border: `1px solid ${C.b3}`, borderRadius: 9,
                  padding: '11px 42px 11px 14px', fontFamily: F, fontSize: 14, color: C.text,
                  outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms' }}
                onFocus={e => { e.currentTarget.style.borderColor = C.accent + '66'; }}
                onBlur={e  => { e.currentTarget.style.borderColor = C.b3; }}
              />
              <button type="button" onClick={() => setShowPw(s => !s)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex' }}>
                {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>
            {/* Strength bar */}
            {password.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                  {[1,2,3].map(i => (
                    <div key={i} style={{ flex: 1, height: 3, borderRadius: 9999,
                      background: i <= pwStrength ? strengthColor[pwStrength] : C.b3,
                      transition: 'background 200ms' }} />
                  ))}
                </div>
                <span style={{ fontFamily: F, fontSize: 11, color: strengthColor[pwStrength],
                  fontWeight: 500, minWidth: 40 }}>{strengthLabel[pwStrength]}</span>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading}
            style={{ marginTop: 4, width: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 8, padding: '13px', fontFamily: F, fontSize: 14,
              fontWeight: 600, letterSpacing: '-0.01em',
              background: loading ? C.b3 : C.accent, color: loading ? C.muted : '#fff',
              border: 'none', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : `0 4px 20px ${C.accent}44`, transition: 'all 150ms' }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = C.accentH; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.accent; }}
          >
            {loading ? 'Creating account…' : <><span>Create account</span><ArrowRight size={14}/></>}
          </button>

          <p style={{ fontFamily: F, fontSize: 11, color: C.dim, textAlign: 'center', margin: '4px 0 0' }}>
            By signing up you agree to our{' '}
            <Link href="#" style={{ color: C.muted, textDecoration: 'none' }}>Terms</Link>
            {' '}and{' '}
            <Link href="#" style={{ color: C.muted, textDecoration: 'none' }}>Privacy Policy</Link>
          </p>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
          <div style={{ flex: 1, height: 1, background: C.b2 }} />
          <span style={{ fontFamily: F, fontSize: 11, color: C.dim }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.b2 }} />
        </div>

        <p style={{ fontFamily: F, fontSize: 13, color: C.muted, textAlign: 'center', margin: 0 }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: C.accent, textDecoration: 'none', fontWeight: 500 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
