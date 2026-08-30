'use client';
import React, { useRef, useState, useEffect } from 'react';

function useInView(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

const CASES = [
  {
    image: '/creators/podcaster-woman.jpg',
    tag: 'Podcasters',
    tagColor: '#4F8CFF',
    stat: '60 min → 8 min',
    title: 'Turn long episodes into viral clips',
    body: 'Upload your full recording. Modaya finds the strongest moments, removes the filler, and builds clips ready for every platform.',
    accent: 'rgba(79,140,255,0.15)',
    border: 'rgba(79,140,255,0.25)',
  },
  {
    image: '/creators/podcast-group.jpg',
    tag: 'Interviewers',
    tagColor: '#4F8CFF',
    stat: '54% shorter',
    title: 'Keep the insight, lose the filler',
    body: 'Every interview becomes watchable in minutes. AI reads the conversation, keeps the sharpest exchanges, and cuts the rest.',
    accent: 'rgba(79,140,255,0.1)',
    border: 'rgba(79,140,255,0.2)',
  },
  {
    image: '/creators/streamer.jpg',
    tag: 'Streamers',
    tagColor: '#4F8CFF',
    stat: '0 manual cuts',
    title: 'Hours of stream into highlight reels',
    body: 'Clip the best moments from multi-hour streams automatically. No scrubbing. No timeline. Just drop in the VOD.',
    accent: 'rgba(79,140,255,0.12)',
    border: 'rgba(79,140,255,0.22)',
  },
  {
    image: '/creators/studio-setup.jpg',
    tag: 'YouTubers',
    tagColor: '#4F8CFF',
    stat: '3× faster',
    title: 'From raw footage to published video',
    body: 'Talking-head, vlog, tutorial — Modaya handles the cut, pacing, and captions so you can focus on what you want to say.',
    accent: 'rgba(79,140,255,0.1)',
    border: 'rgba(79,140,255,0.18)',
  },
];

function CreatorCard({ c, i, inView }: { c: typeof CASES[0]; i: number; inView: boolean }) {
  const [hov, setHov] = useState(false);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius: 20,
        overflow: 'hidden',
        border: `1px solid ${hov ? c.border : 'rgba(255,255,255,0.05)'}`,
        background: '#0A0A0A',
        display: 'flex',
        flexDirection: 'column',
        opacity: inView ? 1 : 0,
        transform: inView ? 'none' : 'translateY(32px)',
        transition: `opacity 600ms cubic-bezier(0.22,1,0.36,1) ${i * 90}ms, transform 600ms cubic-bezier(0.22,1,0.36,1) ${i * 90}ms, border-color 300ms ease, box-shadow 300ms ease`,
        boxShadow: hov ? `0 0 50px ${c.accent}, 0 24px 60px rgba(0,0,0,0.6)` : '0 8px 32px rgba(0,0,0,0.4)',
        cursor: 'default',
      }}
    >
      {/* Image */}
      <div style={{ position: 'relative', height: 240, overflow: 'hidden', flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={c.image}
          alt={c.tag}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: hov ? 'scale(1.05)' : 'scale(1)',
            transition: 'transform 600ms cubic-bezier(0.22,1,0.36,1)',
            filter: hov ? 'brightness(1.05)' : 'brightness(0.85)',
          }}
        />
        {/* Gradient overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%)' }} />

        {/* Tag pill */}
        <div style={{ position: 'absolute', top: 14, left: 14 }}>
          <span style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(79,140,255,0.85)', backdropFilter: 'blur(8px)', color: '#fff', borderRadius: 9999 }}>
            {c.tag}
          </span>
        </div>

        {/* Stat pill */}
        <div style={{ position: 'absolute', top: 14, right: 14 }}>
          <span style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9999 }}>
            {c.stat}
          </span>
        </div>
      </div>

      {/* Text body */}
      <div style={{ padding: '24px 24px 28px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 20, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.03em', margin: 0 }}>{c.title}</h3>
        <p style={{ fontSize: 14, color: '#555', lineHeight: 1.7, margin: 0 }}>{c.body}</p>

        {/* AI label */}
        <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#4F8CFF', letterSpacing: '0.08em', background: 'rgba(79,140,255,0.08)', border: '1px solid rgba(79,140,255,0.18)', padding: '3px 10px', borderRadius: 9999 }}>✦ AI Edit</span>
        </div>
      </div>
    </div>
  );
}

export function UseCasesSection() {
  const { ref, inView } = useInView(0.08);

  return (
    <section id="use-cases" style={{ padding: '128px 24px', position: 'relative', zIndex: 0, background: '#050505', overflow: 'hidden' }}>

      {/* Subtle glow */}
      <div style={{ position: 'absolute', top: '40%', right: '-10%', width: 600, height: 600, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(79,140,255,0.04) 0%, transparent 70%)', filter: 'blur(60px)' }} />

      <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 9999, background: 'rgba(79,140,255,0.08)', border: '1px solid rgba(79,140,255,0.18)', marginBottom: 20 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4F8CFF', display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#4F8CFF', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Use cases</span>
          </div>
          <h2 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 'clamp(30px,5vw,52px)', letterSpacing: '-0.045em', lineHeight: 1.05, color: '#FFFFFF', margin: '0 0 18px' }}>
            Built for every creator<br />
            <span style={{ color: 'rgba(255,255,255,0.28)' }}>with footage to edit.</span>
          </h2>
          <p style={{ fontSize: 17, color: '#555', maxWidth: 460, margin: '0 auto', lineHeight: 1.65 }}>
            Whether you record daily or once a month — Modaya fits your workflow.
          </p>
        </div>

        {/* 2×2 grid */}
        <div ref={ref} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(480px,1fr))', gap: 16 }}>
          {CASES.map((c, i) => (
            <CreatorCard key={i} c={c} i={i} inView={inView} />
          ))}
        </div>

        {/* Bottom stats strip */}
        <div style={{
          marginTop: 56,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 0,
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 16, padding: '28px 0',
          opacity: inView ? 1 : 0,
          transform: inView ? 'none' : 'translateY(20px)',
          transition: 'all 600ms cubic-bezier(0.22,1,0.36,1) 400ms',
        }}>
          {[
            { value: '50K+', label: 'Creators using Modaya' },
            { value: '2M+', label: 'Videos edited' },
            { value: '< 2 min', label: 'Average processing time' },
            { value: '0', label: 'Manual cuts required' },
          ].map((s, i, arr) => (
            <React.Fragment key={i}>
              <div style={{ padding: '0 40px', textAlign: 'center' }}>
                <p style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.04em', margin: '0 0 4px' }}>{s.value}</p>
                <p style={{ fontSize: 12, color: '#333', margin: 0 }}>{s.label}</p>
              </div>
              {i < arr.length - 1 && <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
