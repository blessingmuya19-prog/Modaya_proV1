'use client';
/**
 * Brand theme for Modaya's light, blue-and-white SaaS look.
 *
 * Shared by the mode picker (/new), the Studio start/result screens and the
 * dashboard so every creation surface feels like the same polished product:
 * white cards on a soft blue-tinted canvas, blue accents, generous rounding
 * and soft shadows — with one signature glowing "Generate" pill.
 *
 * Video canvases themselves stay black (media surface), but everything around
 * them is light.
 */
import React from 'react';

export const FONT = "'Inter Tight', Inter, system-ui, sans-serif";

/** Signature blue→violet gradient used for the glowing primary actions. */
export const GLOW_GRADIENT = 'linear-gradient(135deg, #4F8CFF 0%, #6E5BFF 100%)';

export const TC = {
  /* canvas + surfaces */
  bg:        '#F4F7FE',   // soft blue-tinted page canvas
  bgGrid:    'rgba(79,140,255,0.05)',
  surface:   '#FFFFFF',   // cards
  surface2:  '#F7F9FE',   // subtle raised panels
  surface3:  '#EEF2FB',   // wells / inputs
  /* borders */
  border:    '#E6EBF5',
  border2:   '#D7DEF0',
  /* brand */
  accent:    '#3B6FF6',
  accentH:   '#5C8CFF',
  glow:      'rgba(90,110,255,0.55)',
  /* text */
  text:      '#0F1B33',
  sec:       '#41506B',
  muted:     '#7A869E',
  dim:       '#9AA5BC',
  green:     '#16A34A',
  danger:    '#E5484D',
  gold:      '#F5B53F',
  /* media surfaces stay dark */
  mediaBg:   '#0B0F1A',
} as const;

export type BrandColors = typeof TC;

/** Soft, elevated SaaS card. */
export const cardStyle: React.CSSProperties = {
  background: TC.surface,
  border: `1px solid ${TC.border}`,
  borderRadius: 18,
  boxShadow: '0 8px 30px rgba(31,54,110,0.08)',
};

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** "lg" is the big hero pill; "md" is a normal CTA. */
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

/**
 * The signature glowing pill CTA — a vivid blue→violet capsule with a soft
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
          background: disabled ? '#C7D0E4' : GLOW_GRADIENT,
          boxShadow: disabled ? 'none' : `0 10px 30px ${TC.glow}, 0 2px 8px rgba(60,90,230,0.35), inset 0 1px 0 rgba(255,255,255,0.28)`,
          transition: 'transform 150ms ease, box-shadow 150ms ease, filter 150ms ease',
          ...style,
        }}
        className="modaya-glow-btn"
      >
        {icon}{children}
      </button>
      <style>{`
        @keyframes modayaGlowPulse {
          0%,100% { box-shadow: 0 10px 30px rgba(90,110,255,0.45), 0 2px 8px rgba(60,90,230,0.30), inset 0 1px 0 rgba(255,255,255,0.28); }
          50%     { box-shadow: 0 12px 42px rgba(90,110,255,0.70), 0 2px 12px rgba(60,90,230,0.45), inset 0 1px 0 rgba(255,255,255,0.32); }
        }
        .modaya-glow-btn:not(:disabled) { animation: modayaGlowPulse 2.6s ease-in-out infinite; }
        .modaya-glow-btn:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.05); }
        .modaya-glow-btn:not(:disabled):active { transform: translateY(0); }
      `}</style>
    </>
  );
}

/** Neutral white/ghost secondary button with a soft border. */
export function GhostButton({ children, fullWidth, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { fullWidth?: boolean }) {
  return (
    <button
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '12px 22px', width: fullWidth ? '100%' : undefined,
        borderRadius: 999, border: `1.5px solid ${TC.border2}`,
        background: TC.surface, color: TC.sec, fontFamily: FONT, fontSize: 14, fontWeight: 600,
        cursor: 'pointer', boxShadow: '0 2px 10px rgba(31,54,110,0.05)',
        transition: 'all 150ms ease', ...style,
      }}
      className="modaya-ghost-btn"
    >
      {children}
    </button>
  );
}
