'use client';
import React, { useState, useEffect } from 'react';
import { Logo } from '../ui/Logo';
import { Menu, X, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { ACCENT, ACCENT_GLOW, ACCENT_BRD, INK, FONT_B } from './kit';

const navLinks = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Proof', href: '#proof' },
  { label: 'Honesty', href: '#honesty' },
  { label: 'Pricing', href: '#pricing' },
];

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 14);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        padding: '14px clamp(16px, 3vw, 34px)',
        transition: 'background 200ms ease, border-color 200ms ease, backdrop-filter 200ms ease',
        background: scrolled ? 'rgba(5,5,5,0.82)' : 'transparent',
        backdropFilter: scrolled ? 'blur(18px) saturate(160%)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(18px) saturate(160%)' : 'none',
        borderBottom: `1px solid ${scrolled ? INK.line : 'transparent'}`,
      }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            <Logo size={26} />
          </Link>

          <nav className="nav-desktop" style={{ margin: '0 auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            {navLinks.map(l => (
              <a key={l.label} href={l.href} style={{
                padding: '8px 15px', fontSize: 13.5, fontWeight: 500, color: INK.mut,
                textDecoration: 'none', borderRadius: 999, letterSpacing: '-0.01em',
                transition: 'color 140ms ease, background 140ms ease',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = INK.txt; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = INK.mut; e.currentTarget.style.background = 'transparent'; }}
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <Link href="/login" style={{
              fontSize: 13.5, fontWeight: 600, color: INK.sec, textDecoration: 'none', padding: '8px 12px',
            }}>
              Sign in
            </Link>
            <Link href="/new" style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 18px',
              fontSize: 13.5, fontWeight: 700, color: '#fff', textDecoration: 'none', borderRadius: 10,
              background: `linear-gradient(180deg, ${ACCENT} 0%, #6845F0 100%)`,
              border: `1px solid ${ACCENT_BRD}`,
              boxShadow: `0 6px 22px ${ACCENT_GLOW}`,
              transition: 'transform 140ms ease, box-shadow 200ms ease',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 10px 30px ${ACCENT_GLOW}`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 6px 22px ${ACCENT_GLOW}`; }}
            >
              Start free <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
          </div>

          <button
            onClick={() => setMenuOpen(v => !v)}
            className="nav-mobile"
            aria-label="Toggle menu"
            style={{ background: 'none', border: 'none', color: INK.txt, cursor: 'pointer', padding: 6 }}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {menuOpen && (
          <div style={{
            marginTop: 10, background: INK.card, border: `1px solid ${INK.line}`, borderRadius: 14, padding: 10,
            display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 1160, marginLeft: 'auto', marginRight: 'auto',
          }}>
            {navLinks.map(l => (
              <a key={l.label} href={l.href} onClick={() => setMenuOpen(false)} style={{
                padding: '12px 14px', fontSize: 14, fontWeight: 500, color: INK.sec,
                textDecoration: 'none', borderRadius: 10, fontFamily: FONT_B,
              }}>{l.label}</a>
            ))}
            <Link href="/new" onClick={() => setMenuOpen(false)} style={{
              marginTop: 6, padding: '12px 14px', fontSize: 14, fontWeight: 700, color: '#fff',
              textDecoration: 'none', borderRadius: 10, textAlign: 'center', background: ACCENT,
            }}>Start free</Link>
          </div>
        )}
      </header>
    </>
  );
}
