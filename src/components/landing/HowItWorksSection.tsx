'use client';
import React from 'react';
import { Upload, MessageSquare, Download } from 'lucide-react';
import { Section, SectionHead, Card, Reveal, ACCENT, ACCENT_SOFT, ACCENT_BRD, INK, FONT_D } from './kit';

const STEPS = [
  {
    number: '01',
    icon: Upload,
    title: 'Drop your footage',
    body: 'Any video the browser can decode — podcast, interview, stream, vlog, webinar. A reference video is optional: add one and Modaya matches its pacing, captions and grade.',
    detail: 'MP4 · MOV · WebM — no upload size gate, capped only by your browser and hardware.',
  },
  {
    number: '02',
    icon: MessageSquare,
    title: 'Talk to your editor',
    body: 'Type what you want in plain English — "cut the pauses, keep the best 90 seconds, bold captions" — or let Modaya make the first cut and refine from there. Every decision is shown on the edit map with a reason.',
    detail: '"like the reference but faster" · "find me 5 viral clips" · "undo that"',
  },
  {
    number: '03',
    icon: Download,
    title: 'Export your edit',
    body: 'Review the result, compare it side-by-side with the reference, iterate in the chat, and export exactly what the preview shows — cuts, captions, grade, zooms and transitions included.',
    detail: 'MP4 (H.264) or WebM · 1080p / 720p / 480p · any aspect ratio your footage fits.',
  },
];

export function HowItWorksSection() {
  return (
    <Section id="how-it-works">
      <SectionHead
        overline="How it works"
        title={<>Three steps.<br /><span style={{ color: ACCENT }}>No learning curve.</span></>}
        body="There is no timeline to learn and no tool to drive. You talk; Modaya edits."
      />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div aria-hidden style={{
          position: 'absolute', top: 48, left: '16%', right: '16%', height: 1,
          background: `linear-gradient(90deg, transparent, ${ACCENT_BRD} 25%, ${ACCENT_BRD} 75%, transparent)`, opacity: 0.5,
        }} />
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <Reveal key={step.number} delay={i * 110}>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={21} color={ACCENT} strokeWidth={1.8} />
                  </div>
                  <span style={{ fontFamily: FONT_D, fontSize: 46, fontWeight: 800, color: 'rgba(124,92,255,0.25)', letterSpacing: '-0.06em', lineHeight: 1 }}>{step.number}</span>
                </div>
                <h3 style={{ fontFamily: FONT_D, fontSize: 21, fontWeight: 700, color: INK.txt, letterSpacing: '-0.03em', margin: '0 0 12px' }}>{step.title}</h3>
                <p style={{ fontSize: 14.5, color: INK.sec, lineHeight: 1.7, margin: '0 0 16px' }}>{step.body}</p>
                <p style={{ fontSize: 12, color: INK.dim, margin: 0, fontFamily: "'JetBrains Mono',ui-monospace,monospace", lineHeight: 1.55 }}>{step.detail}</p>
              </Card>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
