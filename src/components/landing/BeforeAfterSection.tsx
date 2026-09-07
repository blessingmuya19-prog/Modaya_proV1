'use client';
/**
 * Proof — the edit map, honest. A real Modaya decision rendered as before →
 * after: what was cut, what was kept, and the measured result. Labelled
 * illustrative so no invented telemetry is implied.
 */
import React from 'react';
import { useInView } from '@/hooks/useInView';
import { ArrowRight, Trash2, Check } from 'lucide-react';
import { ACCENT, ACCENT_HI, ACCENT_SOFT, ACCENT_BRD, INK, FONT_D, FONT_M, Section, SectionHead } from './kit';

const BEFORE_CLIPS = [
  { label: 'Intro ramble', dur: '1:24', kind: 'waste' },
  { label: 'Main point',   dur: '0:38', kind: 'keep'  },
  { label: 'Filler words', dur: '0:52', kind: 'waste' },
  { label: 'Key insight',  dur: '0:44', kind: 'keep'  },
  { label: 'Off-topic',    dur: '1:10', kind: 'waste' },
  { label: 'Strong close', dur: '0:31', kind: 'keep'  },
  { label: 'Dead air',     dur: '0:48', kind: 'waste' },
];

const AFTER_CLIPS = [
  { label: 'Main point',   dur: '0:38', kind: 'keep' },
  { label: 'Key insight',  dur: '0:44', kind: 'keep' },
  { label: 'Strong close', dur: '0:31', kind: 'keep' },
];

const TOTAL_BEFORE_S = 5 * 60 + 47;
const TOTAL_AFTER_S  = 1 * 60 + 53;

/* semantic colours: keep = accent, waste = red. Only these two hues exist. */
const KEEP = { bg: ACCENT_SOFT, border: ACCENT_BRD, text: ACCENT_HI };
const WASTE = { bg: 'rgba(248,113,113,0.07)', border: 'rgba(248,113,113,0.22)', text: '#F87171' };

function Clip({ label, dur, kind, delay = 0 }: { label: string; dur: string; kind: 'keep' | 'waste'; delay?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { threshold: 0.2 });
  const c = kind === 'keep' ? KEEP : WASTE;
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(12px)',
      transition: `opacity 500ms ${delay}ms ease, transform 500ms ${delay}ms cubic-bezier(0.22,1,0.36,1)`,
    }}>
      <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 9, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {kind === 'keep'
          ? <Check size={11} color={c.text} strokeWidth={2.5} />
          : <Trash2 size={11} color={c.text} strokeWidth={1.75} />
        }
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: kind === 'keep' ? INK.sec : 'rgba(248,113,113,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: kind === 'waste' ? 'line-through' : 'none' }}>{label}</span>
        <span style={{ fontSize: 11, color: kind === 'keep' ? INK.dim : 'rgba(248,113,113,0.35)', flexShrink: 0, fontFamily: FONT_M }}>{dur}</span>
      </div>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 3, background: INK.well, borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 999, transition: 'width 1s cubic-bezier(0.22,1,0.36,1)' }} />
    </div>
  );
}

function Panel({ title, label, clips, totalSec, maxSec, labelColor, badge, badgeBg, delay = 0 }: {
  title: string; label: string; clips: typeof BEFORE_CLIPS; totalSec: number; maxSec: number;
  labelColor: string; badge: string; badgeBg: string; delay?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { threshold: 0.15 });
  const pct = (totalSec / maxSec) * 100;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <div ref={ref} style={{ flex: '1 1 280px', minWidth: 0, opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(24px)', transition: `opacity 600ms ${delay}ms ease, transform 600ms ${delay}ms cubic-bezier(0.22,1,0.36,1)` }}>
      <div style={{ background: INK.card, border: `1px solid ${INK.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${INK.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: INK.mut, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', background: badgeBg, border: `1px solid ${labelColor}33`, borderRadius: 999, color: labelColor, fontFamily: FONT_M }}>{badge}</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 7, minHeight: 220 }}>
          {clips.map((c, i) => <Clip key={i} {...c} kind={c.kind as 'keep' | 'waste'} delay={delay + i * 60} />)}
        </div>
        <div style={{ padding: '14px 18px', borderTop: `1px solid ${INK.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 11, color: INK.dim }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: labelColor, fontFamily: FONT_M, fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
          </div>
          <ProgressBar pct={pct} color={labelColor} />
        </div>
      </div>
    </div>
  );
}

export function BeforeAfterSection() {
  const arrowRef = React.useRef<HTMLDivElement>(null);
  const arrowVisible = useInView(arrowRef, { threshold: 0.3 });

  return (
    <Section id="proof">
      <SectionHead
        overline="Proof"
        title={<>One footage.<br /><span style={{ color: ACCENT }}>One edit, explained.</span></>}
        body="A podcast drop: every removed pause and kept moment shown on the map, with the measured result below. Illustrative footage — the decisions are the kind Modaya makes."
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <Panel
          title="Raw footage" label="Total length" clips={BEFORE_CLIPS}
          totalSec={TOTAL_BEFORE_S} maxSec={TOTAL_BEFORE_S}
          labelColor="#F87171" badge="5:47 raw" badgeBg={WASTE.bg} delay={0}
        />

        <div ref={arrowRef} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
          flexShrink: 0, padding: '0 4px',
          opacity: arrowVisible ? 1 : 0, transform: arrowVisible ? 'none' : 'scale(0.7)',
          transition: 'opacity 500ms 300ms ease, transform 500ms 300ms cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 26px ${ACCENT_GLOW_LOW}` }}>
            <ArrowRight size={17} color={ACCENT_HI} strokeWidth={2.2} />
          </div>
        </div>

        <Panel
          title="Edited by Modaya" label="Final length" clips={AFTER_CLIPS}
          totalSec={TOTAL_AFTER_S} maxSec={TOTAL_BEFORE_S}
          labelColor={ACCENT_HI} badge="1:53 edit" badgeBg={ACCENT_SOFT} delay={150}
        />
      </div>

      <div style={{ marginTop: 40, textAlign: 'center', display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['4:58', 'dead air & off-topic removed', INK.sec],
          ['3', 'strong moments kept — hook first', ACCENT_HI],
          ['0', 'frames added that weren\u2019t yours', '#F87171'],
        ].map(([n, l, col]) => (
          <div key={l} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, padding: '10px 20px', background: INK.card, border: `1px solid ${INK.line}`, borderRadius: 12 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: col as string, fontFamily: FONT_D, letterSpacing: '-0.04em' }}>{n}</span>
            <span style={{ fontSize: 12.5, color: INK.mut }}>{l}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

const ACCENT_GLOW_LOW = 'rgba(124,92,255,0.22)';
