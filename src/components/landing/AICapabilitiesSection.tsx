'use client';
import React, { useRef, useState, useEffect } from 'react';
import { Scissors, AlignLeft, Maximize2, Zap, Music2, RefreshCw } from 'lucide-react';

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

const CAPS = [
  { icon: Scissors,   title:'Smart cutting',      tag:'AI CUT',     body:'Modaya reads your transcript, detects pacing, and removes everything that makes the viewer skip forward.' },
  { icon: AlignLeft,  title:'Auto captions',       tag:'AI CAPTION', body:'Timed, speaker-aware captions from your audio — styled and positioned for the platform you\'re posting to.' },
  { icon: Maximize2,  title:'Smart reframe',        tag:'AI REFRAME', body:'Automatically reframes 16:9 footage for 9:16 — tracking speakers, keeping them centred throughout.' },
  { icon: Zap,        title:'Pacing control',       tag:'AI PACING',  body:'Remove dead air, tighten responses, and compress silence — without losing the natural rhythm of speech.' },
  { icon: Music2,     title:'Background audio',     tag:'AI AUDIO',   body:'Detects music, normalises levels, and balances voice against background audio automatically.' },
  { icon: RefreshCw,  title:'Iterative editing',    tag:'AI SUGGEST', body:'Tell Modaya to try again, be more aggressive, or keep a specific section — it updates the edit instantly.' },
];

export function AICapabilitiesSection() {
  const { ref, inView } = useInView(0.08);

  return (
    <section id="ai" style={{ padding:'128px 24px', position:'relative', zIndex:0, background:'linear-gradient(180deg,#050505 0%,#070710 50%,#050505 100%)', overflow:'hidden' }}>

      {/* Glow */}
      <div style={{ position:'absolute', top:'40%', left:'50%', transform:'translateX(-50%)', width:900, height:500, pointerEvents:'none', background:'radial-gradient(ellipse at center, rgba(79,140,255,0.06) 0%, transparent 70%)', filter:'blur(60px)' }} />

      <div style={{ maxWidth:1120, margin:'0 auto', position:'relative', zIndex:1 }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:80 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:9999, background:'rgba(79,140,255,0.08)', border:'1px solid rgba(79,140,255,0.18)', marginBottom:20 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:'#4F8CFF', display:'inline-block' }} />
            <span style={{ fontSize:11, color:'#4F8CFF', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>AI capabilities</span>
          </div>
          <h2 style={{ fontFamily:"'Inter Tight',sans-serif", fontWeight:700, fontSize:'clamp(30px,5vw,52px)', letterSpacing:'-0.045em', lineHeight:1.05, color:'#FFFFFF', margin:'0 0 18px' }}>
            Everything an editor does.<br />
            <span style={{ color:'rgba(255,255,255,0.28)' }}>Done by AI.</span>
          </h2>
          <p style={{ fontSize:17, color:'#555', maxWidth:480, margin:'0 auto', lineHeight:1.65 }}>
            No plugins. No presets to learn. Just describe the edit and Modaya handles the rest.
          </p>
        </div>

        {/* Grid */}
        <div ref={ref} style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:12 }}>
          {CAPS.map((cap, i) => {
            const Icon = cap.icon;
            return (
              <div key={i} style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(28px)', transition:`all 550ms cubic-bezier(0.22,1,0.36,1) ${i * 70}ms` }}>
                <div style={{ padding:'32px 28px', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:18, height:'100%', display:'flex', flexDirection:'column', gap:14, cursor:'default', transition:'all 300ms ease' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(79,140,255,0.22)'; e.currentTarget.style.background = 'rgba(79,140,255,0.03)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ width:44, height:44, borderRadius:12, background:'rgba(79,140,255,0.08)', border:'1px solid rgba(79,140,255,0.16)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <Icon size={20} color="#4F8CFF" strokeWidth={1.6} />
                    </div>
                    <span style={{ fontSize:9, fontWeight:700, color:'#4F8CFF', letterSpacing:'0.1em', background:'rgba(79,140,255,0.08)', border:'1px solid rgba(79,140,255,0.18)', padding:'3px 10px', borderRadius:9999 }}>{cap.tag}</span>
                  </div>
                  <h3 style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:19, fontWeight:700, color:'#FFFFFF', letterSpacing:'-0.03em', margin:0 }}>{cap.title}</h3>
                  <p style={{ fontSize:14, color:'#555', lineHeight:1.7, margin:0 }}>{cap.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
