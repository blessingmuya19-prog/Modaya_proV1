'use client';
import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'error' | 'ai';
  size?: 'sm' | 'md';
  className?: string;
  dot?: boolean;
}

const variantStyles = {
  default: { background: '#181818', border: '1px solid #242424', color: '#A1A1A1' },
  accent:  { background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#8B5CF6' },
  success: { background: 'rgba(20,83,45,0.4)', border: '1px solid rgba(22,101,52,0.6)', color: '#4ade80' },
  warning: { background: 'rgba(120,53,15,0.4)', border: '1px solid rgba(146,64,14,0.6)', color: '#fbbf24' },
  error:   { background: 'rgba(127,29,29,0.4)', border: '1px solid rgba(153,27,27,0.6)', color: '#f87171' },
  ai:      { background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#8B5CF6' },
};

const dotColors = {
  default: '#666666', accent: '#8B5CF6', success: '#4ade80',
  warning: '#fbbf24', error: '#f87171', ai: '#8B5CF6',
};

export function Badge({ children, variant = 'default', size = 'md', className, dot }: BadgeProps) {
  const vr = variantStyles[variant];
  const padding = size === 'sm' ? '2px 8px' : '3px 12px';
  const fontSize = size === 'sm' ? '11px' : '12px';

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontWeight: 500,
        borderRadius: '9999px',
        padding,
        fontSize,
        ...vr,
      }}
    >
      {dot && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: dotColors[variant],
          flexShrink: 0,
          animation: 'pulse-dot 1.5s ease-in-out infinite',
        }} />
      )}
      {children}
    </span>
  );
}
