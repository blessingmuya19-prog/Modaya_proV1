'use client';
import React from 'react';

const TESTIMONIALS = [
  {
    quote: "I used to spend 4 hours editing every podcast episode. Now it's done in under 10 minutes. The cuts are cleaner than what I was doing manually.",
    name: 'Marcus T.',
    role: 'Podcast host · 180K subscribers',
    avatar: 'MT',
    color: '#A78BFA',
    stat: '24× faster',
  },
  {
    quote: "Modaya found highlights in my 3-hour stream I'd have never clipped myself. My short-form views went up 340% in the first month.",
    name: 'Priya S.',
    role: 'Streamer & content creator',
    avatar: 'PS',
    color: '#A78BFA',
    stat: '+340% views',
  },
  {
    quote: "The captions are accurate enough that I stopped paying for a separate transcription service. That alone saves me $200 a month.",
    name: 'Jordan L.',
    role: 'YouTube educator · 92K subs',
    avatar: 'JL',
    color: '#34D399',
    stat: '$200/mo saved',
  },
  {
    quote: "I run a small production company. Modaya cuts our post-production time in half across every client project. It's part of our standard workflow now.",
    name: 'Aisha M.',
    role: 'Video production studio',
    avatar: 'AM',
    color: '#F59E0B',
    stat: '50% less time',
  },
  {
    quote: "Finally an AI tool that doesn't over-process. The pacing feels natural, not robotic. My audience hasn't noticed — which is exactly what I wanted.",
    name: 'Tom R.',
    role: 'Documentary filmmaker',
    avatar: 'TR',
    color: '#EC4899',
    stat: '60 hrs/month saved',
  },
  {
    quote: "We pushed our upload schedule from once a week to every day. Same team, same footage. Modaya handles the edit while we're recording the next episode.",
    name: 'Camille D.',
    role: 'Daily news podcast · 410K plays/mo',
    avatar: 'CD',
    color: '#A78BFA',
    stat: '7× upload freq.',
  },
];

function Stars() {
  return (
    <div style={{ display: 'flex', gap: 3, marginBottom: 16 }}>
      {[0,1,2,3,4].map(i => (
        <svg key={i} width="13" height="13" viewBox="0 0 24 24" fill="#F59E0B" xmlns="http://www.w3.org/2000/svg">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ))}
    </div>
  );
}

function Card({ t, delay }: { t: typeof TESTIMONIALS[0]; delay: number }) {
  return (
    <div
      style={{
        padding: 'clamp(18px,2vw,28px) clamp(16px,1.8vw,26px)',
        background: '#101014',
        border: '1px solid #26262E',
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        cursor: 'default',
        transition: 'border-color 250ms ease, background 250ms ease, transform 250ms ease',
        animationFillMode: 'both',
        animation: `testimonial-in 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}ms both`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(139,92,246,0.2)';
        e.currentTarget.style.background = '#16161C';
        e.currentTarget.style.transform = 'translateY(-3px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#26262E';
        e.currentTarget.style.background = '#101014';
        e.currentTarget.style.transform = '';
      }}
    >
      <Stars />
      <p style={{ fontSize: 14, color: '#D4D4D8', lineHeight: 1.65, margin: '0 0 24px', flex: 1 }}>
        &ldquo;{t.quote}&rdquo;
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: `${t.color}18`,
            border: `1px solid ${t.color}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: t.color, flexShrink: 0,
          }}>
            {t.avatar}
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#FAFAFA', margin: '0 0 2px' }}>{t.name}</p>
            <p style={{ fontSize: 11, color: '#A1A1AA', margin: 0 }}>{t.role}</p>
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#A78BFA',
          background: 'rgba(139,92,246,0.08)',
          border: '1px solid rgba(139,92,246,0.16)',
          padding: '3px 10px', borderRadius: 9999, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {t.stat}
        </span>
      </div>
    </div>
  );
}

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="section-pad" style={{ position: 'relative', zIndex: 0, background: '#09090B' }}>

      <style>{`
        @keyframes testimonial-in {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Subtle glow */}
      <div style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translateX(-50%)', width: 800, height: 400, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(139,92,246,0.04) 0%, transparent 70%)', filter: 'blur(60px)', zIndex: 0 }} />

      <div className="section-inner" style={{ position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 9999, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)', marginBottom: 20 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A78BFA', display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#A78BFA', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>What creators say</span>
          </div>
          <h2 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 'clamp(30px,5vw,52px)', letterSpacing: '-0.025em', lineHeight: 1.05, color: '#FAFAFA', margin: '0 0 16px' }}>
            Real creators.<br />
            <span style={{ color: 'rgba(15,27,51,0.30)' }}>Real results.</span>
          </h2>
          <p style={{ fontSize: 'clamp(14px,1.1vw,16px)', color: '#D4D4D8', maxWidth: 440, margin: '0 auto', lineHeight: 1.65 }}>
            From solo podcasters to production teams — here's what Modaya does for their workflow.
          </p>
        </div>

        {/* 2-row grid */}
        <div className="testimonials-grid">
          {TESTIMONIALS.map((t, i) => (
            <Card key={i} t={t} delay={i * 80} />
          ))}
        </div>

        {/* Summary bar */}
        <div style={{ marginTop: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40, flexWrap: 'wrap' }}>
          {[
            { value: '4.9/5', label: 'Average rating' },
            { value: '50K+', label: 'Active creators' },
            { value: '2M+',  label: 'Videos edited' },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <p style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 28, fontWeight: 800, color: '#FAFAFA', letterSpacing: '-0.04em', margin: '0 0 4px' }}>{s.value}</p>
              <p style={{ fontSize: 12, color: '#A1A1AA', margin: 0 }}>{s.label}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
