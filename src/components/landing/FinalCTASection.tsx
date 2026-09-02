'use client';
import React from 'react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

const SOCIAL_PROOF = [
  { stat: '50K+', label: 'Creators' },
  { stat: '2M+',  label: 'Videos edited' },
  { stat: '< 2 min', label: 'Avg. processing' },
];

export function FinalCTASection() {
  return (
    <section className="section-pad" style={{ position:'relative', zIndex:0, overflow:'hidden', background:'linear-gradient(180deg,#09090B 0%,#101014 50%,#09090B 100%)' }}>

      {/* Large radial glow */}
      <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:1000, height:600, pointerEvents:'none', background:'radial-gradient(ellipse at center, rgba(139,92,246,0.1) 0%, rgba(139,92,246,0.03) 40%, transparent 70%)', filter:'blur(50px)' }} />

      {/* Accent lines */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(139,92,246,0.2) 50%,transparent)' }} />
      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:1, background:'linear-gradient(90deg,transparent,rgba(139,92,246,0.05) 50%,transparent)' }} />

      <div style={{ position:'relative', maxWidth:680, margin:'0 auto', textAlign:'center' }}>

        {/* Overline */}
        <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:9999, background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.18)', marginBottom:28 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:'#A78BFA', display:'inline-block' }} />
          <span style={{ fontSize:11, color:'#A78BFA', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>Get started free</span>
        </div>

        <h2 style={{ fontFamily:"'Inter Tight',sans-serif", fontWeight:800, fontSize:'clamp(36px,7vw,72px)', letterSpacing:'-0.055em', lineHeight:0.95, margin:'0 0 24px', color:'#FAFAFA' }}>
          Upload a video.<br />
          <span style={{ color:'#A78BFA' }}>We&apos;ll handle the edit.</span>
        </h2>

        <p style={{ fontSize:'clamp(15px,1.3vw,19px)', color:'#D4D4D8', margin:'0 0 52px', lineHeight:1.6, maxWidth:'min(560px,80vw)', marginLeft:'auto', marginRight:'auto' }}>
          No timeline. No manual cuts. No hours in editing software. Drop your footage — AI does the rest.
        </p>

        {/* CTA button */}
        <Link href="/new">
          <button style={{ display:'inline-flex', alignItems:'center', gap:10, padding:'0 clamp(24px,3vw,48px)', height:'clamp(48px,5vh,64px)', fontSize:17, fontWeight:700, background:'linear-gradient(135deg,#7C3AED 0%,#A855F7 100%)', color:'#FFFFFF', border:'none', borderRadius:999, cursor:'pointer', boxShadow:'0 10px 34px rgba(139,92,246,0.45),0 12px 32px rgba(0,0,0,0.45)', transition:'all 250ms ease' } as React.CSSProperties}
            onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg,#C084FC,#7C3AED)'; e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 0 70px rgba(139,92,246,0.4),0 20px 40px rgba(0,0,0,0.45)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg,#7C3AED,#A855F7)'; e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 0 50px rgba(139,92,246,0.3),0 12px 32px rgba(0,0,0,0.45)'; }}
          >
            Start editing free <ArrowRight size={18} />
          </button>
        </Link>

        <p style={{ marginTop:18, fontSize:13, color:'#A1A1AA' }}>No credit card required · Cancel anytime</p>

        {/* Social proof stats */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:0, marginTop:56 }}>
          {SOCIAL_PROOF.map((s, i) => (
            <React.Fragment key={i}>
              <div style={{ padding:'0 32px', textAlign:'center' }}>
                <p style={{ fontFamily:"'Inter Tight',sans-serif", fontSize:'clamp(22px,3.5vw,32px)', fontWeight:800, color:'#FAFAFA', letterSpacing:'-0.04em', margin:'0 0 4px' }}>{s.stat}</p>
                <p style={{ fontSize:12, color:'#A1A1AA', margin:0 }}>{s.label}</p>
              </div>
              {i < SOCIAL_PROOF.length - 1 && <div style={{ width:1, height:36, background:'#33333D' }} />}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
