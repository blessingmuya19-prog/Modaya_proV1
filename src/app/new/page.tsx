'use client';
/**
 * /new — the "What do you want to create?" mode picker.
 *
 * Two doors into the SAME Studio experience:
 *   • Edit           — the general AI editor: footage + instructions.
 *   • Reference Edit — the hero: footage + a reference (upload or link) whose
 *                      editing DNA Modaya recreates on the user's footage.
 *
 * Both create a fresh project and route to /studio/[id]?mode=… which focuses
 * the drop screen; the editor itself is identical.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Film, Sparkles, Link2, Upload, ArrowRight, Loader2, Wand2, Scissors, Captions, Zap } from 'lucide-react';
import { TC, FONT, GLOW_GRADIENT, GlowButton } from '@/components/ui/theme';

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
    <div style={{ minHeight: '100vh', background: TC.bg, color: TC.text, fontFamily: FONT, display: 'flex', flexDirection: 'column',
      backgroundImage: `radial-gradient(circle at 20% 0%, rgba(255,255,255,0.10), transparent 45%), radial-gradient(circle at 85% 15%, rgba(255,255,255,0.10), transparent 45%)` }}>
      <header style={{ height: 58, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', borderBottom: `1px solid ${TC.border}`, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}>
        <Link href="/dashboard" style={{ color: TC.muted, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13.5, fontWeight: 600 }}>
          <ArrowLeft size={15} /> Projects
        </Link>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em' }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: GLOW_GRADIENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#09090B' }}><Wand2 size={14} /></span>
          Modaya
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
        <div style={{ width: 'min(94vw, 900px)' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: TC.accent, background: 'rgba(255,255,255,0.10)', border: `1px solid rgba(255,255,255,0.25)`,
              borderRadius: 999, padding: '5px 13px', marginBottom: 16 }}>
              <Sparkles size={12} /> AI video editor
            </span>
            <h1 style={{ fontSize: 'clamp(26px,3.6vw,38px)', fontWeight: 800, letterSpacing: '-0.035em', margin: '0 0 10px', color: TC.text }}>
              What do you want to create?
            </h1>
            <p style={{ color: TC.muted, fontSize: 15.5, margin: 0, maxWidth: 560, marginInline: 'auto', lineHeight: 1.55 }}>
              Drop your footage and let Modaya do the editing. Start from a style you love, or just tell it what you want.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="mode-grid">
            {/* ── Reference Edit — the hero ── */}
            <ModeCard hero onClick={() => start('reference')} busy={busy === 'reference'} disabled={!!busy}
              icon={<Sparkles size={26} />}
              title="Reference edit"
              body={<>Give Modaya a reference — a video you love or a link — and it recreates the <b>editing style, pacing and captions</b> on your footage. “Edit my video like this.”</>}
              chips={[<Upload size={12} key="u" />, 'Upload reference', <Link2 size={12} key="l" />, 'Paste link', <Film size={12} key="f" />, 'Use a section']}
              cta={busy === 'reference' ? 'Starting…' : 'Generate this style'}
            />
            {/* ── Edit ── */}
            <ModeCard onClick={() => start('edit')} busy={busy === 'edit'} disabled={!!busy}
              icon={<Film size={24} />}
              title="Edit"
              body={<>Tell Modaya how you want your video — cut the dead air, tighten pacing, add captions, set the mood. No reference needed.</>}
              chips={[<Scissors size={12} key="s" />, 'Trim & tighten', <Captions size={12} key="c" />, 'Auto captions', <Zap size={12} key="z" />, 'Any vibe']}
              cta={busy === 'edit' ? 'Starting…' : 'Create video'}
            />
          </div>

          {error && <p style={{ color: TC.danger, textAlign: 'center', fontSize: 13.5, marginTop: 20 }}>{error}</p>}

          <p style={{ textAlign: 'center', color: TC.dim, fontSize: 12.5, margin: '26px 0 0', lineHeight: 1.6 }}>
            Both land in the same editor — your video in the middle, Modaya on the right, the edit map at the bottom.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
        @media (max-width: 740px) { .mode-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

function ModeCard({ hero, icon, title, body, chips, cta, onClick, busy, disabled }: {
  hero?: boolean; icon: React.ReactNode; title: string; body: React.ReactNode;
  chips: React.ReactNode[]; cta: string; onClick: () => void; busy: boolean; disabled: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        position: 'relative', textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
        background: TC.surface,
        border: hero ? `1.5px solid rgba(255,255,255,0.5)` : `1.5px solid ${TC.border}`,
        borderRadius: 22, padding: '28px 26px 24px', color: TC.text, fontFamily: FONT,
        boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
        display: 'flex', flexDirection: 'column', minHeight: 340, overflow: 'hidden',
        transition: 'transform 160ms ease, box-shadow 160ms ease',
      }}
      className={hero ? 'mode-card mode-card-hero' : 'mode-card'}>
      {hero && (
        <>
          <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent 55%)', pointerEvents: 'none' }} />
          <span style={{ position: 'absolute', top: 16, right: -34, transform: 'rotate(38deg)',
            background: '#F4F4F5', color: '#09090B', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
            padding: '3px 42px', textTransform: 'uppercase', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
            Most popular
          </span>
        </>
      )}

      <span style={{ width: 54, height: 54, borderRadius: 15, marginBottom: 18, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hero ? GLOW_GRADIENT : TC.surface3,
        color: hero ? '#09090B' : TC.muted,
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)', border: hero ? 'none' : `1px solid ${TC.border2}` }}>
        {icon}
      </span>
      <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 8, position: 'relative' }}>{title}</span>
      <span style={{ fontSize: 14, color: TC.sec, lineHeight: 1.6, marginBottom: 18, position: 'relative' }}>{body}</span>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 22, position: 'relative' }}>
        {chips.map((c, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999,
            fontSize: 11.5, fontWeight: 600,
            background: hero ? 'rgba(255,255,255,0.12)' : TC.surface3,
            border: `1px solid ${hero ? 'rgba(255,255,255,0.30)' : TC.border}`,
            color: hero ? TC.accent : TC.muted }}>
            {c}
          </span>
        ))}
      </div>

      <span style={{ marginTop: 'auto', position: 'relative' }}>
        <GlowButton size="lg" disabled={disabled} style={{ opacity: busy ? 0.85 : 1 }}>
          {busy ? <Loader2 size={17} className="spin" /> : null}
          {cta} <ArrowRight size={17} />
        </GlowButton>
      </span>
    </button>
  );
}
