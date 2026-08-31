'use client';
import React, { useState } from 'react';
import { Search, Bell } from 'lucide-react';
import { useAuth } from '@/lib/useAuth';

export function DashboardHeader() {
  const [focused, setFocused] = useState(false);
  const { user } = useAuth();
  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <header style={{
      height: 54, borderBottom: '1px solid #111',
      padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16,
      background: '#070707', position: 'sticky', top: 0, zIndex: 20,
      flexShrink: 0,
    }}>
      {/* Search */}
      <div style={{ flex: 1, maxWidth: 340, minWidth: 0, position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#737D8D', pointerEvents: 'none' }} />
        <input
          type="text"
          placeholder="Search projects..."
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', background: '#0a0a0a',
            border: `1px solid ${focused ? '#2a2a2a' : '#141414'}`,
            borderRadius: 8, paddingLeft: 32, paddingRight: 14, paddingTop: 7, paddingBottom: 7,
            fontSize: 13, color: '#F5F7FA', fontWeight: 400, fontFamily: "'Inter Tight',sans-serif", letterSpacing: '-0.01em', outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 150ms',
          }}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={{
          width: 34, height: 34, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer', color: '#737D8D',
          position: 'relative', transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0e0e0e'; e.currentTarget.style.color = '#737D8D'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#737D8D'; }}
        >
          <Bell size={15} />
          <span style={{ position: 'absolute', top: 7, right: 7, width: 5, height: 5, borderRadius: '50%', background: '#4F8CFF' }} />
        </button>

        <div style={{
          width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
          background: 'rgba(79,140,255,0.1)', border: '1px solid rgba(79,140,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 11, color: '#4F8CFF', fontWeight: 700 }}>{initials}</span>
        </div>
      </div>
    </header>
  );
}
