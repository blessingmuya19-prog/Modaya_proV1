'use client';
import React, { useRef, useState, useEffect } from 'react';
import { Check } from 'lucide-react';

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

const PLANS = [
  {
    id: 'starter', name: 'Starter', monthly: 19, annual: 12,
    desc: 'For creators just getting started.',
    cta: 'Start free trial',
    highlight: false,
    features: [
      '7-day free trial',
      '20 AI edits per month',
      'Up to 60 min footage',
      'Auto captions',
      'MP4 export · 1080p',
    ],
  },
  {
    id: 'pro', name: 'Pro', monthly: 49, annual: 32,
    desc: 'For creators who publish regularly.',
    cta: 'Start free trial',
    highlight: true,
    features: [
      '7-day free trial',
      'Unlimited AI edits',
      'Up to 3 hr footage',
      'Auto captions + translation',
      'Smart reframe (9:16)',
      '4K export',
      'Priority processing',
      'Custom AI instructions',
    ],
  },
  {
    id: 'team', name: 'Team', monthly: 129, annual: 89,
    desc: 'For studios and content teams.',
    cta: 'Contact sales',
    highlight: false,
    features: [
      'Everything in Pro',
      '5 team seats',
      'Shared project library',
      'Brand kit & templates',
      'API access',
      'Dedicated support',
    ],
  },
];

