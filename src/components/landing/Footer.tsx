'use client';
import React from 'react';
import Link from 'next/link';
import { Logo } from '../ui/Logo';
import { ACCENT, ACCENT_HI, INK, FONT_D, FONT_M } from './kit';

const NAV_COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Proof', href: '#proof' },
      { label: 'Honesty', href: '#honesty' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    heading: 'Use cases',
    links: [
      { label: 'Podcasts', href: '/new' },
      { label: 'YouTube', href: '/new' },
      { label: 'Short-form', href: '/new' },
      { label: 'Interviews', href: '/new' },
      { label: 'Webinars', href: '/new' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { label: 'Start a project', href: '/new' },
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Settings', href: '/dashboard/settings' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy policy', href: '#' },
      { label: 'Terms of service', href: '#' },
      { label: 'Cookie policy', href: '#' },
    ],
  },
];

export function Footer() {
  return (
    <footer style={{ background: '#030304', borderTop: `1px solid ${INK.line}`, padding: 'clamp(50px, 6vw, 80px) clamp(18px, 4vw, 40px) 34px' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 44 }}>
          <Link href="/" style={{ textDecoration: 'none' }}><Logo size={26} /></Link>
          <span style={{ fontSize: 12.5, color: INK.dim, fontFamily: FONT_M }}>
            An AI editor, not a generator. If it can&rsquo;t, it says so.
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 28, marginBottom: 44 }}>
          {NAV_COLS.map(col => (
            <div key={col.heading}>
              <p style={{ fontSize: 11, color: INK.mut, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', margin: '0 0 12px', fontFamily: FONT_D }}>{col.heading}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {col.links.map(l => (
                  <a key={l.label} href={l.href} style={{ fontSize: 13, color: INK.dim, textDecoration: 'none', transition: 'color 130ms ease' }}
                    onMouseEnter={e => { e.currentTarget.style.color = ACCENT_HI; }}
                    onMouseLeave={e => { e.currentTarget.style.color = INK.dim; }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', borderTop: `1px solid ${INK.line}`, paddingTop: 22 }}>
          <span style={{ fontSize: 12, color: INK.dim }}>© {new Date().getFullYear()} Modaya. Built as an editor, not a hype machine.</span>
          <span style={{ fontSize: 11.5, color: INK.dim, fontFamily: FONT_M }}>
            <span style={{ color: ACCENT }}>■</span> dark mode is the only mode
          </span>
        </div>
      </div>
    </footer>
  );
}
