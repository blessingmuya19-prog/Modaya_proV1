'use client';
/**
 * /new — the "What do you want to create?" mode picker.
 *
 * Two doors into the SAME Studio experience:
 *   • Edit           — the general AI editor: footage + instructions, no
 *                      reference required.
 *   • Reference Edit — the hero: footage + a reference (upload or link) whose
 *                      editing DNA Modaya recreates on the user's footage.
 *
 * Both create a fresh project and route to /studio/[id]?mode=… which simply
 * focuses the drop screen; the editor, engine and every later surface is
 * identical.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Film, Sparkles, Link2, Upload, ArrowRight, Loader2, Wand2, Scissors, Captions } from 'lucide-react';
import { LogoMark } from '@/components/ui/Logo';

const F = "'Inter Tight', Inter, system-ui, sans-serif";
const C = {
  bg: '#050505', s2: '#0a0a0a', s3: '#0e0e0e',
  b: '#111', b3: '#1d1d1d',
  accent: '#4F8CFF', accentH: '#6EA3FF',
  text: '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  gold: '#F5C451',
};

type Mode = 'edit' | 'reference';

export default function NewProjectPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Create a blank project, then enter the Studio focused on the chosen mode. */
  const start = async (mode: Mode) => {
    if (busy) return;
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch('/api/projects/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.projectId) {
        if (res.status === 401) { router.push(`/login?next=/new`); return; }
        setError(data?.error ?? 'Could not start a new project. Please try again.');
        setBusy(null);
        return;
      }
      router.push(`/studio/${data.projectId}?mode=${mode}&new=1`);
    } catch {
      setError('Could not start a new project. Please try again.');
      setBusy(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: F, display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 54, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', borderBottom: `1px solid ${C.b}` }}>
        <Link href="/dashboard" style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13 }}>
          <ArrowLeft size={15} /> Projects
        </Link>
        <div style={{ marginLeft: 'auto' }}><LogoMark size={24} /></div>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 20px' }}>
        <div style={{ width: 'min(94vw, 880px)' }}>
          <div style={{ textAlign: 'center', marginBottom: 34 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <span style={{ width: 52, height: 52, borderRadius: 15, background: `linear-gradient(135deg, ${C.accent}, ${C.accentH})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 28px ${C.accent}44` }}>
                <Wand2 size={24} color="#fff" />
              </span>
            </div>
            <h1 style={{ fontSize: 'clamp(24px, 3.4vw, 34px)', fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 8px' }}>
              What do you want to create?
            </h1>
            <p style={{ color: C.muted, fontSize: 15, margin: 0 }}>
              Your AI video editor. Choose a starting point — you can always add a reference or change direction inside the editor.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }} className="mode-grid">
            {/* ── Reference Edit — the hero card ── */}
            <button
              onClick={() => start('reference')}
              disabled={!!busy}
              className="mode-card mode-card-hero"
              style={{
                position: 'relative', textAlign: 'left', cursor: busy ? 'default' : 'pointer',
                background: `linear-gradient(180deg, ${C.accent}14, ${C.s2} 62%)`,
                border: `1.5px solid ${C.accent}66`, borderRadius: 18, padding: '26px 24px 22px',
                color: C.text, fontFamily: F, overflow: 'hidden',
                boxShadow: `0 18px 60px rgba(0,0,0,0.55), 0 0 0 1px ${C.accent}22 inset`,
                display: 'flex', flexDirection: 'column', minHeight: 320,
              }}>
              {/* "Hero" ribbon */}
              <span style={{ position: 'absolute', top: 14, right: -34, transform: 'rotate(38deg)',
                background: C.gold, color: '#1a1405', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                padding: '3px 40px', textTransform: 'uppercase', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                Most popular
              </span>

              <span style={{ width: 50, height: 50, borderRadius: 13, background: `${C.accent}22`, border: `1px solid ${C.accent}55`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, marginBottom: 18 }}>
                <Sparkles size={23} />
              </span>
              <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>Reference Edit</span>
              <span style={{ fontSize: 13.5, color: C.sec, lineHeight: 1.55, marginBottom: 16 }}>
                Give Modaya a reference — a video you love or a link — and it recreates the
                <b style={{ color: C.text }}> editing style, pacing, transitions and captions</b> on your own footage.
                “Edit my video like this.”
              </span>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
                <Chip icon={<Upload size={11} />} label="Upload reference" />
                <Chip icon={<Link2 size={11} />} label="Paste link" />
                <Chip icon={<Film size={11} />} label="Use a section" />
              </div>

              <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8,
                background: `linear-gradient(135deg, ${C.accent}, ${C.accentH})`, color: '#fff',
                fontSize: 14, fontWeight: 600, borderRadius: 11, padding: '12px 18px', alignSelf: 'flex-start',
                boxShadow: `0 6px 22px ${C.accent}44` }}>
                {busy === 'reference' ? <Loader2 size={15} className="spin" /> : null}
                Start reference edit <ArrowRight size={15} />
              </span>
            </button>

            {/* ── Edit — general AI editor ── */}
            <button
              onClick={() => start('edit')}
              disabled={!!busy}
              className="mode-card"
              style={{
                textAlign: 'left', cursor: busy ? 'default' : 'pointer',
                background: C.s2, border: `1.5px solid ${C.b3}`, borderRadius: 18, padding: '26px 24px 22px',
                color: C.text, fontFamily: F, display: 'flex', flexDirection: 'column', minHeight: 320,
              }}>
              <span style={{ width: 50, height: 50, borderRadius: 13, background: C.s3, border: `1px solid ${C.b3}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, marginBottom: 18 }}>
                <Film size={22} />
              </span>
              <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>Edit</span>
              <span style={{ fontSize: 13.5, color: C.sec, lineHeight: 1.55, marginBottom: 16 }}>
                Tell Modaya how you want your video edited and it does the work —
                cut the dead air, tighten pacing, add captions, set the mood. No reference needed.
              </span>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
                <Chip icon={<Scissors size={11} />} label="Trim & tighten" muted />
                <Chip icon={<Captions size={11} />} label="Auto captions" muted />
                <Chip icon={<Wand2 size={11} />} label="Any vibe" muted />
              </div>

              <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8,
                background: C.s3, color: C.sec, border: `1px solid ${C.b3}`,
                fontSize: 14, fontWeight: 600, borderRadius: 11, padding: '12px 18px', alignSelf: 'flex-start' }}>
                {busy === 'edit' ? <Loader2 size={15} className="spin" /> : null}
                Start editing <ArrowRight size={15} />
              </span>
            </button>
          </div>

          {error && <p style={{ color: '#f87171', textAlign: 'center', fontSize: 13, marginTop: 18 }}>{error}</p>}

          <p style={{ textAlign: 'center', color: C.dim, fontSize: 12, margin: '22px 0 0', lineHeight: 1.6 }}>
            Both modes land in the same editor — your video in the middle, Modaya on the right, the edit map at the bottom.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
        .mode-card { transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
        .mode-card:not(:disabled):hover { transform: translateY(-3px); }
        .mode-card-hero:not(:disabled):hover { box-shadow: 0 26px 70px rgba(0,0,0,0.6), 0 0 0 1px ${C.accent}55 inset; border-color: ${C.accent}; }
        @media (max-width: 720px) { .mode-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

function Chip({ icon, label, muted }: { icon: React.ReactNode; label: string; muted?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 500,
      background: muted ? C.s3 : `${C.accent}12`, border: `1px solid ${muted ? C.b3 : `${C.accent}33`}`,
      color: muted ? C.muted : C.accentH }}>
      {icon}{label}
    </span>
  );
}
