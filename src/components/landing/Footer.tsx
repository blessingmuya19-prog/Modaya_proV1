'use client';
import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

const NAV_COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'How it works',  href: '#how-it-works' },
      { label: 'AI capabilities', href: '#ai' },
      { label: 'Use cases',     href: '#use-cases' },
      { label: 'Pricing',       href: '#pricing' },
      { label: 'Changelog',     href: '#' },
    ],
  },
  {
    heading: 'Use cases',
    links: [
      { label: 'Podcasts',      href: '#' },
      { label: 'YouTube',       href: '#' },
      { label: 'Short-form',    href: '#' },
      { label: 'Interviews',    href: '#' },
      { label: 'Webinars',      href: '#' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About',         href: '#' },
      { label: 'Blog',          href: '#' },
      { label: 'Careers',       href: '#', badge: "We're hiring" },
      { label: 'Contact',       href: '#' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy policy',  href: '#' },
      { label: 'Terms of service', href: '#' },
      { label: 'Cookie policy',   href: '#' },
    ],
  },
];

const SOCIALS = [
  { label: 'X',         href: '#', svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },
  { label: 'YouTube',   href: '#', svg: `<svg viewBox="0 0 71 50" fill="currentColor" width="20" height="14"><path d="M69.5 7.8C68.7 4.9 66.4 2.6 63.5 1.8 57.9 0 35.5 0 35.5 0S13.2 0 7.5 1.8C4.6 2.6 2.3 4.9 1.5 7.8 0 13.5 0 25 0 25s0 11.5 1.5 17.2c.8 2.9 3.1 5.2 6 6C13.2 50 35.5 50 35.5 50s22.4 0 28.1-1.8c2.9-.8 5.2-3.1 6-6C71 36.5 71 25 71 25s0-11.5-1.5-17.2zM28.4 35.6V14.4L46.9 25l-18.5 10.6z"/></svg>` },
  { label: 'LinkedIn',  href: '#', svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M20.447 20.452H16.89v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a1.98 1.98 0 0 1-1.977-1.98c0-1.093.885-1.979 1.977-1.979s1.977.886 1.977 1.979a1.98 1.98 0 0 1-1.977 1.98zm1.761 13.019H3.574V9h3.524v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` },
];

// Inline Logo mark matching Logo.tsx style
function FooterLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Mark */}
      <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="8" fill="#4F8CFF" fillOpacity="0.12" />
        <rect x="1" y="1" width="30" height="30" rx="7" stroke="#4F8CFF" strokeOpacity="0.3" strokeWidth="1" />
        <path d="M9 23 L16 9 L23 23" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.5 18 L20.5 18" stroke="#4F8CFF" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {/* Wordmark */}
      <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 17, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.04em' }}>
        Modaya
      </span>
    </div>
  );
}

export function Footer() {
  return (
    <footer style={{
      position: 'relative', zIndex: 0,
      background: '#050505',
      borderTop: '1px solid #141414',
    }}>
      {/* Top section */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(40px,6vw,80px) clamp(16px,3vw,48px) clamp(32px,4vw,56px)' }}>
        <div className="footer-grid">

          {/* Brand column */}
          <div className="footer-brand-col" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <FooterLogo />
            <p style={{ fontSize: 13, color: '#737D8D', lineHeight: 1.5, letterSpacing: '-0.01em', maxWidth: 200, margin: 0 }}>
              Upload your footage.<br />Tell AI how to edit it.
            </p>

            {/* Socials */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              {SOCIALS.map(s => (
                <a key={s.label} href={s.href} aria-label={s.label} style={{
                  width: 34, height: 34, borderRadius: 8,
                  background: '#0f0f0f', border: '1px solid #1e1e1e',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#737D8D', textDecoration: 'none', transition: 'all 200ms ease',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#111'; e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#FFFFFF'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#0a0a0a'; e.currentTarget.style.borderColor = '#141414'; e.currentTarget.style.color = '#737D8D'; }}
                >
                  <span dangerouslySetInnerHTML={{ __html: s.svg }} />
                </a>
              ))}
            </div>

            {/* CTA */}
            <Link href="/upload" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#FFFFFF',
                background: 'linear-gradient(135deg, #4F8CFF 0%, #326FEA 100%)',
                borderRadius: 8, boxShadow: '0 4px 14px rgba(79,140,255,0.25)',
              }}>
                Start editing free <ArrowUpRight size={13} />
              </span>
            </Link>
          </div>

          {/* Nav columns */}
          {NAV_COLS.map(col => (
            <div key={col.heading} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#4D5664', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>
                {col.heading}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.links.map(link => (
                  <a key={link.label} href={link.href} style={{
                    fontSize: 14, color: '#737D8D', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    transition: 'color 200ms ease',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#A1A1A1'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#737D8D'; }}
                  >
                    {link.label}
                    {'badge' in link && link.badge && (
                      <span style={{ fontSize: 9, fontWeight: 600, color: '#4F8CFF', background: 'rgba(79,140,255,0.1)', border: '1px solid rgba(79,140,255,0.2)', padding: '1px 6px', borderRadius: 9999, letterSpacing: '0.04em' }}>
                        {link.badge}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Hairline */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 clamp(16px,3vw,48px)' }}>
        <div style={{ height: 1, background: 'linear-gradient(to right, transparent, #181818 20%, #181818 80%, transparent)' }} />
      </div>

      {/* Bottom bar */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,2vw,24px) clamp(16px,3vw,48px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <p style={{ fontSize: 12, color: '#4D5664', margin: 0 }}>
            © 2026 Modaya. All rights reserved.
          </p>
          <p style={{ fontSize: 12, color: '#222', margin: 0 }}>
            Made for creators who have footage, not time.
          </p>
        </div>
      </div>
    </footer>
  );
}
