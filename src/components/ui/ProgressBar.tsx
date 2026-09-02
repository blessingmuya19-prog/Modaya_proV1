'use client';
import React from 'react';

interface ProgressBarProps {
  value: number;
  className?: string;
  style?: React.CSSProperties;
  color?: 'accent' | 'white';
  size?: 'sm' | 'md';
}

export function ProgressBar({ value, className, style, color = 'accent', size = 'md' }: ProgressBarProps) {
  const height = size === 'sm' ? 4 : 6;
  const fillColor = color === 'accent' ? '#8B5CF6' : '#FFFFFF';

  return (
    <div
      className={className}
      style={{
        ...style,
        width: '100%',
        height,
        borderRadius: 9999,
        background: '#181818',
        overflow: 'hidden',
      }}
    >
      <div style={{
        height: '100%',
        width: `${Math.min(Math.max(value, 0), 100)}%`,
        borderRadius: 9999,
        background: fillColor,
        transition: 'width 500ms cubic-bezier(0.22,1,0.36,1)',
      }} />
    </div>
  );
}
