'use client';
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
}

export function Card({ children, className, hover = false, onClick, padding = 'md', style }: CardProps) {
  const paddings = { none: 0, sm: 12, md: 20, lg: 24 };

  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: '#111111',
        border: '1px solid #242424',
        borderRadius: '16px',
        padding: paddings[padding],
        cursor: onClick ? 'pointer' : undefined,
        transition: hover ? 'all 200ms ease' : undefined,
        ...style,
      }}
      onMouseEnter={e => {
        if (hover) {
          const el = e.currentTarget;
          el.style.borderColor = '#333333';
          el.style.transform = 'translateY(-2px)';
          el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)';
        }
      }}
      onMouseLeave={e => {
        if (hover) {
          const el = e.currentTarget;
          el.style.borderColor = '#242424';
          el.style.transform = '';
          el.style.boxShadow = '';
        }
      }}
    >
      {children}
    </div>
  );
}
