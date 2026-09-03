'use client';
import React, { useState, useEffect } from 'react';
import { Logo } from '../ui/Logo';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';

const navLinks = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Use cases',    href: '#examples' },
  { label: 'Pricing',      href: '#pricing' },
  { label: 'Help',         href: '#' },
];

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrolled = scrollY > 10;

  // Pill scales from 1 → 1.04 as you scroll down, back to 1 when at top
  const pillScale = scrolled ? 1 + Math.min(scrollY / 1200, 0.04) : 1;

  // Glass becomes more opaque and blurrier as you scroll
  const glassBlur = scrolled ? Math.min(20 + scrollY / 15, 40) : 20;
  const glassBg = scrolled
    ? `rgba(10,10,12,${Math.min(0.72 + scrollY / 1200, 0.9)})`
    : 'rgba(28,28,33,0.55)';
  const glassBorder = scrolled
    ? `rgba(58,68,94,${Math.min(0.7 + scrollY / 3000, 1)})`
    : 'rgba(46,55,80,0.6)';

  return (
    <>
      {/* Full-width blur zone behind pill */}
      <div aria-hidden style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 90,
        zIndex: 9990, pointerEvents: 'none',
        backdropFilter: scrolled ? `blur(${Math.min(scrollY / 8, 18)}px)` : 'none',
        WebkitBackdropFilter: scrolled ? `blur(${Math.min(scrollY / 8, 18)}px)` : 'none',
        background: scrolled
          ? `linear-gradient(to bottom, rgba(0,0,0,${Math.min(scrollY / 300, 0.8)}) 0%, transparent 100%)`
          : 'transparent',
        maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
      }} />

      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        zIndex: 9999, padding: 'clamp(10px,1.5vw,16px) clamp(16px,2.5vw,28px)', pointerEvents: 'none',
      }}>
        {/* Glass pill — zooms in on scroll, zooms out on return */}
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          pointerEvents: 'auto',
          position: 'relative',
          transform: `scale(${pillScale})`,
          transformOrigin: 'top center',
          transition: 'transform 400ms cubic-bezier(0.22,1,0.36,1)',
          borderRadius: 9999,
        }}>
          {/* Glass layer — separate from content so blur never touches children */}
          <div style={{
            position: 'absolute', inset: 0,
            borderRadius: 9999,
            background: glassBg,
            backdropFilter: `blur(${glassBlur}px) saturate(180%)`,
            WebkitBackdropFilter: `blur(${glassBlur}px) saturate(180%)`,
            border: `1px solid ${glassBorder}`,
            boxShadow: scrolled
              ? `0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,${Math.min(0.04 + scrollY / 5000, 0.1)})`
              : '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
            transition: 'background 200ms ease, box-shadow 200ms ease, border-color 200ms ease',
            pointerEvents: 'none',
          }} />

          {/* Frosted glass top highlight */}
          <div style={{
            position: 'absolute', top: 0, left: '10%', right: '10%', height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)',
            pointerEvents: 'none', zIndex: 1,
          }} />

          {/* Content — sits above glass layer, never blurred */}
          <div style={{
            position: 'relative', zIndex: 2,
            padding: '10px 10px 10px 20px',
            display: 'flex', alignItems: 'center',
          }}>

          {/* Logo */}
          <Link href="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
            <Logo size={26} />
          </Link>

          {/* Nav links — dead centre */}
          <nav style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 2,
          }} className="nav-desktop">
            {navLinks.map(link => (
              <a key={link.label} href={link.href} style={{
                padding: '7px 15px', fontSize: 14, fontWeight: 500,
                color: '#A1A1AA', textDecoration: 'none', borderRadius: 9999,
                transition: 'color 150ms ease, background 150ms ease',
                whiteSpace: 'nowrap', letterSpacing: '-0.01em',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = '#FAFAFA'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#A1A1AA'; e.currentTarget.style.background = 'transparent'; }}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Right — auth */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Link href="/dashboard" style={{ textDecoration: 'none' }} className="nav-desktop">
              <button style={{
                padding: '8px 18px', fontSize: 14, fontWeight: 500,
                color: '#A1A1AA', background: 'none', border: 'none',
                cursor: 'pointer', borderRadius: 9999,
                transition: 'color 150ms ease, background 150ms ease',
                whiteSpace: 'nowrap', letterSpacing: '-0.01em',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = '#FAFAFA'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#A1A1AA'; e.currentTarget.style.background = 'none'; }}
              >
                Log in
              </button>
            </Link>

            <Link href="/new" style={{ textDecoration: 'none' }}>
              <button style={{
                padding: '9px 20px', fontSize: 14, fontWeight: 600,
                color: '#09090B',
                background: 'linear-gradient(180deg,#FFFFFF,#E4E4E7)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, cursor: 'pointer',
                whiteSpace: 'nowrap', letterSpacing: '-0.01em',
                boxShadow: '0 1px 2px rgba(0,0,0,0.35), 0 6px 18px rgba(255,255,255,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
                transition: 'all 200ms ease',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(255,255,255,0.55)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 6px 20px rgba(255,255,255,0.40)'; }}
              >
                Try it free
              </button>
            </Link>

            <button onClick={() => setMenuOpen(!menuOpen)} id="mobile-menu-btn" style={{
              display: 'none', alignItems: 'center', justifyContent: 'center',
              width: 38, height: 38, background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              color: '#D4D4D8', borderRadius: 9999, marginLeft: 6,
            }}>
              {menuOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
          </div>
          </div>{/* end content */}
        </div>{/* end pill */}

        {/* Mobile dropdown */}
        {menuOpen && (
          <div style={{
            maxWidth: 1200, margin: '8px auto 0', pointerEvents: 'auto',
            background: 'rgba(10,10,12,0.92)', backdropFilter: 'blur(32px) saturate(180%)',
            border: '1px solid #27272A', borderRadius: 20, boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
            padding: '12px', display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {navLinks.map(link => (
              <a key={link.label} href={link.href} onClick={() => setMenuOpen(false)} style={{
                padding: '11px 14px', fontSize: 15, color: '#A1A1AA',
                textDecoration: 'none', borderRadius: 12, transition: 'all 150ms',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#FAFAFA'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#A1A1AA'; }}
              >
                {link.label}
              </a>
            ))}
            <div style={{ height: 1, background: '#27272A', margin: '4px 0' }} />
            <Link href="/dashboard" onClick={() => setMenuOpen(false)} style={{ textDecoration: 'none' }}>
              <div style={{ padding: '11px 14px', fontSize: 15, color: '#A1A1AA', borderRadius: 12, cursor: 'pointer' }}>Log in</div>
            </Link>
            <Link href="/new" onClick={() => setMenuOpen(false)} style={{ textDecoration: 'none' }}>
              <div style={{
                padding: '11px 14px', fontSize: 15, fontWeight: 600,
                color: '#09090B', background: 'linear-gradient(180deg,#FFFFFF,#E4E4E7)',
                borderRadius: 12, cursor: 'pointer', textAlign: 'center',
              }}>
                Try it free
              </div>
            </Link>
          </div>
        )}

        <style>{`
          @media (max-width: 640px) {
            .nav-desktop { display: none !important; }
            #mobile-menu-btn { display: flex !important; }
          }
        `}</style>
      </header>
    </>
  );
}
