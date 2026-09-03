'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderOpen, Clock, Plus, BarChart2, Settings } from 'lucide-react';
import { TC, FONT } from '../ui/theme';

const TABS = [
  { href: '/dashboard',           icon: FolderOpen, label: 'Projects' },
  { href: '/dashboard/recent',    icon: Clock,      label: 'Recent'   },
  { href: '/new',                 icon: Plus,       label: 'Create',  accent: true },
  { href: '/dashboard/analytics', icon: BarChart2,  label: 'Stats'    },
  { href: '/dashboard/settings',  icon: Settings,   label: 'Settings' },
];

export function MobileTabBar() {
  const path = usePathname();
  return (
    <nav className="dashboard-mobile-bar" style={{
      display: 'none', /* shown via CSS at ≤640px */
      position: 'sticky', bottom: 0,
      background: 'rgba(10,10,11,0.72)',
      backdropFilter: 'blur(18px) saturate(160%)',
      WebkitBackdropFilter: 'blur(18px) saturate(160%)',
      borderTop: '1px solid rgba(255,255,255,0.10)',
      padding: '6px 0 env(safe-area-inset-bottom, 6px)',
      zIndex: 50,
    }}>
      {TABS.map(({ href, icon: Icon, label, accent }) => {
        const active = path === href;
        return (
          <Link key={href} href={href} style={{ textDecoration: 'none', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0' }}>
            {accent ? (
              <div style={{
                width: 46, height: 46, marginTop: -18, borderRadius: '50%',
                background: 'rgba(255,255,255,0.10)',
                backdropFilter: 'blur(14px) saturate(180%)',
                WebkitBackdropFilter: 'blur(14px) saturate(180%)',
                border: '1px solid rgba(255,255,255,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 10px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.25)',
              }}>
                <Icon size={20} color="#FFFFFF" strokeWidth={2.6} />
              </div>
            ) : (
              <Icon size={19} color={active ? TC.accent : TC.muted} strokeWidth={active ? 2.2 : 1.7} />
            )}
            {!accent && (
              <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: '-0.01em', color: active ? TC.accent : TC.muted }}>{label}</span>
            )}
            {accent && (
              <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: TC.accent }}>{label}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
