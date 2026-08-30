'use client';
import React from 'react';
import { Search, Bell } from 'lucide-react';

export function DashboardHeader() {
  return (
    <header style={{
      height: 56, borderBottom: '1px solid #242424',
      padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16,
      background: '#0A0A0A', position: 'sticky', top: 0, zIndex: 20,
      flexShrink: 0,
    }}>
      <div style={{ flex: 1, maxWidth: 360, position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#666' }} />
        <input
          type="text"
          placeholder="Search projects..."
          style={{
            width: '100%', background: '#111111', border: '1px solid #242424',
            borderRadius: 8, paddingLeft: 36, paddingRight: 16, paddingTop: 8, paddingBottom: 8,
            fontSize: 13, color: '#FFFFFF', outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#333'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#242424'; }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <button style={{
          width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer', color: '#666', position: 'relative',
          transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#111111'; e.currentTarget.style.color = '#A1A1A1'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#666'; }}
        >
          <Bell size={16} />
          <span style={{
            position: 'absolute', top: 8, right: 8, width: 6, height: 6,
            borderRadius: '50%', background: '#4F8CFF',
          }} />
        </button>

        <div style={{
          width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
          background: 'rgba(79,140,255,0.15)', border: '1px solid rgba(79,140,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 12, color: '#4F8CFF', fontWeight: 700 }}>M</span>
        </div>
      </div>
    </header>
  );
}
