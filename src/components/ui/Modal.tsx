'use client';
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const maxWidths = { sm: 380, md: 460, lg: 560, xl: 680 };

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(5,5,5,0.85)',
          backdropFilter: 'blur(4px)',
          animation: 'fade-in 0.2s ease',
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: maxWidths[size],
        background: '#111111',
        border: '1px solid #242424',
        borderRadius: 16,
        padding: 24,
        boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
        animation: 'slide-up 0.3s cubic-bezier(0.22,1,0.36,1)',
      }}>
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h3 style={{ fontFamily: "'Inter',system-ui,-apple-system,sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.025em', color: '#F5F7FA', margin: 0 }}>
              {title}
            </h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 4, borderRadius: 6, display: 'flex' }}
              onMouseEnter={e => { (e.currentTarget).style.background = '#181818'; (e.currentTarget).style.color = '#A1A1A1'; }}
              onMouseLeave={e => { (e.currentTarget).style.background = 'none'; (e.currentTarget).style.color = '#666'; }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
