'use client';
import React from 'react';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="8" width="12" height="16" rx="3" fill="#4F8CFF" opacity="0.9" />
      <rect x="18" y="8" width="12" height="16" rx="3" fill="#4F8CFF" opacity="0.4" />
      <line x1="16" y1="5" x2="16" y2="27" stroke="#4F8CFF" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
      <path d="M13.5 16 L18.5 16" stroke="#050505" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface LogoProps { size?: number; showWordmark?: boolean; className?: string; style?: React.CSSProperties; }

export function Logo({ size = 32, showWordmark = true, style }: LogoProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>
      <LogoMark size={size} />
      {showWordmark && (
        <span style={{
          fontFamily: "'Inter Tight', sans-serif",
          fontWeight: 700,
          fontSize: size * 0.62,
          letterSpacing: '-0.04em',
          color: '#FFFFFF',
          lineHeight: 1,
        }}>
          Modaya
        </span>
      )}
    </div>
  );
}
