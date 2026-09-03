'use client';
/**
 * Brand theme for Modaya — a monochrome, premium look.
 *
 * Pure black canvas (#000000), near-black charcoal raised cards, white text
 * and white primary buttons with black text. Buttons follow a clean, modern
 * SaaS pattern (Opus-style): crisp 12px rounded rectangles, a subtle light
 * gradient for depth, a soft static shadow and a gentle hover.
 *
 * Video canvases are pure black — the darkest surface on screen.
 */
import React from 'react';

export const FONT = "'Inter Tight', Inter, system-ui, sans-serif";

/** Neutral light gradient used for small icon tiles / accents. */
export const GLOW_GRADIENT = 'linear-gradient(135deg, #FFFFFF 0%, #A1A1AA 100%)';

/** The primary button fill — a subtle vertical white → light-grey gradient. */
export const BTN_GRADIENT = 'linear-gradient(180deg, #FFFFFF 0%, #E4E4E7 100%)';
export const BTN_GRADIENT_HOVER = 'linear-gradient(180deg, #F4F4F5 0%, #D4D4D8 100%)';
// Flat (no glow) — used for in-app primary actions. The landing page keeps its
// own glowing buttons; these deliberately carry only a soft contact shadow.
export const BTN_SHADOW = '0 1px 2px rgba(0,0,0,0.5)';
export const BTN_SHADOW_HOVER = '0 2px 6px rgba(0,0,0,0.55)';
export const BTN_SHADOW_ACTIVE = '0 1px 2px rgba(0,0,0,0.5)';

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
  /* brand — monochrome: white is the accent */
  accent:    '#FAFAFA',
  accentH:   '#FFFFFF',
  glow:      'rgba(255,255,255,0.35)',
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
 * The primary SaaS button (Opus-style): a crisp 12px rounded rectangle, white
 * with black text, a subtle vertical light gradient and a gentle hover lift.
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
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: FONT, fontWeight: 600, fontSize, letterSpacing: '-0.01em',
          color: disabled ? '#71717A' : '#000000',
          background: disabled ? '#1C1C21' : BTN_GRADIENT,
          boxShadow: disabled ? 'none' : BTN_SHADOW,
          transition: 'transform 120ms ease, box-shadow 150ms ease, filter 150ms ease, background 150ms ease',
          ...style,
        }}
        className="modaya-btn"
      >
        {icon}{children}
      </button>
      <style>{`
        .modaya-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(0.97); box-shadow: ${BTN_SHADOW_HOVER}; }
        .modaya-btn:not(:disabled):active { transform: translateY(0); filter: brightness(0.92); box-shadow: ${BTN_SHADOW_ACTIVE}; }
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
        .modaya-ghost-btn:hover { background: #27272A; border-color: rgba(255,255,255,0.35); color: #fff; }
        .modaya-ghost-btn:active { transform: translateY(0); }
      `}</style>
    </>
  );
}
