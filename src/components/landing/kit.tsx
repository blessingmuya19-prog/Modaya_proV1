'use client';
/**
 * Modaya brand kit — the landing design system.
 *
 * One accent: electric indigo. Dark canvas, generous whitespace, product
 * forward. Fonts: Satoshi (display) / Inter (body) / JetBrains Mono (proof
 * details) — loaded once in root layout, never fetched per component.
 */
import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const ACCENT      = '#7C5CFF';
export const ACCENT_HI   = '#9F8BFF';
export const ACCENT_SOFT = 'rgba(124, 92, 255, 0.13)';
export const ACCENT_TINT = 'rgba(124, 92, 255, 0.08)';
export const ACCENT_BRD  = 'rgba(124, 92, 255, 0.42)';
export const ACCENT_GLOW = 'rgba(124, 92, 255, 0.32)';

export const INK = {
  bg:    '#050505',
  card:  '#0B0B0E',
  card2: '#121216',
  well:  '#17171C',
  line:  '#232329',
  line2: '#33333B',
  txt:   '#FAFAFA',
  sec:   '#C9CBD2',
  mut:   '#8E909A',
  dim:   '#5E606B',
} as const;

export const FONT_D = "'Satoshi','Inter',system-ui,-apple-system,sans-serif";
export const FONT_B = "'Inter',system-ui,-apple-system,sans-serif";
export const FONT_M = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace";

/* ── primitives ─────────────────────────────────────────────────────────── */

export function Overline({ children, tone = 'accent' }: { children: React.ReactNode; tone?: 'accent' | 'muted' }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 14px', borderRadius: 999,
      background: tone === 'accent' ? ACCENT_TINT : 'rgba(255,255,255,0.05)',
      border: `1px solid ${tone === 'accent' ? ACCENT_BRD : INK.line}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 8px ${ACCENT_GLOW}` }} />
      <span style={{ fontSize: 11, color: tone === 'accent' ? ACCENT_HI : INK.sec, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
        {children}
      </span>
    </div>
  );
}

export function SectionHead({ overline, title, accent, body }: {
  overline: string; title: React.ReactNode; accent?: React.ReactNode; body?: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 'clamp(44px, 6vw, 84px)' }}>
      <div style={{ marginBottom: 22 }}><Overline>{overline}</Overline></div>
      <h2 style={{
        fontFamily: FONT_D, fontWeight: 800, fontSize: 'clamp(30px, 5vw, 54px)',
        letterSpacing: '-0.035em', lineHeight: 1.04, color: INK.txt, margin: '0 0 18px',
      }}>
        {title}{accent ? <> <span style={{ color: ACCENT }}>{accent}</span></> : null}
      </h2>
      {body && (
        <p style={{ fontSize: 'clamp(15px, 1.2vw, 17px)', color: INK.sec, maxWidth: 520, margin: '0 auto', lineHeight: 1.65, fontWeight: 400 }}>
          {body}
        </p>
      )}
    </div>
  );
}

/** The one primary action — accent fill, white text, soft glow. */
export function PrimaryButton({ href, children, sub, size = 'lg' }: {
  href: string; children: React.ReactNode; sub?: string; size?: 'lg' | 'md';
}) {
  const h = size === 'lg' ? 'clamp(50px, 5vh, 62px)' : 42;
  const fs = size === 'lg' ? 16.5 : 14;
  const px = size === 'lg' ? 'clamp(26px, 3vw, 44px)' : 20;
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        height: h, padding: `0 ${px}`, fontSize: fs, fontWeight: 700, letterSpacing: '-0.01em',
        color: '#FFFFFF', background: `linear-gradient(180deg, ${ACCENT_HI} 0%, ${ACCENT} 100%)`,
        border: '1px solid rgba(255,255,255,0.18)', borderRadius: 13, cursor: 'pointer',
        boxShadow: `0 1px 2px rgba(0,0,0,0.5), 0 10px 32px ${ACCENT_GLOW}, inset 0 1px 0 rgba(255,255,255,0.25)`,
        transition: 'transform 150ms ease, box-shadow 200ms ease, filter 150ms ease',
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 2px 4px rgba(0,0,0,0.5), 0 16px 44px ${ACCENT_GLOW}, inset 0 1px 0 rgba(255,255,255,0.3)`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 1px 2px rgba(0,0,0,0.5), 0 10px 32px ${ACCENT_GLOW}, inset 0 1px 0 rgba(255,255,255,0.25)`; }}
      >
        {children} <ArrowRight size={size === 'lg' ? 19 : 15} strokeWidth={2.4} />
      </span>
      {sub && <span style={{ fontSize: 12.5, color: INK.mut }}>{sub}</span>}
    </Link>
  );
}

export function GhostLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, height: 'clamp(46px, 4.5vh, 54px)',
      padding: '0 22px', fontSize: 14.5, fontWeight: 600, color: INK.sec,
      background: INK.card, border: `1px solid ${INK.line2}`, borderRadius: 12,
      textDecoration: 'none', transition: 'border-color 150ms ease, color 150ms ease',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT_BRD; e.currentTarget.style.color = INK.txt; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = INK.line2; e.currentTarget.style.color = INK.sec; }}
    >
      {children}
    </Link>
  );
}

/** Section canvas wrapper — breadcrumb of the dark rhythm. */
export function Section({ id, children, grid = true, pad = true }: {
  id?: string; children: React.ReactNode; grid?: boolean; pad?: boolean;
}) {
  return (
    <section id={id} style={{
      position: 'relative', overflow: 'hidden', background: INK.bg,
      padding: pad ? 'clamp(76px, 10vw, 130px) clamp(18px, 4vw, 40px)' : 0,
    }}>
      {grid && (
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
          backgroundImage: `linear-gradient(${INK.line}22 1px, transparent 1px), linear-gradient(90deg, ${INK.line}22 1px, transparent 1px)`,
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 0%, transparent 70%)',
        }} />
      )}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1160, margin: '0 auto' }}>{children}</div>
    </section>
  );
}

/** Reveal-on-view wrapper (IntersectionObserver, no library). */
export function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setOn(true); }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(28px)',
      transition: `opacity 600ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 600ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
    }}>
      {children}
    </div>
  );
}

export function Card({ children, hover = true, style }: {
  children: React.ReactNode; hover?: boolean; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: INK.card, border: `1px solid ${INK.line}`, borderRadius: 18,
      padding: 'clamp(20px, 2.4vw, 32px)', height: '100%',
      transition: 'border-color 200ms ease, background 200ms ease, transform 200ms ease',
      ...style,
    }}
      onMouseEnter={e => { if (hover) { e.currentTarget.style.borderColor = ACCENT_BRD; e.currentTarget.style.background = INK.card2; e.currentTarget.style.transform = 'translateY(-3px)'; } }}
      onMouseLeave={e => { if (hover) { e.currentTarget.style.borderColor = INK.line; e.currentTarget.style.background = INK.card; e.currentTarget.style.transform = ''; } }}
    >
      {children}
    </div>
  );
}
