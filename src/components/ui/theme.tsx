'use client';
/**
 * Brand theme for Modaya — a futuristic, premium AI look.
 *
 * Black canvas (#09090B), charcoal raised cards, a vivid violet accent
 * (#7C3AED) and white text. One signature glowing violet "Generate" pill
 * carries every primary action.
 *
 * Video canvases are pure black — the darkest surface on screen.
 */
import React from 'react';

export const FONT = "'Inter Tight', Inter, system-ui, sans-serif";

/** Signature violet → fuchsia gradient used for the glowing primary actions. */
export const GLOW_GRADIENT = 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)';

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
  /** "lg" is the big hero pill; "md" is a normal CTA. */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

/**
 * The signature glowing pill CTA — a vivid violet capsule with a soft
 * animated purple glow, like the reference "Generate ✨".
 */
export function GlowButton({ size = 'md', fullWidth, icon, children, disabled, style, ...rest }: GlowButtonProps) {
  const padY = size === 'lg' ? 16 : 12;
  const fontSize = size === 'lg' ? 17 : 14.5;
  return (
    <>
      <button
        {...rest}
        disabled={disabled}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
          padding: `${padY}px ${size === 'lg' ? 34 : 24}px`,
          width: fullWidth ? '100%' : undefined,
          border: 'none', borderRadius: 999, cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: FONT, fontWeight: 700, fontSize, letterSpacing: '-0.01em', color: '#fff',
          background: disabled ? '#26262E' : GLOW_GRADIENT,
          boxShadow: disabled ? 'none' : `0 10px 34px ${TC.glow}, 0 2px 12px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.22)`,
          transition: 'transform 150ms ease, box-shadow 150ms ease, filter 150ms ease',
          ...style,
        }}
        className="modaya-glow-btn"
      >
        {icon}{children}
      </button>
      <style>{`
        @keyframes modayaGlowPulse {
          0%,100% { box-shadow: 0 10px 32px rgba(124,58,237,0.5), 0 2px 12px rgba(168,85,247,0.4), inset 0 1px 0 rgba(255,255,255,0.22); }
          50%     { box-shadow: 0 16px 52px rgba(139,92,246,0.85), 0 2px 18px rgba(168,85,247,0.6), inset 0 1px 0 rgba(255,255,255,0.3); }
        }
        .modaya-glow-btn:not(:disabled) { animation: modayaGlowPulse 2.6s ease-in-out infinite; }
        .modaya-glow-btn:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.1); }
        .modaya-glow-btn:not(:disabled):active { transform: translateY(0); }
      `}</style>
    </>
  );
}

/** Neutral ghost secondary button — charcoal with a cool-grey border. */
export function GhostButton({ children, fullWidth, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { fullWidth?: boolean }) {
  return (
    <button
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '12px 22px', width: fullWidth ? '100%' : undefined,
        borderRadius: 999, border: `1.5px solid ${TC.border2}`,
        background: TC.surface3, color: TC.sec, fontFamily: FONT, fontSize: 14, fontWeight: 600,
        cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
        transition: 'all 150ms ease', ...style,
      }}
      className="modaya-ghost-btn"
    >
      {children}
    </button>
  );
}
