'use client';
import React, { useRef, useState, useEffect } from 'react';
import { Upload, Wand2, Download } from 'lucide-react';

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

const STEPS = [
  {
    number: '01',
    icon: Upload,
    title: 'Drop your footage',
    body: 'Upload any video — podcast, interview, webinar, vlog. MP4, MOV or WebM. No length limit.',
    detail: 'Modaya accepts footage exactly as it comes out of your camera or recording software.',
    color: '#A78BFA',
  },
  {
    number: '02',
    icon: Wand2,
    title: 'Tell AI what you want',
    body: 'Type a plain-English instruction or choose a quick preset. Modaya understands context, not just commands.',
    detail: '"Make this faster" · "Remove my mistakes" · "Find the best 90 seconds"',
    color: '#A78BFA',
  },
  {
    number: '03',
    icon: Download,
    title: 'Export your edit',
    body: 'Review what AI built, make any tweaks, then export in any format or aspect ratio in one click.',
    detail: 'MP4 · 9:16 · 16:9 · 1:1 · up to 4K',
    color: '#A78BFA',
  },
];

export function HowItWorksSection() {
  const { ref, inView } = useInView(0.1);

  return (
    <section id="how-it-works" className="section-pad" style={{ position:'relative', zIndex:0, background:'#09090B', overflow:'hidden' }}>

      {/* Subtle background grid lines */}
      <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(139,92,246,0.05) 1px, transparent 1px),linear-gradient(90deg,rgba(139,92,246,0.05) 1px, transparent 1px)', backgroundSize:'80px 80px', pointerEvents:'none', zIndex:0 }} />

      <div className="section-inner" style={{ position:'relative', zIndex:1 }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:'clamp(40px,6vw,80px)' }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:9999, background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.18)', marginBottom:20 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:'#A78BFA', display:'inline-block' }} />
            <span style={{ fontSize:11, color:'#A78BFA', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>How it works</span>
          </div>
          <h2 style={{ fontFamily:"'Inter Tight',sans-serif", fontWeight:700, fontSize:'clamp(30px,5vw,52px)', letterSpacing:'-0.025em', lineHeight:1.05, color:'#FAFAFA', margin:'0 0 18px' }}>
            Three steps.<br />
            <span style={{ color:'#A78BFA' }}>No learning curve.</span>
          </h2>
          <p style={{ fontSize:'clamp(15px,1.2vw,17px)', color:'#D4D4D8', maxWidth:460, margin:'0 auto', lineHeight:1.65 }}>
            Modaya handles every part of the edit. You just tell it what you need.
          </p>
        </div>

        {/* Steps */}
        <div ref={ref} className="how-grid" style={{ position:'relative' }}>

          {/* Connecting line */}
          <div style={{ position:'absolute', top:48, left:'16%', right:'16%', height:1, background:'linear-gradient(90deg,transparent,rgba(139,92,246,0.2) 20%,rgba(139,92,246,0.2) 80%,transparent)', pointerEvents:'none', zIndex:0 }} />

          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(36px)', transition:`all 600ms cubic-bezier(0.22,1,0.36,1) ${i * 130}ms`, position:'relative', zIndex:1 }}>
                <div style={{ padding:'clamp(20px,2.5vw,36px) clamp(18px,2vw,32px)', background:'#101014', border:'1px solid #26262E', borderRadius:20, boxShadow:'0 8px 30px rgba(0,0,0,0.25)', height:'100%', display:'flex', flexDirection:'column', transition:'border-color 300ms ease, background 300ms ease' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.2)'; e.currentTarget.style.background = '#16161C'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#33333D'; e.currentTarget.style.background = '#101014'; }}
                >
                  {/* Step number + Icon */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28 }}>
                    <div style={{ width:52, height:52, borderRadius:14, background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.18)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <Icon size={22} color="#A78BFA" strokeWidth={1.6} />
                    </div>
                    <span style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:48, fontWeight:800, color:'rgba(139,92,246,0.18)', letterSpacing:'-0.06em', lineHeight:1 }}>{step.number}</span>
                  </div>

                  <h3 style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:22, fontWeight:700, color:'#FAFAFA', letterSpacing:'-0.03em', margin:'0 0 12px' }}>{step.title}</h3>
                  <p style={{ fontSize:15, color:'#D4D4D8', lineHeight:1.65, margin:'0 0 16px', flex:1 }}>{step.body}</p>
                  <p style={{ fontSize:12, color:'#A1A1AA', margin:0, fontStyle:'italic', lineHeight:1.5 }}>{step.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
