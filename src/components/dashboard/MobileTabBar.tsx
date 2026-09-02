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
      background: TC.surface, borderTop: `1px solid ${TC.border}`,
      padding: '6px 0 env(safe-area-inset-bottom, 6px)',
      zIndex: 50,
    }}>
      {TABS.map(({ href, icon: Icon, label, accent }) => {
        const active = path === href;
        return (
          <Link key={href} href={href} style={{ textDecoration: 'none', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0' }}>
            {accent ? (
              <div style={{ width: 40, height: 40, marginTop: -14, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#A855F7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(139,92,246,0.5)', border: '3px solid #101014' }}>
                <Icon size={18} color="#fff" strokeWidth={2.7} />
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
