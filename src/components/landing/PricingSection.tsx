'use client';
/**
 * Pricing — honest: there is no billing in the product yet, so this says so
 * instead of inventing $19 tiers and "4K export" (which doesn't exist).
 */
import React from 'react';
import { Check, Sparkles, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Section, SectionHead, Card, Reveal, ACCENT, ACCENT_HI, ACCENT_SOFT, ACCENT_BRD, ACCENT_GLOW, INK, FONT_D, FONT_M } from './kit';

const NOW = [
  'The full Studio — drop, edit, iterate, export',
  'Reference matching with an honest score',
  'Animated zooms and whip/dissolve cuts',
  'Versions, undo, regenerate, edit map',
  'Direct file download (MP4 / WebM, up to 1080p)',
];

const SOON = [
  'Starter / Pro / Team tiers with real billing',
  'Brand kits, team seats and approvals',
  'Timeline export (EDL, FCPXML, Premiere XML)',
  'Subject-tracked reframe and audio mixing UI',
  'Publishing presets and shared result links',
];

export function PricingSection() {
  return (
    <Section id="pricing">
      <SectionHead
        overline="Pricing"
        title={<>Free while it&rsquo;s <span style={{ color: ACCENT }}>early</span>.</>}
        body="Pricing isn&rsquo;t finalised yet — so this says that instead of quoting numbers that don&rsquo;t exist."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 16, maxWidth: 860, margin: '0 auto' }}>
        <Reveal>
          <Card style={{ borderColor: ACCENT_BRD, boxShadow: `0 24px 70px ${ACCENT_GLOW}` }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 999, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, marginBottom: 16 }}>
              <Sparkles size={12} color={ACCENT} />
              <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT_HI, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Today</span>
            </div>
            <h3 style={{ fontFamily: FONT_D, fontSize: 24, fontWeight: 800, color: INK.txt, margin: '0 0 4px', letterSpacing: '-0.03em' }}>Full studio, free</h3>
            <p style={{ fontSize: 13.5, color: INK.mut, margin: '0 0 18px' }}>Bring your own AI key for the model — or use the built-in rules engine.</p>
            {NOW.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', fontSize: 13.5, color: INK.sec }}>
                <Check size={14} color={ACCENT} strokeWidth={3} /> {f}
              </div>
            ))}
            <Link href="/new" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18,
              height: 44, borderRadius: 11, background: `linear-gradient(180deg, ${ACCENT} 0%, #6845F0 100%)`,
              color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none',
              boxShadow: `0 8px 26px ${ACCENT_GLOW}`,
            }}>
              Start now <ArrowRight size={15} />
            </Link>
          </Card>
        </Reveal>

        <Reveal delay={100}>
          <Card>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${INK.line}`, marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: INK.sec, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Soon</span>
            </div>
            <h3 style={{ fontFamily: FONT_D, fontSize: 24, fontWeight: 800, color: INK.txt, margin: '0 0 4px', letterSpacing: '-0.03em' }}>Plans &amp; billing</h3>
            <p style={{ fontSize: 13.5, color: INK.mut, margin: '0 0 18px' }}>On the roadmap, in that order. Prices will be published when they exist.</p>
            {SOON.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', fontSize: 13.5, color: INK.mut }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: `1.5px solid ${INK.line2}`, flexShrink: 0 }} /> {f}
              </div>
            ))}
            <div style={{ marginTop: 18, padding: '10px 12px', borderRadius: 10, background: INK.card2, border: `1px solid ${INK.line}`, fontSize: 12, color: INK.dim, fontFamily: FONT_M }}>
              This page will change the day billing ships — no fake tiers in the meantime.
            </div>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}
