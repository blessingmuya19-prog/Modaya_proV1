'use client';
import React, { useState } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function Tooltip({ content, children, position = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  const tipStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 50,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 500,
    color: '#FFFFFF',
    background: '#181818',
    border: '1px solid #242424',
    borderRadius: 6,
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    animation: 'fade-in 0.15s ease',
  };

  if (position === 'top')    { tipStyle.bottom = '100%'; tipStyle.left = '50%'; tipStyle.transform = 'translateX(-50%)'; tipStyle.marginBottom = 8; }
  if (position === 'bottom') { tipStyle.top = '100%'; tipStyle.left = '50%'; tipStyle.transform = 'translateX(-50%)'; tipStyle.marginTop = 8; }
  if (position === 'left')   { tipStyle.right = '100%'; tipStyle.top = '50%'; tipStyle.transform = 'translateY(-50%)'; tipStyle.marginRight = 8; }
  if (position === 'right')  { tipStyle.left = '100%'; tipStyle.top = '50%'; tipStyle.transform = 'translateY(-50%)'; tipStyle.marginLeft = 8; }

  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && <div style={tipStyle}>{content}</div>}
    </div>
  );
}
