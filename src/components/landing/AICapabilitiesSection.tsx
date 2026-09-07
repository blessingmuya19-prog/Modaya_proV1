'use client';
/**
 * Capabilities — exactly what ships. Each card is a real, wired feature; no
 * engine-ready promises advertised as product. (The honest "in development"
 * note at the bottom keeps the boundary visible.)
 */
import React from 'react';
import { Scissors, AlignLeft, Zap, Scale, RefreshCw, Film } from 'lucide-react';
import { Section, SectionHead, Card, Reveal, ACCENT, ACCENT_SOFT, ACCENT_BRD, ACCENT_HI, INK, FONT_D } from './kit';

const CAPS = [
  {
    icon: Scissors, title: 'Smart cutting', tag: 'SHIPS TODAY',
    body: 'Reads the transcript and measured interest, removes dead air and off-topic stretches, keeps the strongest moments — hook first, never "first N seconds".',
  },
  {
    icon: AlignLeft, title: 'Real captions', tag: 'SHIPS TODAY',
    body: 'The actual spoken words, timed to when they were said, styled for the platform: 9 placements, bold/size/colour/background, kinetic pop-ins.',
  },
  {
    icon: Zap, title: 'Pacing control', tag: 'SHIPS TODAY',
    body: 'Aggression and literalism sliders re-cut in place: the reference rhythm is preserved exactly, or pushed harder when you say so.',
  },
  {
    icon: Scale, title: 'Reference matching', tag: 'MEASURED',
    body: 'A style profile is measured from your reference — cuts/min, shot rhythm, punch-in rate, captions, grade — and the match score reports only what it could verify.',
  },
  {
    icon: Film, title: 'Animated zooms & cuts', tag: 'SHIPS TODAY',
    body: 'Push-ins ramp at the measured emphasis (never a static pre-scale), and source jumps get a real whip or dissolve instead of a hard cut.',
  },
  {
    icon: RefreshCw, title: 'Iteration, versioned', tag: 'SHIPS TODAY',
    body: 'Every change is a new version. Undo, regenerate, restore, compare side-by-side with the reference — nothing is ever overwritten.',
  },
];

export function AICapabilitiesSection() {
  return (
    <Section id="ai">
      <SectionHead
        overline="What it does"
        title={<>Everything an editor does.<br /><span style={{ color: ACCENT }}>Without the timeline.</span></>}
        body="Every card below is in the product today. Where something is built but not yet surfaced, Modaya will tell you — not pretend."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        {CAPS.map((cap, i) => {
          const Icon = cap.icon;
          return (
            <Reveal key={cap.title} delay={i * 60}>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color={ACCENT} strokeWidth={1.7} />
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT_HI, letterSpacing: '0.1em', background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, padding: '3px 10px', borderRadius: 999 }}>
                    {cap.tag}
                  </span>
                </div>
                <h3 style={{ fontFamily: FONT_D, fontSize: 18.5, fontWeight: 700, color: INK.txt, letterSpacing: '-0.02em', margin: '14px 0 8px' }}>{cap.title}</h3>
                <p style={{ fontSize: 13.5, color: INK.sec, lineHeight: 1.7, margin: 0 }}>{cap.body}</p>
              </Card>
            </Reveal>
          );
        })}
      </div>
      <p style={{ textAlign: 'center', marginTop: 28, fontSize: 12.5, color: INK.dim, fontFamily: "'JetBrains Mono',ui-monospace,monospace" }}>
        In development but not in the product yet: subject-tracked reframe, motion-tracked text, speed ramps, LUT presets, audio mixing UI, social publishing.
      </p>
    </Section>
  );
}
