'use client';
import React from 'react';
import { Logo } from '../ui/Logo';
import { FolderOpen, Clock, Settings, Plus, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { label: 'All projects', href: '/dashboard', icon: FolderOpen },
  { label: 'Recent',       href: '/dashboard/recent', icon: Clock },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: '#0A0A0A',
      borderRight: '1px solid #242424',
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #242424' }}>
        <Logo size={26} />
      </div>

      {/* New video */}
      <div style={{ padding: '12px 16px' }}>
        <Link href="/upload" style={{ textDecoration: 'none' }}>
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px', fontSize: 13, fontWeight: 600,
            background: '#4F8CFF', color: '#050505', border: 'none', borderRadius: 10, cursor: 'pointer',
            transition: 'all 150ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#6EA3FF'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#4F8CFF'; }}
          >
            <Plus size={14} /> New video
          </button>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '4px 8px' }}>
        {navItems.map(item => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8, marginBottom: 2,
                background: active ? '#111111' : 'transparent',
                border: `1px solid ${active ? '#242424' : 'transparent'}`,
                color: active ? '#FFFFFF' : '#A1A1A1',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                transition: 'all 150ms ease',
              }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.background = 'rgba(18,18,18,0.5)'; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.color = '#A1A1A1'; e.currentTarget.style.background = 'transparent'; } }}
              >
                <Icon size={15} style={{ color: active ? '#4F8CFF' : '#666', flexShrink: 0 }} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '8px', borderTop: '1px solid #242424' }}>
        <Link href="/dashboard/settings" style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 8,
            color: '#A1A1A1', cursor: 'pointer', fontSize: 13, transition: 'all 150ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(18,18,18,0.5)'; e.currentTarget.style.color = '#FFFFFF'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#A1A1A1'; }}
          >
            <Settings size={15} style={{ color: '#666' }} /> Settings
          </div>
        </Link>

        {/* User */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
          transition: 'background 150ms ease',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(18,18,18,0.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(79,140,255,0.15)', border: '1px solid rgba(79,140,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, color: '#4F8CFF', fontWeight: 700 }}>M</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>My Account</p>
            <p style={{ fontSize: 10, color: '#666', margin: 0 }}>Creator plan</p>
          </div>
          <ChevronRight size={12} style={{ color: '#666', flexShrink: 0 }} />
        </div>
      </div>
    </aside>
  );
}
