'use client';
/**
 * Honesty — surfaced as a feature, because it's a differentiator.
 *
 * Three guarantees the UI is built on: measured progress (not simulated),
 * results that are really what happened, and plain words when something isn't
 * possible.
 */
import React from 'react';
import { Activity, BadgeCheck, MessageSquareText } from 'lucide-react';
import { Section, Card, Reveal, ACCENT, ACCENT_SOFT, ACCENT_BRD, ACCENT_HI, INK, FONT_D, FONT_M } from './kit';

const GUARANTEES = [
  {
    Icon: Activity,
    name: 'No fake progress',
    body: 'Every pipeline stage is a real measurement or a real call. The timestamps are the timestamps, the seconds-saved number is the actual trimmed duration — nothing is animated to look busy.',
  },
  {
    Icon: BadgeCheck,
    name: 'No invented results',
    body: 'The reference match score covers only the axes that were measured. When only the colour grade agreed, it says "colour grade" — not "93% match" with the details swept under it.',
  },
  {
    Icon: MessageSquareText,
    name: 'Plain words when it can\u2019t',
    body: 'No key? The reply starts with "I\u2019m running without an AI model…". No model that can see the frames? It says so and answers from the measurements instead. That honesty is the feature.',
  },
];

export function HonestySection() {
  return (
    <Section id="honesty" grid={false} pad={false}>
      <div style={{
        borderTop: `1px solid ${INK.line}`, borderBottom: `1px solid ${INK.line}`,
        background: 'linear-gradient(180deg, rgba(124,92,255,0.045) 0%, transparent 60%)',
        padding: 'clamp(64px, 8vw, 104px) clamp(18px, 4vw, 40px)',
      }}>
        <div style={{ maxWidth: 1060, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 16 }}>
          {GUARANTEES.map(({ Icon, name, body }, i) => (
            <Reveal key={name} delay={i * 90}>
              <Card hover={false} style={{ background: 'rgba(255,255,255,0.015)', borderColor: 'transparent', borderRadius: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={16} color={ACCENT} strokeWidth={2} />
                  </span>
                  <span style={{ fontFamily: FONT_M, fontSize: 12.5, fontWeight: 700, color: ACCENT_HI, letterSpacing: '0.02em' }}>{name}</span>
                </div>
                <p style={{ fontSize: 13.5, color: INK.sec, lineHeight: 1.7, margin: 0 }}>{body}</p>
              </Card>
            </Reveal>
          ))}
        </div>

        <p style={{
          textAlign: 'center', margin: '34px auto 0', maxWidth: 620,
          fontSize: 'clamp(15px, 1.3vw, 18px)', color: INK.mut, lineHeight: 1.6, fontFamily: FONT_D, fontWeight: 600,
        }}>
          Most AI tools promise magic. Modaya promises an editor — and tells you the truth about the magic.
        </p>
      </div>
    </Section>
  );
}
