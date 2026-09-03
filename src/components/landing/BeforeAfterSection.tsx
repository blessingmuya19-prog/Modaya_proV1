'use client';
import React, { useRef } from 'react';
import { useInView } from '@/hooks/useInView';
import { ArrowRight, Trash2, Check } from 'lucide-react';

/* ─── Timeline clip data ─── */
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

const TOTAL_BEFORE_S = 5 * 60 + 47;  // 5:47
const TOTAL_AFTER_S  = 1 * 60 + 53;  // 1:53

/* colour palette */
const C = {
  keep:  { bg: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.28)', text: '#D4D4D8' },
  waste: { bg: 'rgba(248,113,113,0.07)',  border: 'rgba(248,113,113,0.22)',  text: '#F87171' },
};

function Clip({ label, dur, kind, delay = 0 }: { label: string; dur: string; kind: 'keep' | 'waste'; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { threshold: 0.2 });
  const c = C[kind];
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'none' : 'translateY(12px)',
      transition: `opacity 500ms ${delay}ms ease, transform 500ms ${delay}ms cubic-bezier(0.22,1,0.36,1)`,
    }}>
      <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {kind === 'keep'
          ? <Check size={11} color={c.text} strokeWidth={2.5} />
          : <Trash2 size={11} color={c.text} strokeWidth={1.75} />
        }
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: kind === 'keep' ? '#D4D4D8' : 'rgba(248,113,113,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: kind === 'waste' ? 'line-through' : 'none' }}>{label}</span>
        <span style={{ fontSize: 11, color: kind === 'keep' ? '#71717A' : 'rgba(248,113,113,0.35)', flexShrink: 0 }}>{dur}</span>
      </div>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 3, background: '#111', borderRadius: 9999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 9999, transition: 'width 1s cubic-bezier(0.22,1,0.36,1)' }} />
    </div>
  );
}

function Panel({ title, label, clips, totalSec, maxSec, labelColor, badge, badgeBg, delay = 0 }:
  { title: string; label: string; clips: typeof BEFORE_CLIPS; totalSec: number; maxSec: number; labelColor: string; badge: string; badgeBg: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { threshold: 0.15 });
  const pct = (totalSec / maxSec) * 100;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <div ref={ref} style={{ flex: '1 1 280px', minWidth: 0, opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(24px)', transition: `opacity 600ms ${delay}ms ease, transform 600ms ${delay}ms cubic-bezier(0.22,1,0.36,1)` }}>
      <div style={{ background: '#0A0A0B', border: '1px solid #27272A', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>

        {/* Panel header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1C1C21', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#A1A1AA', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', background: badgeBg, border: `1px solid ${labelColor}22`, borderRadius: 9999, color: labelColor, letterSpacing: '0.04em' }}>{badge}</span>
        </div>

        {/* Clips */}
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 7, minHeight: 220 }}>
          {clips.map((c, i) => <Clip key={i} {...c} kind={c.kind as 'keep' | 'waste'} delay={delay + i * 60} />)}
        </div>

        {/* Duration bar */}
        <div style={{ padding: '14px 18px', borderTop: '1px solid #1C1C21' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 11, color: '#71717A' }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: labelColor, fontFamily: "'Uni Neue','Manrope',system-ui,-apple-system,sans-serif", letterSpacing: '-0.03em' }}>{timeStr}</span>
          </div>
          <ProgressBar pct={pct} color={labelColor} />
        </div>
      </div>
    </div>
  );
}

export function BeforeAfterSection() {
  const headRef = useRef<HTMLDivElement>(null);
  const headVisible = useInView(headRef, { threshold: 0.3 });
  const arrowRef = useRef<HTMLDivElement>(null);
  const arrowVisible = useInView(arrowRef, { threshold: 0.3 });

  return (
    <section className="section-pad" style={{ maxWidth: 960, margin: '0 auto', paddingLeft: 24, paddingRight: 24 }}>

      {/* Heading */}
      <div ref={headRef} style={{ textAlign: 'center', marginBottom: 'clamp(32px,4vw,56px)', opacity: headVisible ? 1 : 0, transform: headVisible ? 'none' : 'translateY(20px)', transition: 'opacity 600ms ease, transform 600ms cubic-bezier(0.22,1,0.36,1)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9999, marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#D4D4D8' }}>Before & After</span>
        </div>
        <h2 style={{ fontFamily: "'Uni Neue','Manrope',system-ui,-apple-system,sans-serif", fontWeight: 700, fontSize: 'clamp(28px,4vw,48px)', letterSpacing: '-0.04em', color: '#FAFAFA', margin: '0 0 14px', lineHeight: 1.1 }}>
          Every edit, automated
        </h2>
        <p style={{ fontSize: 16, color: '#A1A1AA', maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
          Modaya analyses your footage, removes the noise and keeps everything that matters — in seconds.
        </p>
      </div>

      {/* 3-column layout: before | arrow | after */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }} className="before-after-row">

        <Panel
          title="Raw footage"
          label="Total length"
          clips={BEFORE_CLIPS}
          totalSec={TOTAL_BEFORE_S}
          maxSec={TOTAL_BEFORE_S}
          labelColor="#F87171"
          badge="5 min 47 sec"
          badgeBg="rgba(248,113,113,0.07)"
          delay={0}
        />

        {/* Arrow divider */}
        <div ref={arrowRef} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
          flexShrink: 0, padding: '0 4px',
          opacity: arrowVisible ? 1 : 0, transform: arrowVisible ? 'none' : 'scale(0.7)',
          transition: 'opacity 500ms 300ms ease, transform 500ms 300ms cubic-bezier(0.34,1.56,0.64,1)',
        }} className="before-after-arrow">
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowRight size={16} color="#D4D4D8" strokeWidth={2} />
          </div>
        </div>

        <Panel
          title="Edited by Modaya"
          label="Final length"
          clips={AFTER_CLIPS}
          totalSec={TOTAL_AFTER_S}
          maxSec={TOTAL_BEFORE_S}
          labelColor="#D4D4D8"
          badge="1 min 53 sec"
          badgeBg="rgba(255,255,255,0.07)"
          delay={150}
        />
      </div>

      {/* Reduction stat */}
      <div style={{ marginTop: 40, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '10px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#D4D4D8', fontFamily: "'Uni Neue','Manrope',system-ui,-apple-system,sans-serif", letterSpacing: '-0.04em' }}>67%</span>
          <span style={{ fontSize: 13, color: '#A1A1AA' }}>shorter video — zero manual editing</span>
        </div>
      </div>
    </section>
  );
}
