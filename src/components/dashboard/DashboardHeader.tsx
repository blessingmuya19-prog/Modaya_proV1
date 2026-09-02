'use client';
import React, { useState } from 'react';
import { Search, Bell } from 'lucide-react';
import { useAuth } from '@/lib/useAuth';
import { TC, FONT } from '../ui/theme';

export function DashboardHeader() {
  const [focused, setFocused] = useState(false);
  const { user } = useAuth();
  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <header style={{
      height: 54, borderBottom: `1px solid ${TC.border}`,
      padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16,
      background: TC.surface, position: 'sticky', top: 0, zIndex: 20,
      flexShrink: 0,
    }}>
      {/* Search */}
      <div style={{ flex: 1, maxWidth: 340, minWidth: 0, position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TC.muted, pointerEvents: 'none' }} />
        <input
          type="text"
          placeholder="Search projects..."
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', background: TC.surface3,
            border: `1px solid ${focused ? TC.accent + '66' : TC.border2}`,
            borderRadius: 999, paddingLeft: 32, paddingRight: 14, paddingTop: 8, paddingBottom: 8,
            fontSize: 13, color: TC.text, fontWeight: 400, fontFamily: FONT, letterSpacing: '-0.01em', outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 150ms',
          }}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={{
          width: 34, height: 34, borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer', color: TC.muted,
          position: 'relative', transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = TC.surface2; e.currentTarget.style.color = TC.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = TC.muted; }}
        >
          <Bell size={16} />
          <span style={{ position: 'absolute', top: 7, right: 7, width: 5, height: 5, borderRadius: '50%', background: TC.accent }} />
        </button>

        <div style={{
          width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
          background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 11, color: TC.accent, fontWeight: 700 }}>{initials}</span>
        </div>
      </div>
    </header>
  );
}
