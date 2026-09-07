'use client';
/**
 * Brand theme for Modaya — dark canvas, one confident accent.
 *
 * Pure black canvas, near-black charcoal raised cards, white text, and a
 * single electric-indigo accent (#7C5CFF) for actions, active states,
 * highlights and the primary button. Dark-mode-first; video canvases are
 * pure black — the darkest surface on screen.
 */
import React from 'react';

/** UI + body text. */
export const FONT = "'Inter',system-ui,-apple-system,sans-serif";
/** Logo + major headlines (Satoshi Bold). */
export const FONT_DISPLAY = "'Satoshi','Inter',system-ui,-apple-system,sans-serif";
/** Technical details / timestamps / processing. */
export const FONT_MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace";

/** The one accent — electric indigo. Actions, active states, highlights. */
export const ACCENT = '#7C5CFF';
export const ACCENT_HI = '#9F8BFF';
export const ACCENT_SOFT = 'rgba(124,92,255,0.13)';
export const ACCENT_BRD = 'rgba(124,92,255,0.42)';
export const ACCENT_GLOW = 'rgba(124,92,255,0.32)';

/** Neutral light gradient used for small icon tiles / accents. */
export const GLOW_GRADIENT = `linear-gradient(135deg, ${ACCENT_HI} 0%, ${ACCENT} 100%)`;

/** The primary button fill — accent gradient, white text, soft glow. */
export const BTN_GRADIENT = `linear-gradient(180deg, ${ACCENT_HI} 0%, ${ACCENT} 100%)`;
export const BTN_GRADIENT_HOVER = 'linear-gradient(180deg, #8F7BFF 0%, #6F4DEE 100%)';
// Flat (no glow) — used for in-app primary actions. The landing page keeps its
// own glowing buttons; these deliberately carry only a soft contact shadow.
export const BTN_SHADOW = `0 1px 2px rgba(0,0,0,0.5), 0 8px 26px ${ACCENT_GLOW}`;
export const BTN_SHADOW_HOVER = `0 2px 8px rgba(0,0,0,0.55), 0 12px 34px ${ACCENT_GLOW}`;
export const BTN_SHADOW_ACTIVE = `0 1px 2px rgba(0,0,0,0.5), 0 4px 14px ${ACCENT_GLOW}`;

export const TC = {
  /* canvas + surfaces */
  bg:        '#000000',   // pure black page canvas
  bgGrid:    'rgba(255,255,255,0.05)',
  surface:   '#0A0A0B',   // cards
  surface2:  '#131316',   // subtle raised panels
  surface3:  '#1C1C21',   // wells / inputs
  /* borders (cool greys) */
  border:    '#27272A',
  border2:   '#3F3F46',
  /* brand — one accent: electric indigo */
  accent:    ACCENT,
  accentH:   ACCENT_HI,
  glow:      ACCENT_GLOW,
  /* text */
  text:      '#FAFAFA',
  sec:       '#D4D4D8',
  muted:     '#A1A1AA',
  dim:       '#71717A',
  green:     '#34D399',
  danger:    '#F87171',
  gold:      '#E4E4E7',
  /* media surfaces — pure black */
  mediaBg:   '#000000',
} as const;

export type BrandColors = typeof TC;

/** Soft, elevated monochrome card. */
export const cardStyle: React.CSSProperties = {
  background: TC.surface,
  border: `1px solid ${TC.border}`,
  borderRadius: 18,
  boxShadow: '0 16px 50px rgba(0,0,0,0.7)',
};

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** "lg" is the hero CTA; "md" is a normal button. */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

/**
 * The primary button — a crisp 12px rounded rectangle in the accent gradient
 * with white text, a soft violet glow and a gentle hover lift.
 */
export function GlowButton({ size = 'md', fullWidth, icon, children, disabled, style, ...rest }: GlowButtonProps) {
  const padY = size === 'lg' ? 14 : 11;
  const fontSize = size === 'lg' ? 16 : 14;
  return (
    <>
      <button
        {...rest}
        disabled={disabled}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: `${padY}px ${size === 'lg' ? 28 : 20}px`,
          width: fullWidth ? '100%' : undefined,
          border: '1px solid rgba(255,255,255,0.16)', borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: FONT, fontWeight: 600, fontSize, letterSpacing: '-0.01em',
          color: disabled ? '#8E909A' : '#FFFFFF',
          background: disabled ? '#17171C' : BTN_GRADIENT,
          boxShadow: disabled ? 'none' : BTN_SHADOW,
          transition: 'transform 120ms ease, box-shadow 150ms ease, filter 150ms ease, background 150ms ease',
          ...style,
        }}
        className="modaya-btn"
      >
        {icon}{children}
      </button>
      <style>{`
        .modaya-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.05); box-shadow: ${BTN_SHADOW_HOVER}; }
        .modaya-btn:not(:disabled):active { transform: translateY(0); filter: brightness(0.96); box-shadow: ${BTN_SHADOW_ACTIVE}; }
      `}</style>
    </>
  );
}

/** Secondary SaaS button — charcoal fill with a cool-grey border. */
export function GhostButton({ children, fullWidth, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { fullWidth?: boolean }) {
  return (
    <>
      <button
        {...rest}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '11px 20px', width: fullWidth ? '100%' : undefined,
          borderRadius: 12, border: `1px solid ${TC.border2}`,
          background: TC.surface3, color: TC.sec, fontFamily: FONT, fontSize: 14, fontWeight: 600,
          cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
          transition: 'all 150ms ease', ...style,
        }}
        className="modaya-ghost-btn"
      >
        {children}
      </button>
      <style>{`
        .modaya-ghost-btn:hover { background: #17171C; border-color: rgba(124,92,255,0.5); color: #fff; }
        .modaya-ghost-btn:active { transform: translateY(0); }
      `}</style>
    </>
  );
}
