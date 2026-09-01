'use client';
import React from 'react';
import { Logo } from '../ui/Logo';
import { FolderOpen, Clock, Settings, Plus, BarChart2, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, apiLogout } from '@/lib/useAuth';

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
      background: '#070707',
      borderRight: '1px solid #141414',
      display: 'flex', flexDirection: 'column',
      height: '100vh',
    }}>
      {/* Logo */}
      <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid #111' }}>
        <Logo size={26} />
      </div>

      {/* New video CTA */}
      <div style={{ padding: '14px 12px 10px' }}>
        <Link href="/upload" style={{ textDecoration: 'none' }}>
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            padding: '10px', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: "'Inter Tight',sans-serif",
            background: '#4F8CFF', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(79,140,255,0.25)',
            transition: 'all 150ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#6EA3FF'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#4F8CFF'; e.currentTarget.style.transform = ''; }}
          >
            <Plus size={14} strokeWidth={2.5} /><span className="sidebar-cta-text"> New video</span>
          </button>
        </Link>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '4px 8px', overflowY: 'auto' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: '#4D5664', letterSpacing: '0.04em', textTransform: 'uppercase', padding: '8px 12px 6px', margin: 0 }}>Workspace</p>
        {navItems.map(item => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8, marginBottom: 1,
                background: active ? '#111' : 'transparent',
                border: `1px solid ${active ? '#1e1e1e' : 'transparent'}`,
                color: active ? '#FFFFFF' : '#737D8D',
                cursor: 'pointer', fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: "'Inter Tight',sans-serif",
                transition: 'all 120ms ease',
              }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.color = '#A1A1A1'; e.currentTarget.style.background = '#0e0e0e'; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.color = '#737D8D'; e.currentTarget.style.background = 'transparent'; } }}
              >
                <Icon size={14} style={{ color: active ? '#4F8CFF' : '#737D8D', flexShrink: 0 }} />
                <span className="sidebar-label">{item.label}</span>
                {active && <div className="sidebar-label" style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: '#4F8CFF' }} />}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Storage */}
      <div className="sidebar-storage" style={{ padding: '12px 16px', borderTop: '1px solid #111' }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: "'Inter Tight',sans-serif", color: '#737D8D' }}>Storage</span>
            <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: "'Inter Tight',sans-serif", color: '#737D8D' }}>{STORAGE_USED}% used</span>
          </div>
          <div style={{ height: 3, background: '#141414', borderRadius: 9999 }}>
            <div style={{ height: '100%', width: `${STORAGE_USED}%`, background: '#4F8CFF', borderRadius: 9999, opacity: 0.7 }} />
          </div>
        </div>

        {/* Settings */}
        <Link href="/dashboard/settings" style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 8, marginBottom: 2,
            color: '#A5ADBA', cursor: 'pointer', fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: "'Inter Tight',sans-serif", transition: 'all 120ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#0e0e0e'; e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#444'; }}
          >
            <Settings size={13} style={{ color: '#4D5664' }} /><span className="sidebar-label"> Settings</span>
          </div>
        </Link>

        {/* User card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px', borderRadius: 10, background: '#0a0a0a', border: '1px solid #111' }}>
          {/* Avatar */}
          <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(79,140,255,0.12)', border: '1px solid rgba(79,140,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, color: '#4F8CFF', fontWeight: 600,
              fontFamily: "'Inter Tight', sans-serif" }}>{initials}</span>
          </div>
          {/* Name + plan */}
          <div className="sidebar-label" style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',
              fontFamily: "'Inter Tight', sans-serif", color: '#F5F7FA',
              margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name ?? '…'}
            </p>
            <p style={{ fontSize: 10, fontWeight: 500, letterSpacing: '-0.01em',
              fontFamily: "'Inter Tight', sans-serif", color: '#737D8D', margin: 0, textTransform: 'capitalize' }}>
              {user?.plan ?? 'starter'} plan
            </p>
          </div>
          {/* Logout */}
          <button onClick={handleLogout} title="Sign out"
            className="sidebar-label"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4D5664',
              display: 'flex', alignItems: 'center', padding: 2, borderRadius: 5, transition: 'color 120ms', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#4D5664'; }}
          ><LogOut size={12}/></button>
        </div>
      </div>
    </aside>
  );
}
