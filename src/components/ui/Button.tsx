'use client';
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const sizeStyles = {
  sm: { padding: '0 14px', height: '34px', fontSize: '13px' },
  md: { padding: '0 20px', height: '42px', fontSize: '14px' },
  lg: { padding: '0 26px', height: '48px', fontSize: '15px' },
};

const BTN_SHADOW = '0 1px 2px rgba(0,0,0,0.35), 0 6px 18px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.18)';
const BTN_SHADOW_HOVER = '0 2px 4px rgba(0,0,0,0.35), 0 10px 26px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.22)';
const BTN_BG = 'linear-gradient(180deg,#8B5CF6,#7C3AED)';
const BTN_BG_HOVER = 'linear-gradient(180deg,#9669F8,#8B4FF0)';

const variantStyles = {
  primary: {
    background: BTN_BG,
    color: '#FFFFFF',
    border: 'none',
    fontWeight: 600,
    boxShadow: BTN_SHADOW,
  },
  secondary: {
    background: '#1E1E26',
    color: '#FFFFFF',
    border: '1px solid #33333D',
    fontWeight: 500,
  },
  ghost: {
    background: 'transparent',
    color: '#A1A1AA',
    border: 'none',
    fontWeight: 500,
  },
  danger: {
    background: 'rgba(248,113,113,0.12)',
    color: '#f87171',
    border: '1px solid rgba(248,113,113,0.4)',
    fontWeight: 500,
  },
};

export function Button({
  variant = 'primary', size = 'md', loading = false,
  icon, iconRight, children, className, disabled, style, ...props
}: ButtonProps) {
  const sz = sizeStyles[size];
  const vr = variantStyles[variant];

  return (
    <button
      disabled={disabled || loading}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        borderRadius: '12px',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.5 : 1,
        transition: 'transform 120ms ease, box-shadow 150ms ease, background 150ms ease, filter 150ms ease',
        userSelect: 'none',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...sz,
        ...vr,
        ...style,
      }}
      onMouseEnter={e => {
        if (!disabled && !loading) {
          const el = e.currentTarget;
          el.style.transform = 'translateY(-1px)';
          if (variant === 'primary') { el.style.background = BTN_BG_HOVER; el.style.boxShadow = BTN_SHADOW_HOVER; }
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.transform = '';
        if (variant === 'primary') { el.style.background = BTN_BG; el.style.boxShadow = BTN_SHADOW; }
      }}
      {...props}
    >
      {loading ? (
        <svg style={{ width:16, height:16, animation:'spin 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      ) : icon ? <span style={{ display:'flex', flexShrink:0 }}>{icon}</span> : null}
      {children}
      {iconRight && !loading && <span style={{ display:'flex', flexShrink:0 }}>{iconRight}</span>}
    </button>
  );
}

export function IconButton({
  children, variant = 'ghost', size = 'md', style, ...props
}: ButtonProps) {
  const sz = { sm: 28, md: 36, lg: 44 }[size];
  const vr = variantStyles[variant];

  return (
    <button
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: sz,
        height: sz,
        borderRadius: '10px',
        cursor: 'pointer',
        transition: 'all 150ms ease',
        flexShrink: 0,
        ...vr,
        boxShadow: 'none',
        padding: 0,
        ...style,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = variant === 'ghost' ? '#1E1E26' : ''; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = vr.background; }}
      {...props}
    >
      {children}
    </button>
  );
}
