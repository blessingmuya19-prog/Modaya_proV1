'use client';
import React, { useRef, useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';

const WAVEFORM_50 = Array.from({ length: 50 }, (_, i) =>
  `${Math.abs(Math.sin(i * 0.35)) * 70 + 15}%`
);
const BAR_DELAYS = Array.from({ length: 50 }, (_, i) =>
  `${((i * 0.04) % 0.8).toFixed(2)}s`
);

// Raw timeline clip widths — stable SSR
const RAW_CLIPS  = [38,22,45,18,52,14,40,28,35,20,48];
const EDIT_CLIPS = [38,22,45,18,52,14,40,28,35,20,48];
const CUT_IDX    = [1,3,5,7,9]; // gaps between kept clips

function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

function MockCard({ label, duration, isAfter, sublabel }: { label: string; duration: string; isAfter?: boolean; sublabel: string }) {
  const [hov, setHov] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, borderRadius: 20, overflow: 'hidden',
        border: isAfter ? '1px solid rgba(79,140,255,0.35)' : '1px solid rgba(255,255,255,0.06)',
        position: 'relative',
        background: isAfter ? 'linear-gradient(145deg,#060612 0%,#0a0a1a 60%,#0d0d0d 100%)' : 'linear-gradient(145deg,#0d0d0d 0%,#111 60%,#0d0d0d 100%)',
        boxShadow: isAfter
          ? hov ? '0 0 80px rgba(79,140,255,0.22),0 32px 80px rgba(0,0,0,0.8)' : '0 0 50px rgba(79,140,255,0.14),0 24px 60px rgba(0,0,0,0.7)'
          : hov ? '0 24px 60px rgba(0,0,0,0.7)' : '0 16px 48px rgba(0,0,0,0.5)',
        transform: hov ? 'translateY(-5px) scale(1.015)' : 'none',
        transition: 'all 380ms cubic-bezier(0.22,1,0.36,1)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Fake video preview area */}
      <div style={{ height: 220, position: 'relative', background: isAfter ? '#06060e' : '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* Cinematic bars */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '10%', background: '#000' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '10%', background: '#000' }} />

        {/* Subtle blue glow for after */}
        {isAfter && <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 50% at 50% 30%, rgba(79,140,255,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />}

        {/* Fake person silhouette lines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', opacity: isAfter ? 0.15 : 0.08, zIndex: 1 }}>
          {/* Head */}
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff' }} />
          {/* Shoulders */}
          <div style={{ width: 80, height: 8, borderRadius: 4, background: '#fff' }} />
          {/* Body lines */}
          {[70, 60, 65, 55].map((w, i) => (
            <div key={i} style={{ width: w, height: 4, borderRadius: 2, background: '#fff' }} />
          ))}
        </div>

        {/* Waveform for after */}
        {isAfter && (
          <div style={{ position: 'absolute', bottom: '15%', left: '6%', right: '6%', display: 'flex', alignItems: 'flex-end', gap: 1, height: 20, zIndex: 5 }}>
            {WAVEFORM_50.map((h, i) => (
              <div key={i} style={{ flex: 1, borderRadius: 2, height: h, background: `linear-gradient(to top, rgba(79,140,255,${hov ? '0.75' : '0.45'}), rgba(79,140,255,0.1))`, transformOrigin: 'bottom', animation: hov ? `bar-dance 0.6s ease-in-out ${BAR_DELAYS[i]} infinite alternate` : 'none', transition: 'background 300ms ease' }} />
            ))}
          </div>
        )}

        {/* Caption (after only) */}
        {isAfter && (
          <div style={{ position: 'absolute', bottom: '22%', left: '50%', transform: 'translateX(-50%)', zIndex: 10, padding: '4px 14px', background: 'rgba(0,0,0,0.82)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)' }}>&ldquo;...and that&apos;s the key insight.&rdquo;</span>
          </div>
        )}

        {/* Label badge */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>
          <span style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, borderRadius: 9999, letterSpacing: '0.08em', textTransform: 'uppercase', background: isAfter ? 'linear-gradient(135deg,#4F8CFF,#326FEA)' : 'rgba(255,255,255,0.07)', border: isAfter ? 'none' : '1px solid rgba(255,255,255,0.1)', color: isAfter ? '#fff' : '#888' }}>{label}</span>
        </div>

        {/* Duration */}
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
          <span style={{ padding: '3px 10px', fontSize: 10, fontWeight: 600, color: isAfter ? '#4F8CFF' : '#555', background: 'rgba(0,0,0,0.6)', border: isAfter ? '1px solid rgba(79,140,255,0.3)' : '1px solid rgba(255,255,255,0.06)', borderRadius: 9999 }}>{duration}</span>
        </div>
      </div>

      {/* Timeline section */}
      <div style={{ padding: '16px 18px 20px', background: isAfter ? '#060610' : '#0a0a0a', borderTop: isAfter ? '1px solid rgba(79,140,255,0.12)' : '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
          <span>Timeline</span>
          {isAfter && <span style={{ color: '#4F8CFF' }}>✦ 14 AI CUTS APPLIED</span>}
        </div>

        {/* Video track */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 18, marginBottom: 5 }}>
          {RAW_CLIPS.map((w, i) => {
            const isCut = isAfter && CUT_IDX.includes(i);
            const isKept = isAfter && !CUT_IDX.includes(i);
            return (
              <div key={i} style={{
                height: isCut ? 8 : 18,
                width: w * 0.55,
                borderRadius: isCut ? 1 : 3,
                flexShrink: 0,
                alignSelf: isCut ? 'center' : 'stretch',
                background: isCut ? '#161616' : isKept ? 'rgba(79,140,255,0.2)' : '#1c1c1c',
                border: `1px solid ${isCut ? '#222' : isKept ? 'rgba(79,140,255,0.4)' : '#282828'}`,
                transition: 'all 600ms ease',
                position: 'relative',
              }}>
                {isCut && (
                  <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', fontSize: 7, color: '#4F8CFF', fontWeight: 700, whiteSpace: 'nowrap' }}>CUT</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Audio track */}
        <div style={{ display: 'flex', gap: 2, height: 10 }}>
          {[45, 32, 38, 28, 42].map((w, i) => (
            <div key={i} style={{ height: 10, width: w * 0.55, borderRadius: 2, flexShrink: 0, background: '#111', border: '1px solid #1a1a1a' }} />
          ))}
        </div>

        <p style={{ fontSize: 11, color: '#333', margin: '12px 0 0' }}>{sublabel}</p>
      </div>
    </div>
  );
}

export function BeforeAfterSection() {
  const { ref, inView } = useInView(0.1);

  return (
    <section id="examples" style={{ padding: '128px 24px', position: 'relative', zIndex: 0, background: 'linear-gradient(180deg,#050505 0%,#0A0A0A 50%,#050505 100%)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '30%', left: '-10%', width: 700, height: 500, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(79,140,255,0.04) 0%, transparent 70%)', filter: 'blur(60px)' }} />

      <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 9999, background: 'rgba(79,140,255,0.08)', border: '1px solid rgba(79,140,255,0.18)', marginBottom: 20 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4F8CFF', display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#4F8CFF', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Before vs After</span>
          </div>
          <h2 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 'clamp(30px,5vw,52px)', letterSpacing: '-0.045em', lineHeight: 1.05, margin: '0 0 18px', color: '#FFFFFF' }}>
            Raw footage → Finished edit
          </h2>
          <p style={{ fontSize: 17, color: '#555', maxWidth: 500, margin: '0 auto', lineHeight: 1.65 }}>
            Upload anything. Modaya finds the story, removes the noise, and builds the edit.
          </p>
        </div>

        {/* Cards */}
        <div ref={ref} style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
          <div style={{ flex: '1 1 300px', opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateX(-48px)', transition: 'all 700ms cubic-bezier(0.22,1,0.36,1)' }}>
            <p style={{ fontSize: 10, color: '#3a3a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12, fontWeight: 600 }}>Before</p>
            <MockCard label="Raw footage" duration="8:15" sublabel="Unedited · straight from camera" isAfter={false} />
          </div>

          {/* Arrow */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 4px', opacity: inView ? 1 : 0, transform: inView ? 'none' : 'scale(0.7)', transition: 'all 500ms cubic-bezier(0.22,1,0.36,1) 160ms' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(79,140,255,0.1)', border: '1px solid rgba(79,140,255,0.25)', borderRadius: 9999, padding: '6px 14px' }}>
                <span style={{ position: 'relative', width: 6, height: 6, display: 'inline-block' }}>
                  <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(79,140,255,0.45)', animation: 'ping 1.8s ease-out infinite' }} />
                  <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#4F8CFF' }} />
                </span>
                <span style={{ fontSize: 11, color: '#4F8CFF', fontWeight: 600 }}>✦ AI Edit</span>
              </div>
              <ArrowRight size={18} style={{ color: '#333', transform: 'rotate(90deg)' }} />
            </div>
          </div>

          <div style={{ flex: '1 1 300px', opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateX(48px)', transition: 'all 700ms cubic-bezier(0.22,1,0.36,1) 100ms' }}>
            <p style={{ fontSize: 10, color: '#4F8CFF', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12, fontWeight: 600 }}>After</p>
            <MockCard label="AI Edit" duration="3:42" sublabel="Tightened · captions added · ready to post" isAfter={true} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ marginTop: 56, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(24px)', transition: 'all 600ms cubic-bezier(0.22,1,0.36,1) 300ms' }}>
          {[
            { value: '54%', label: 'Shorter on average', sub: 'Without losing the message' },
            { value: '< 2 min', label: 'Processing time', sub: 'From upload to finished edit' },
            { value: '0', label: 'Manual cuts needed', sub: 'AI handles everything' },
          ].map((s, i) => (
            <div key={i} style={{ padding: '24px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 14, textAlign: 'center' }}>
              <p style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 'clamp(28px,4vw,40px)', fontWeight: 700, letterSpacing: '-0.04em', color: '#FFFFFF', margin: '0 0 6px' }}>{s.value}</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#A1A1A1', margin: '0 0 4px' }}>{s.label}</p>
              <p style={{ fontSize: 11, color: '#3a3a3a', margin: 0 }}>{s.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
