'use client';
import React from 'react';
import { Logo } from '../ui/Logo';
import { FolderOpen, Clock, Settings, Plus, BarChart2, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, apiLogout } from '@/lib/useAuth';
import { TC, FONT } from '../ui/theme';

const navItems = [
  { label: 'All projects', href: '/dashboard',         icon: FolderOpen },
  { label: 'Recent',       href: '/dashboard/recent',  icon: Clock      },
  { label: 'Analytics',    href: '/dashboard/analytics',icon: BarChart2 },
];

const STORAGE_USED = 62; // percent

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user }  = useAuth();

  const handleLogout = async () => {
    await apiLogout();
    router.push('/login');
  };

  // Derive initials
  const initials = user?.name ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '??';

  return (
    <aside className="dashboard-sidebar" style={{
      width: 228, flexShrink: 0,
      background: TC.surface,
      borderRight: `1px solid ${TC.border}`,
      display: 'flex', flexDirection: 'column',
      height: '100vh',
    }}>
      {/* Logo */}
      <div style={{ padding: '18px 20px 16px', borderBottom: `1px solid ${TC.border}` }}>
        <Logo size={26} />
      </div>

      {/* Create video CTA */}
      <div style={{ padding: '14px 12px 10px' }}>
        <Link href="/new" style={{ textDecoration: 'none' }}>
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            padding: '11px', fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', fontFamily: FONT,
            background: 'linear-gradient(135deg,#7C3AED,#A855F7)', color: '#fff', border: 'none', borderRadius: 999, cursor: 'pointer',
            boxShadow: '0 8px 22px rgba(139,92,246,0.5)',
            transition: 'all 150ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.filter = 'brightness(1.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.filter = ''; }}
          >
            <Plus size={15} strokeWidth={2.7} /><span className="sidebar-cta-text"> Create video</span>
          </button>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '4px 8px', overflowY: 'auto' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: TC.dim, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '8px 12px 6px', margin: 0, fontFamily: FONT }}>Workspace</p>
        {navItems.map(item => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 10, marginBottom: 2,
                background: active ? TC.surface3 : 'transparent',
                border: `1px solid ${active ? TC.border2 : 'transparent'}`,
                color: active ? TC.text : TC.sec,
                cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500, letterSpacing: '-0.01em', fontFamily: FONT,
                transition: 'all 120ms ease',
              }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.color = TC.text; e.currentTarget.style.background = TC.surface2; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.color = TC.sec; e.currentTarget.style.background = 'transparent'; } }}
              >
                <Icon size={15} style={{ color: active ? TC.accent : TC.muted, flexShrink: 0 }} />
                <span className="sidebar-label">{item.label}</span>
                {active && <div className="sidebar-label" style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: TC.accent }} />}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Storage */}
      <div className="sidebar-storage" style={{ padding: '12px 16px', borderTop: `1px solid ${TC.border}` }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT, color: TC.muted }}>Storage</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT, color: TC.muted }}>{STORAGE_USED}% used</span>
          </div>
          <div style={{ height: 5, background: TC.surface3, borderRadius: 9999 }}>
            <div style={{ height: '100%', width: `${STORAGE_USED}%`, background: 'linear-gradient(90deg,#7C3AED,#A855F7)', borderRadius: 9999 }} />
          </div>
        </div>

        {/* Settings */}
        <Link href="/dashboard/settings" style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 10, marginBottom: 4,
            color: TC.sec, cursor: 'pointer', fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: FONT, transition: 'all 120ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = TC.surface2; e.currentTarget.style.color = TC.text; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = TC.sec; }}
          >
            <Settings size={14} style={{ color: TC.muted }} /><span className="sidebar-label"> Settings</span>
          </div>
        </Link>

        {/* User card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px', borderRadius: 12, background: TC.surface2, border: `1px solid ${TC.border}` }}>
          {/* Avatar */}
          <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, color: TC.accent, fontWeight: 700,
              fontFamily: FONT }}>{initials}</span>
          </div>
          {/* Name + plan */}
          <div className="sidebar-label" style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
              fontFamily: FONT, color: TC.text,
              margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name ?? '…'}
            </p>
            <p style={{ fontSize: 10, fontWeight: 500, letterSpacing: '-0.01em',
              fontFamily: FONT, color: TC.muted, margin: 0, textTransform: 'capitalize' }}>
              {user?.plan ?? 'starter'} plan
            </p>
          </div>
          {/* Logout */}
          <button onClick={handleLogout} title="Sign out"
            className="sidebar-label"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: TC.muted,
              display: 'flex', alignItems: 'center', padding: 2, borderRadius: 5, transition: 'color 120ms', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = TC.danger; }}
            onMouseLeave={e => { e.currentTarget.style.color = TC.muted; }}
          ><LogOut size={13}/></button>
        </div>
      </div>
    </aside>
  );
}
