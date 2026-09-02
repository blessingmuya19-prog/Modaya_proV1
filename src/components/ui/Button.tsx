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
  sm: { padding: '0 12px', height: '32px', fontSize: '13px' },
  md: { padding: '0 20px', height: '42px', fontSize: '14px' },
  lg: { padding: '0 24px', height: '48px', fontSize: '15px' },
};

const variantStyles = {
  primary: {
    background: '#8B5CF6',
    color: '#050505',
    border: 'none',
    fontWeight: 600,
  },
  secondary: {
    background: '#111111',
    color: '#FFFFFF',
    border: '1px solid #242424',
    fontWeight: 500,
  },
  ghost: {
    background: 'transparent',
    color: '#A1A1A1',
    border: 'none',
    fontWeight: 500,
  },
  danger: {
    background: 'rgba(127,29,29,0.3)',
    color: '#f87171',
    border: '1px solid rgba(127,29,29,0.6)',
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
        borderRadius: '10px',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.5 : 1,
        transition: 'all 150ms ease',
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
          if (variant === 'primary') el.style.background = '#A78BFA';
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget;
        el.style.transform = '';
        if (variant === 'primary') el.style.background = '#8B5CF6';
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
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'all 150ms ease',
        flexShrink: 0,
        ...vr,
        padding: 0,
        ...style,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = variant === 'ghost' ? '#111111' : ''; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = vr.background; }}
      {...props}
    >
      {children}
    </button>
  );
}
