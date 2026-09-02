'use client';
/**
 * Brand theme for Modaya — a futuristic, premium AI look.
 *
 * Black canvas (#09090B), charcoal raised cards, a vivid violet accent
 * (#7C3AED) and white text. Buttons follow a clean, modern SaaS pattern
 * (Opus-style): crisp 12px rounded rectangles, a subtle vertical violet
 * gradient for depth, a soft static shadow and a gentle hover lift — no
 * looping glow animation.
 *
 * Video canvases are pure black — the darkest surface on screen.
 */
import React from 'react';

export const FONT = "'Inter Tight', Inter, system-ui, sans-serif";

/** Brand violet → fuchsia gradient (accents, badges, marketing). */
export const GLOW_GRADIENT = 'linear-gradient(180deg,#8B5CF6,#7C3AED)';

/** The primary button fill — a subtle vertical violet gradient for SaaS depth. */
export const BTN_GRADIENT = 'linear-gradient(180deg, #8B5CF6 0%, #7C3AED 100%)';
export const BTN_GRADIENT_HOVER = 'linear-gradient(180deg, #9669F8 0%, #8B4FF0 100%)';
export const BTN_SHADOW = '0 1px 2px rgba(0,0,0,0.35), 0 6px 18px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.18)';
export const BTN_SHADOW_HOVER = '0 2px 4px rgba(0,0,0,0.35), 0 10px 26px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.22)';
export const BTN_SHADOW_ACTIVE = '0 1px 2px rgba(0,0,0,0.4), 0 3px 10px rgba(124,58,237,0.30), inset 0 1px 0 rgba(255,255,255,0.15)';

export const TC = {
  /* canvas + surfaces */
  bg:        '#09090B',   // near-black page canvas
  bgGrid:    'rgba(139,92,246,0.06)',
  surface:   '#101014',   // cards
  surface2:  '#16161C',   // subtle raised panels
  surface3:  '#1E1E26',   // wells / inputs
  /* borders (cool greys) */
  border:    '#26262E',
  border2:   '#33333D',
  /* brand — violet */
  accent:    '#8B5CF6',   // bright violet for text/icons on black
  accentH:   '#A78BFA',   // lighter violet hover
  glow:      'rgba(139,92,246,0.6)',
  /* text */
  text:      '#FAFAFA',
  sec:       '#D4D4D8',
  muted:     '#A1A1AA',
  dim:       '#71717A',
  green:     '#34D399',
  danger:    '#F87171',
  gold:      '#F5B53F',
  /* media surfaces — pure black */
  mediaBg:   '#000000',
} as const;

export type BrandColors = typeof TC;

/** Soft, elevated dark SaaS card. */
export const cardStyle: React.CSSProperties = {
  background: TC.surface,
  border: `1px solid ${TC.border}`,
  borderRadius: 18,
  boxShadow: '0 16px 50px rgba(0,0,0,0.6)',
};

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** "lg" is the hero CTA; "md" is a normal button. */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

/**
 * The primary SaaS button (Opus-style): a crisp 12px rounded rectangle with a
 * subtle vertical violet gradient, a soft static shadow and a gentle hover
 * lift. Clean and product-grade rather than a glowing pill.
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
          border: 'none', borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: FONT, fontWeight: 600, fontSize, letterSpacing: '-0.01em', color: '#fff',
          background: disabled ? '#26262E' : BTN_GRADIENT,
          boxShadow: disabled ? 'none' : BTN_SHADOW,
          transition: 'transform 120ms ease, box-shadow 150ms ease, filter 150ms ease, background 150ms ease',
          ...style,
        }}
        className="modaya-btn"
      >
        {icon}{children}
      </button>
      <style>{`
        .modaya-btn:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: ${BTN_SHADOW_HOVER}; }
        .modaya-btn:not(:disabled):active { transform: translateY(0); filter: brightness(0.98); box-shadow: ${BTN_SHADOW_ACTIVE}; }
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
          cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
          transition: 'all 150ms ease', ...style,
        }}
        className="modaya-ghost-btn"
      >
        {children}
      </button>
      <style>{`
        .modaya-ghost-btn:hover { background: #26262E; border-color: rgba(139,92,246,0.45); color: #fff; }
        .modaya-ghost-btn:active { transform: translateY(0); }
      `}</style>
    </>
  );
}
