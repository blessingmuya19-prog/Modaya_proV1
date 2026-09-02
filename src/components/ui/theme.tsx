'use client';
/**
 * Brand theme for Modaya — a dark, premium SaaS look.
 *
 * Deep blue-black canvas, charcoal raised cards, cool grey borders and a
 * richer, darker blue accent. One signature glowing "Generate" pill (blue →
 * violet) carries every primary action.
 *
 * Video canvases are the darkest surface of all; the product chrome around
 * them is a slightly lighter charcoal so the media still reads as "the stage".
 */
import React from 'react';

export const FONT = "'Inter Tight', Inter, system-ui, sans-serif";

/** Signature darker blue → violet gradient used for the glowing primary actions. */
export const GLOW_GRADIENT = 'linear-gradient(135deg, #3E6FF0 0%, #6A4EE8 100%)';

export const TC = {
  /* canvas + surfaces */
  bg:        '#0B0F1A',   // deep blue-black page canvas
  bgGrid:    'rgba(91,130,255,0.05)',
  surface:   '#141A28',   // cards
  surface2:  '#181F30',   // subtle raised panels
  surface3:  '#1F2739',   // wells / inputs
  /* borders (cool greys) */
  border:    '#242C3E',
  border2:   '#2E3750',
  /* brand — a deeper, richer blue */
  accent:    '#5B82FF',
  accentH:   '#7A9BFF',
  glow:      'rgba(74,108,255,0.55)',
  /* text */
  text:      '#F2F5FC',
  sec:       '#B7C0D4',
  muted:     '#8B95AD',
  dim:       '#5E6885',
  green:     '#34D399',
  danger:    '#F87171',
  gold:      '#F5B53F',
  /* media surfaces — the darkest thing on screen */
  mediaBg:   '#05070D',
} as const;

export type BrandColors = typeof TC;

/** Soft, elevated dark SaaS card. */
export const cardStyle: React.CSSProperties = {
  background: TC.surface,
  border: `1px solid ${TC.border}`,
  borderRadius: 18,
  boxShadow: '0 12px 38px rgba(0,0,0,0.45)',
};

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** "lg" is the big hero pill; "md" is a normal CTA. */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

/**
 * The signature glowing pill CTA — a deep blue→violet capsule with a soft
 * animated glow, like the reference "Generate ✨".
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
          background: disabled ? '#2A3247' : GLOW_GRADIENT,
          boxShadow: disabled ? 'none' : `0 10px 32px ${TC.glow}, 0 2px 10px rgba(46,92,230,0.4), inset 0 1px 0 rgba(255,255,255,0.22)`,
          transition: 'transform 150ms ease, box-shadow 150ms ease, filter 150ms ease',
          ...style,
        }}
        className="modaya-glow-btn"
      >
        {icon}{children}
      </button>
      <style>{`
        @keyframes modayaGlowPulse {
          0%,100% { box-shadow: 0 10px 30px rgba(74,108,255,0.45), 0 2px 10px rgba(46,92,230,0.35), inset 0 1px 0 rgba(255,255,255,0.22); }
          50%     { box-shadow: 0 14px 46px rgba(74,108,255,0.75), 0 2px 14px rgba(46,92,230,0.55), inset 0 1px 0 rgba(255,255,255,0.28); }
        }
        .modaya-glow-btn:not(:disabled) { animation: modayaGlowPulse 2.6s ease-in-out infinite; }
        .modaya-glow-btn:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.08); }
        .modaya-glow-btn:not(:disabled):active { transform: translateY(0); }
      `}</style>
    </>
  );
}

/** Neutral ghost secondary button — transparent with a cool-grey border. */
export function GhostButton({ children, fullWidth, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { fullWidth?: boolean }) {
  return (
    <button
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '12px 22px', width: fullWidth ? '100%' : undefined,
        borderRadius: 999, border: `1.5px solid ${TC.border2}`,
        background: TC.surface3, color: TC.sec, fontFamily: FONT, fontSize: 14, fontWeight: 600,
        cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        transition: 'all 150ms ease', ...style,
      }}
      className="modaya-ghost-btn"
    >
      {children}
    </button>
  );
}
