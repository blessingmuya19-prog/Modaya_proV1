'use client';
/**
 * Editing, not generation — a deliberate positioning section.
 *
 * Modaya never fabricates footage, voices or visuals. Everything on the
 * timeline came out of the user's camera or recording software. This is the
 * reason it can be honest about limits: there's no synthetic content to paper
 * over.
 */
import React from 'react';
import { Film, MicOff, ShieldCheck } from 'lucide-react';
import { Section, SectionHead, Card, Reveal, Overline, ACCENT, ACCENT_SOFT, ACCENT_BRD, INK, FONT_D } from './kit';

const PILLARS = [
  {
    Icon: Film,
    title: 'Your footage is the footage',
    body: 'No generated frames, no AI avatars, no invented scenes. Every pixel in your export came from the file you uploaded — Modaya only decides what to keep, cut, emphasise and caption.',
  },
  {
    Icon: MicOff,
    title: 'No fake voices or visuals',
    body: 'There is no text-to-speech in the edit and no stock-footage sleight of hand. The captions are the words you actually said, timed to when you said them.',
  },
  {
    Icon: ShieldCheck,
    title: 'If it can\u2019t, it says so',
    body: 'No fabricated "done!" and no invented accuracy. When Modaya can\u2019t do something — reframe a subject without a vision model, reach a provider without a key — it says exactly that, in the product, in the reply.',
  },
];

export function NotGenerationSection() {
  return (
    <Section id="editing">
      <SectionHead
        overline="Editing, not generation"
        title={<>An AI that <span style={{ color: ACCENT }}>edits your work</span> — never replaces it.</>}
        body="The line is deliberate: Modaya is an editor that understands your footage, not a generator that invents it. That\u2019s also why it can promise what it promises."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {PILLARS.map(({ Icon, title, body }, i) => (
          <Reveal key={title} delay={i * 90}>
            <Card>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                <Icon size={21} color={ACCENT} strokeWidth={1.8} />
              </div>
              <h3 style={{ fontFamily: FONT_D, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: INK.txt, margin: '0 0 10px' }}>{title}</h3>
              <p style={{ fontSize: 14, color: INK.sec, lineHeight: 1.7, margin: 0 }}>{body}</p>
            </Card>
          </Reveal>
        ))}
      </div>
      <div style={{ marginTop: 30, display: 'flex', justifyContent: 'center' }}>
        <Overline tone="muted">Yes — that means no synthetic b-roll, no AI presenter, no generated thumbnails. Not yet, and not by design.</Overline>
      </div>
    </Section>
  );
}
