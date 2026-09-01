'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderOpen, Clock, Plus, BarChart2, Settings } from 'lucide-react';

const TABS = [
  { href: '/dashboard',           icon: FolderOpen, label: 'Projects' },
  { href: '/dashboard/recent',    icon: Clock,      label: 'Recent'   },
  { href: '/upload',              icon: Plus,       label: 'New',      accent: true },
  { href: '/dashboard/analytics', icon: BarChart2,  label: 'Stats'    },
  { href: '/dashboard/settings',  icon: Settings,   label: 'Settings' },
];

export function MobileTabBar() {
  const path = usePathname();
  return (
    <nav className="dashboard-mobile-bar" style={{
      display: 'none', /* shown via CSS at ≤640px */
      position: 'sticky', bottom: 0,
      background: '#070707', borderTop: '1px solid #141414',
      padding: '6px 0 env(safe-area-inset-bottom, 6px)',
      zIndex: 50,
    }}>
      {TABS.map(({ href, icon: Icon, label, accent }) => {
        const active = path === href;
        return (
          <Link key={href} href={href} style={{ textDecoration: 'none', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0' }}>
            {accent ? (
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#4F8CFF', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(79,140,255,0.35)' }}>
                <Icon size={16} color="#fff" strokeWidth={2.5} />
              </div>
            ) : (
              <Icon size={18} color={active ? '#4F8CFF' : '#3A4149'} strokeWidth={active ? 2 : 1.6} />
            )}
            {!accent && (
              <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, fontWeight: 500, letterSpacing: '-0.01em', color: active ? '#4F8CFF' : '#3A4149' }}>{label}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
