'use client';
/**
 * "Whose side is this on?" — an honest proof board replacing invented
 * testimonials. No fake names, no invented "+340% views". This is what the
 * product actually guarantees, each backed by a behaviour in the code.
 */
import React from 'react';
import { Eye, GitBranch, BadgeCheck, FileCheck2, Fingerprint, Timer } from 'lucide-react';
import { Section, SectionHead, Card, Reveal, ACCENT, ACCENT_SOFT, ACCENT_BRD, ACCENT_HI, INK, FONT_D, FONT_M } from './kit';

const PROOFS = [
  {
    icon: Eye, title: 'Nothing is hidden',
    body: 'Every edit carries a reason you can click: the edit map shows each cut, zoom, caption and B-roll choice with the measurement that justified it.',
  },
  {
    icon: GitBranch, title: 'Nothing is lost',
    body: 'Every change mints a version. Restore any prior cut, undo the last one, or regenerate with a fresh seed — the old edit is still there.',
  },
  {
    icon: BadgeCheck, title: 'Score = measured',
    body: 'A 93% match is only shown when 93% was actually measured. The axis list tells you what the number covers, so it can\u2019t oversell.',
  },
  {
    icon: FileCheck2, title: 'Replies = reality',
    body: 'The chat reports what happened, not what was intended. "No change" is a possible answer, and when a provider is missing it says so in the first sentence.',
  },
  {
    icon: Fingerprint, title: 'Yours, frame for frame',
    body: 'No generated footage, voices or visuals. The export is your recording, edited — which is why "editing, not generation" is a promise you can verify.',
  },
  {
    icon: Timer, title: 'Real-time, real numbers',
    body: 'Progress is measured work, not a spinner: seconds-saved is the actual trimmed duration and the render happens in your browser at your hardware\u2019s pace.',
  },
];

export function TestimonialsSection() {
  return (
    <Section id="proof-details">
      <SectionHead
        overline="The other side of the promise"
        title={<>Built so you can <span style={{ color: ACCENT }}>check our work</span>.</>}
        body="No invented reviews — this is the contract the product enforces, behaviour by behaviour."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 14 }}>
        {PROOFS.map(({ icon: Icon, title, body }, i) => (
          <Reveal key={title} delay={i * 60}>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={17} color={ACCENT} strokeWidth={1.9} />
                </span>
                <span style={{ fontFamily: FONT_D, fontSize: 16, fontWeight: 700, color: INK.txt, letterSpacing: '-0.02em' }}>{title}</span>
              </div>
              <p style={{ fontSize: 13.5, color: INK.sec, lineHeight: 1.7, margin: 0 }}>{body}</p>
              <span style={{ display: 'inline-block', marginTop: 14, fontSize: 10, color: ACCENT_HI, fontFamily: FONT_M, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                ▲ enforced in the product
              </span>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
