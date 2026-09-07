'use client';
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { ACCENT, ACCENT_HI, ACCENT_SOFT, ACCENT_BRD, ACCENT_GLOW, INK, FONT_D, FONT_M, PrimaryButton } from './kit';

/* Honest figures — the ones that are verifiable, not invented. */
const FACTS = [
  { stat: '686', label: 'automated tests passing' },
  { stat: '0',   label: 'fabricated frames in an export' },
  { stat: '100%', label: 'of edits explained on the map' },
];

export function FinalCTASection() {
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: INK.bg, padding: 'clamp(90px, 12vw, 150px) clamp(18px, 4vw, 40px)' }}>
      <div aria-hidden style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 1000, height: 620, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, rgba(124,92,255,0.14) 0%, transparent 68%)', filter: 'blur(56px)',
      }} />
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${ACCENT_BRD} 50%, transparent)` }} />

      <div style={{ position: 'relative', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 15px', borderRadius: 999, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, marginBottom: 30 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 10px ${ACCENT_GLOW}` }} />
          <span style={{ fontSize: 11.5, color: ACCENT_HI, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Get started free</span>
        </div>

        <h2 style={{
          fontFamily: FONT_D, fontWeight: 800, fontSize: 'clamp(38px, 7vw, 72px)',
          letterSpacing: '-0.055em', lineHeight: 0.98, margin: '0 0 24px', color: INK.txt,
        }}>
          Drop it.<br />
          <span style={{ color: ACCENT }}>Describe it.</span><br />
          Watch it become a video.
        </h2>

        <p style={{ fontSize: 'clamp(15px, 1.3vw, 18px)', color: INK.sec, margin: '0 auto 40px', lineHeight: 1.65, maxWidth: 540 }}>
          No timeline, no tool to learn, no synthetic content. Your footage, edited by AI that shows its reasons — and tells you when it can&rsquo;t.
        </p>

        <PrimaryButton href="/new" sub="No credit card · cancel the hype">Start editing free</PrimaryButton>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginTop: 60, flexWrap: 'wrap' }}>
          {FACTS.map((s, i) => (
            <React.Fragment key={s.label}>
              <div style={{ padding: '0 30px', textAlign: 'center' }}>
                <p style={{ fontFamily: FONT_D, fontSize: 'clamp(22px, 3.5vw, 32px)', fontWeight: 800, color: INK.txt, letterSpacing: '-0.04em', margin: '0 0 4px' }}>{s.stat}</p>
                <p style={{ fontSize: 12, color: ACCENT_HI, margin: 0, fontFamily: FONT_M }}>{s.label}</p>
              </div>
              {i < FACTS.length - 1 && <div style={{ width: 1, height: 36, background: INK.line2 }} />}
            </React.Fragment>
          ))}
        </div>
        <p style={{ marginTop: 26, fontSize: 12, color: INK.dim }}>Test count is real — run `npm test` on this repository. The rest are product behaviours, not marketing claims.</p>
      </div>
    </section>
  );
}