export function PricingSection() {
  const { ref, inView } = useInView(0.08);
  const [annual, setAnnual] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <section id="pricing" className="section-pad" style={{ position:'relative', zIndex:0, background:'linear-gradient(180deg,#09090B 0%,#101014 50%,#09090B 100%)', overflow:'hidden' }}>

      <div style={{ position:'absolute', top:'30%', left:'50%', transform:'translateX(-50%)', width:900, height:500, pointerEvents:'none', background:'radial-gradient(ellipse at center, rgba(139,92,246,0.05) 0%, transparent 70%)', filter:'blur(60px)' }} />

      <div className="section-inner" style={{ position:'relative', zIndex:1 }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:64 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:9999, background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.18)', marginBottom:20 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:'#A78BFA', display:'inline-block' }} />
            <span style={{ fontSize:11, color:'#A78BFA', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>Pricing</span>
          </div>
          <h2 style={{ fontFamily:"'Inter Tight',sans-serif", fontWeight:700, fontSize:'clamp(30px,5vw,52px)', letterSpacing:'-0.025em', lineHeight:1.05, color:'#FAFAFA', margin:'0 0 18px' }}>
            Simple pricing.<br />
            <span style={{ color:'rgba(15,27,51,0.30)' }}>No surprises.</span>
          </h2>
          <p style={{ fontSize:'clamp(15px,1.2vw,17px)', color:'#D4D4D8', maxWidth:400, margin:'0 auto 32px', lineHeight:1.65 }}>
            Start free. Upgrade when you need more.
          </p>

          {/* Toggle */}
          <div style={{ display:'inline-flex', alignItems:'center', gap:0, background:'#1E1E26', border:'1px solid #33333D', borderRadius:10, padding:4 }}>
            {[{ key: false, label:'Monthly' }, { key: true, label:'Annual · Save 35%' }].map(opt => (
              <button key={String(opt.key)} onClick={() => setAnnual(opt.key)} style={{ padding:'8px 20px', fontSize:13, fontWeight:600, borderRadius:7, border:'none', cursor:'pointer', background: annual === opt.key ? '#3F3F46' : 'transparent', color: annual === opt.key ? '#FFFFFF' : '#A1A1AA', transition:'all 200ms ease' }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div ref={ref} className="pricing-grid" style={{ alignItems:'stretch' }}>
          {PLANS.map((plan, i) => {
            const isHov = hovered === plan.id;
            return (
              <div key={plan.id} onMouseEnter={() => setHovered(plan.id)} onMouseLeave={() => setHovered(null)}
                style={{ position:'relative', background: '#101014', border: plan.highlight ? `1px solid ${isHov ? 'rgba(139,92,246,0.55)' : 'rgba(139,92,246,0.3)'}` : `1px solid ${isHov ? '#8B5CF6' : '#26262E'}`, borderRadius:20, padding:'28px 24px', display:'flex', flexDirection:'column',
                  transform: inView ? isHov ? 'translateY(-6px)' : 'none' : 'translateY(32px)',
                  opacity: inView ? 1 : 0,
                  boxShadow: plan.highlight ? isHov ? '0 0 70px rgba(139,92,246,0.2),0 32px 80px rgba(0,0,0,0.55)' : '0 0 40px rgba(139,92,246,0.1),0 20px 60px rgba(0,0,0,0.45)' : isHov ? '0 18px 48px rgba(139,92,246,0.18)' : '0 6px 22px rgba(0,0,0,0.3)',
                  transition:`opacity 500ms cubic-bezier(0.22,1,0.36,1) ${i * 90}ms, transform 300ms cubic-bezier(0.22,1,0.36,1), border-color 250ms ease, box-shadow 300ms ease`,
                  cursor:'default' }}
              >
                {/* Pro top glow line */}
                {plan.highlight && (
                  <>
                    <div style={{ position:'absolute', top:0, left:'8%', right:'8%', height:1, background:'linear-gradient(90deg,transparent,rgba(139,92,246,0.6),transparent)' }} />
                    <div style={{ position:'absolute', top:-14, left:'50%', transform:'translateX(-50%)' }}>
                      <span style={{ padding:'4px 16px', background:'linear-gradient(180deg,#8B5CF6,#7C3AED)', color:'#fff', fontSize:11, fontWeight:700, borderRadius:9999, boxShadow:'0 4px 16px rgba(139,92,246,0.35)', whiteSpace:'nowrap' }}>Most popular</span>
                    </div>
                  </>
                )}

                {/* Plan name */}
                <p style={{ fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase', color: plan.highlight ? '#A78BFA' : '#A1A1AA', fontWeight:600, margin:'0 0 16px' }}>{plan.name}</p>

                {/* Price */}
                <div style={{ display:'flex', alignItems:'flex-end', gap:4, marginBottom:6 }}>
                  <span style={{ fontFamily:"'Inter Tight',sans-serif", fontWeight:800, fontSize:48, letterSpacing:'-0.05em', color:'#FAFAFA', lineHeight:1 }}>
                    ${annual ? plan.annual : plan.monthly}
                  </span>
                  {plan.monthly > 0 && <span style={{ fontSize:13, color:'#A1A1AA', marginBottom:8 }}>/mo</span>}
                </div>
                <p style={{ fontSize:13, color:'#A1A1AA', margin:'0 0 24px' }}>{plan.desc}</p>

                {/* Features */}
                <ul style={{ flex:1, listStyle:'none', padding:0, margin:'0 0 24px', display:'flex', flexDirection:'column', gap:10 }}>
                  {plan.features.map((f, fi) => (
                    <li key={f} style={{ display:'flex', alignItems:'flex-start', gap:10, opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateX(-8px)', transition:`all 400ms cubic-bezier(0.22,1,0.36,1) ${i * 90 + fi * 40 + 200}ms` }}>
                      <Check size={13} style={{ color: plan.highlight ? '#A78BFA' : '#A1A1AA', marginTop:3, flexShrink:0 }} />
                      <span style={{ fontSize:13, color:'#D4D4D8', lineHeight:1.5 }}>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button style={{ width:'100%', padding:'13px', fontSize:14, fontWeight:700, borderRadius:999, cursor:'pointer', border:'none', background: plan.highlight ? 'linear-gradient(180deg,#8B5CF6,#7C3AED)' : '#1E1E26', color: plan.highlight ? '#FFFFFF' : '#D4D4D8', boxShadow: plan.highlight ? '0 1px 2px rgba(0,0,0,0.35), 0 6px 18px rgba(124,58,237,0.30), inset 0 1px 0 rgba(255,255,255,0.16)' : 'none', transition:'all 200ms ease' } as React.CSSProperties}
                  onMouseEnter={e => { e.currentTarget.style.background = plan.highlight ? 'linear-gradient(180deg,#9669F8,#8B4FF0)' : '#33333D'; e.currentTarget.style.color = plan.highlight ? '#fff' : '#FAFAFA'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = plan.highlight ? 'linear-gradient(180deg,#8B5CF6,#7C3AED)' : '#1E1E26'; e.currentTarget.style.color = plan.highlight ? '#fff' : '#D4D4D8'; }}
                >{plan.cta}</button>
              </div>
            );
          })}
        </div>

        {/* Footnote */}
        <p style={{ textAlign:'center', fontSize:12, color:'#71717A', marginTop:32 }}>7-day free trial on Starter and Pro. No credit card required to start. Cancel anytime.</p>
      </div>
    </section>
  );
}
