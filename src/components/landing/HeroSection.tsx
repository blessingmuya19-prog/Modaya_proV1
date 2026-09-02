'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight, Upload, Play, X, Zap, Scissors, Flame, Captions, Sparkles, Smartphone } from 'lucide-react';
import Link from 'next/link';

const BAR_DELAYS = Array.from({ length: 20 }, (_, i) => `${(i * 0.055).toFixed(2)}s`);
const DEMO_PROMPT = 'Make this faster, remove the pauses, add captions and keep the strongest moments.';
const DEMO_STEPS = ['✓ Found 8 strong moments', '✓ Removed 14 pauses', '✓ Reframed 6 shots', '✓ Added captions'];
const DEMO_FILE = { name: 'podcast_episode_14.mp4', duration: '42:18' };

const PRESETS = [
  { Icon: Zap,        label: 'Make it faster',  fill: 'Make this video faster and remove all unnecessary pauses.' },
  { Icon: Scissors,   label: 'Remove mistakes', fill: 'Remove filler words, stumbles and dead air.' },
  { Icon: Flame,      label: 'Find highlights', fill: 'Find the strongest 2 minutes and cut everything else.' },
  { Icon: Captions,   label: 'Add captions',    fill: 'Transcribe and add captions to the full video.' },
  { Icon: Sparkles,   label: 'Clean up',        fill: 'Clean up the pacing, remove silence and tighten the edit.' },
  { Icon: Smartphone, label: 'Make vertical',   fill: 'Reframe and crop to 9:16 for vertical viewing.' },
];

const BRAND_LOGOS = [
  { name: 'YouTube',   svg: `<svg viewBox="0 0 71 50" fill="currentColor" width="24" height="17"><path d="M69.5 7.8C68.7 4.9 66.4 2.6 63.5 1.8 57.9 0 35.5 0 35.5 0S13.2 0 7.5 1.8C4.6 2.6 2.3 4.9 1.5 7.8 0 13.5 0 25 0 25s0 11.5 1.5 17.2c.8 2.9 3.1 5.2 6 6C13.2 50 35.5 50 35.5 50s22.4 0 28.1-1.8c2.9-.8 5.2-3.1 6-6C71 36.5 71 25 71 25s0-11.5-1.5-17.2zM28.4 35.6V14.4L46.9 25l-18.5 10.6z"/></svg>` },
  { name: 'TikTok',    svg: `<svg viewBox="0 0 48 48" fill="currentColor" width="17" height="17"><path d="M41 4h-7.3v26.1c0 3.4-2.7 6.2-6.1 6.2s-6.1-2.8-6.1-6.2 2.7-6.1 6.1-6.1c.6 0 1.2.1 1.7.2V16.8c-.6-.1-1.1-.1-1.7-.1-7.4 0-13.4 6-13.4 13.4S20.2 43.5 27.6 43.5 41 37.5 41 30.1V19.4c2.7 1.9 6 3 9.5 3V15c-5.2 0-9.5-4.9-9.5-11z"/></svg>` },
  { name: 'Instagram', svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>` },
  { name: 'LinkedIn',  svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17"><path d="M20.447 20.452H16.89v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a1.98 1.98 0 0 1-1.977-1.98c0-1.093.885-1.979 1.977-1.979s1.977.886 1.977 1.979a1.98 1.98 0 0 1-1.977 1.98zm1.761 13.019H3.574V9h3.524v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` },
  { name: 'Twitch',    svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>` },
  { name: 'Spotify',   svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>` },
  { name: 'X',         svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },
];

export function HeroSection() {
  const [uploadState, setUploadState] = useState<'empty' | 'uploaded'>('empty');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; duration: string } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [promptPhase, setPromptPhase] = useState<'idle' | 'typing' | 'processing' | 'done'>('idle');
  const [demoTyped, setDemoTyped] = useState('');
  const [demoSteps, setDemoSteps] = useState<string[]>([]);
  const [activeRatio, setActiveRatio] = useState('9:16');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const wait = useCallback((ms: number) => new Promise<void>(r => { timerRef.current = setTimeout(r, ms); }), []);

  useEffect(() => {
    if (uploadState !== 'uploaded') return;
    let alive = true;
    const runLoop = async () => {
      if (!alive) return;
      setPromptPhase('idle'); setDemoTyped(''); setDemoSteps([]);
      await wait(1600); if (!alive) return;
      setPromptPhase('typing');
      for (let i = 0; i <= DEMO_PROMPT.length; i++) {
        if (!alive) return;
        setDemoTyped(DEMO_PROMPT.slice(0, i));
        await wait(18 + Math.random() * 14);
      }
      await wait(500); if (!alive) return;
      setPromptPhase('processing');
      for (let i = 0; i < DEMO_STEPS.length; i++) {
        if (!alive) return;
        await wait(680);
        setDemoSteps(s => [...s, DEMO_STEPS[i]]);
      }
      await wait(800); if (!alive) return;
      setPromptPhase('done');
      await wait(3500); if (!alive) return;
      runLoop();
    };
    runLoop();
    return () => { alive = false; clearTimer(); };
  }, [uploadState, wait, clearTimer]);

  const handleFile = (file: File | null) => {
    if (!file) return;
    setUploadedFile({ name: file.name, duration: '42:18' });
    setUploadState('uploaded');
  };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0] ?? null); };
  const handleDemoUpload = () => { setUploadedFile(DEMO_FILE); setUploadState('uploaded'); };
  const handleReset = () => { setUploadState('empty'); setUploadedFile(null); setPrompt(''); setPromptPhase('idle'); setDemoTyped(''); setDemoSteps([]); clearTimer(); };

  const isDone = promptPhase === 'done';

  return (
    <section style={{ position:'relative', zIndex:0, background:'#09090B', overflow:'hidden' }}>
      <style>{`
        @keyframes cursor-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes step-in  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fade-up  { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes edit-ready { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:scale(1)} }
        @keyframes drag-pulse { 0%,100%{border-color:rgba(139,92,246,0.5)} 50%{border-color:rgba(139,92,246,0.9)} }
        @keyframes hero-orb { 0%,100%{opacity:.5} 50%{opacity:.9} }
        @keyframes marquee  { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        .marquee-track { display:flex; width:max-content; animation:marquee 30s linear infinite; }
        .marquee-track:hover { animation-play-state:paused; }
      `}</style>

      {/* Subtle top-center glow */}
      <div style={{ position:'absolute', top:'-15%', left:'50%', transform:'translateX(-50%)', width:900, height:600, pointerEvents:'none', background:'radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.11) 0%, transparent 65%)', filter:'blur(60px)', animation:'hero-orb 7s ease-in-out infinite', zIndex:0 }} />

      {/* ── HERO CONTENT ── */}
      <div style={{ position:'relative', zIndex:10, maxWidth:'min(860px,90vw)', margin:'0 auto', padding:'clamp(100px,14vw,160px) clamp(14px,4vw,32px) 0', textAlign:'center' }}>

        {/* Headline */}
        <h1 style={{ fontFamily:"'Inter Tight',sans-serif", fontWeight:800, fontSize:'clamp(36px,7vw,76px)', letterSpacing:'-0.045em', lineHeight:1.05, color:'#FAFAFA', margin:'0 0 20px', animation:'slide-up 0.6s cubic-bezier(0.22,1,0.36,1) 0.05s both' }}>
          {uploadState === 'empty'
            ? <>Your videos,<br /><span style={{ color:'#71717A' }}>edited by AI.</span></>
            : <>Your footage<br /><span style={{ color:'#71717A' }}>is ready.</span></>
          }
        </h1>

        {/* Subline */}
        <p style={{ fontSize:'clamp(15px,1.3vw,18px)', color:'#D4D4D8', lineHeight:1.6, margin:'0 auto 40px', maxWidth:'min(560px,80vw)', animation:'slide-up 0.6s cubic-bezier(0.22,1,0.36,1) 0.12s both' }}>
          {uploadState === 'empty'
            ? 'Upload your footage. Tell Modaya what you want. AI handles the edit.'
            : 'Now tell Modaya what to do with it.'
          }
        </p>

        {/* ── STATE A: Upload ── */}
        {uploadState === 'empty' && (
          <div style={{ animation:'slide-up 0.7s cubic-bezier(0.22,1,0.36,1) 0.18s both' }}>
            <input ref={fileInputRef} type="file" accept="video/*" style={{ display:'none' }} onChange={e => handleFile(e.target.files?.[0] ?? null)} />

            {/* Upload box */}
            <div
              onClick={handleDemoUpload}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              style={{
                border: isDragging ? '1.5px dashed rgba(139,92,246,0.7)' : '1.5px dashed rgba(139,92,246,0.35)',
                borderRadius: 16, padding: 'clamp(24px,5vw,44px) clamp(18px,4vw,32px)', cursor: 'pointer',
                background: isDragging ? 'rgba(139,92,246,0.06)' : '#101014',
                backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                boxShadow: isDragging ? '0 0 40px rgba(139,92,246,0.15), 0 12px 36px rgba(0,0,0,0.35)' : '0 12px 40px rgba(0,0,0,0.3)',
                transition: 'all 280ms ease',
                animation: isDragging ? 'drag-pulse 0.8s ease infinite' : 'none',
              }}
            >
              <div style={{ width:48, height:48, borderRadius:'50%', background:'rgba(139,92,246,0.10)', border:'1px solid rgba(139,92,246,0.25)', boxShadow:'none', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
                <Upload size={20} color="#8B5CF6" strokeWidth={1.75} />
              </div>
              <p style={{ fontSize:15, fontWeight:600, color:'#FAFAFA', margin:'0 0 6px' }}>
                {isDragging ? 'Drop it here' : 'Drop your video here'}
              </p>
              <p style={{ fontSize:13, color:'#A1A1AA', margin:'0 0 12px' }}>
                or <span style={{ color:'#A78BFA', cursor:'pointer' }}>choose a file</span>
              </p>
              <p style={{ fontSize:11, color:'#71717A', margin:0, letterSpacing:'0.06em' }}>MP4 · MOV · WebM</p>
            </div>

            {/* CTA + note */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, marginTop:20 }}>
              <Link href="/new" style={{ textDecoration:'none' }}>
                <button style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'0 32px', height:52, fontSize:15, fontWeight:600, color:'#FFFFFF', background:'linear-gradient(180deg,#8B5CF6,#7C3AED)', border:'none', borderRadius:12, cursor:'pointer', boxShadow:'0 1px 2px rgba(0,0,0,0.35), 0 6px 18px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.18)', transition:'all 200ms ease' }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 14px 44px rgba(139,92,246,0.6)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='0 10px 30px rgba(139,92,246,0.45)'; }}
                >
                  Start editing free <ArrowRight size={15} />
                </button>
              </Link>
              <span style={{ fontSize:12, color:'#A1A1AA' }}>7-day free trial · No credit card required</span>
            </div>
          </div>
        )}

        {/* ── STATE B: Prompt box ── */}
        {uploadState === 'uploaded' && uploadedFile && (
          <div style={{ display:'flex', flexDirection:'column', gap:10, animation:'fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both' }}>
            {/* File chip */}
            <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#101014', border:'1px solid #33333D', boxShadow:'0 6px 20px rgba(0,0,0,0.35)', borderRadius:10, padding:'9px 14px', margin:'0 auto' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:'rgba(40,200,80,0.85)', flexShrink:0 }} />
              <span style={{ fontSize:13, color:'#FAFAFA', fontWeight:600 }}>{uploadedFile.name}</span>
              <span style={{ fontSize:12, color:'#71717A' }}>{uploadedFile.duration}</span>
              <button onClick={handleReset} style={{ background:'none', border:'none', cursor:'pointer', color:'#A1A1AA', display:'flex', alignItems:'center', padding:0, marginLeft:4 }}><X size={13} /></button>
            </div>

            {/* AI Prompt box */}
            <div style={{ background:'#101014', border:`1.5px solid ${promptPhase !== 'idle' ? 'rgba(139,92,246,0.5)' : '#33333D'}`, borderRadius:14, overflow:'hidden', boxShadow: promptPhase !== 'idle' ? '0 0 40px rgba(139,92,246,0.12), 0 16px 44px rgba(0,0,0,0.35)' : '0 12px 40px rgba(0,0,0,0.3)', transition:'all 400ms ease', textAlign:'left' }}>
              <div style={{ padding:'16px 18px 12px', minHeight:96 }}>
                <div style={{ fontSize:10, color:'#71717A', letterSpacing:'0.04em', marginBottom:9, display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ color:'#A78BFA' }}>✦</span> What should we do with this video?
                </div>
                {promptPhase === 'idle' && !prompt && <span style={{ fontSize:14, color:'#71717A' }}>Describe your edit...</span>}
                {promptPhase === 'typing' && <span style={{ fontSize:14, color:'#D4D4D8', lineHeight:1.65 }}>{demoTyped}<span style={{ display:'inline-block', width:2, height:14, background:'#A78BFA', marginLeft:1, verticalAlign:'text-bottom', animation:'cursor-blink 0.9s step-end infinite' }} /></span>}
                {promptPhase === 'idle' && prompt && <span style={{ fontSize:14, color:'#D4D4D8', lineHeight:1.65 }}>{prompt}</span>}
                {(promptPhase === 'processing' || promptPhase === 'done') && (
                  <div>
                    <p style={{ fontSize:13, color:'#71717A', margin:'0 0 10px', lineHeight:1.6 }}>{DEMO_PROMPT}</p>
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {demoSteps.map((s, i) => <div key={i} style={{ display:'flex', alignItems:'center', gap:7, animation:'step-in 0.28s ease both' }}><span style={{ fontSize:11, color:'#71717A', fontFamily:"'Inter Tight', sans-serif" }}>{s[0]}</span><span style={{ fontSize:12, color:'#A1A1AA' }}>{s.slice(2)}</span></div>)}
                      {promptPhase === 'done' && <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4, animation:'edit-ready 0.4s ease both' }}><span style={{ fontSize:12, fontWeight:700, color:'#FAFAFA' }}>✦ Edit ready</span><span style={{ fontSize:10, color:'#A78BFA', background:'rgba(139,92,246,0.1)', border:'1px solid rgba(139,92,246,0.22)', padding:'2px 8px', borderRadius:9999, fontWeight:600 }}>3:42 · was 42:18</span></div>}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 14px', borderTop:'1px solid #26262E', background:'#16161C' }}>
                <div style={{ display:'flex', gap:4 }}>
                  {['9:16','16:9','1:1'].map(r => <button key={r} onClick={() => setActiveRatio(r)} style={{ padding:'3px 8px', fontSize:11, color: r===activeRatio ? '#8B5CF6' : '#A1A1AA', background: r===activeRatio ? 'rgba(139,92,246,0.1)' : 'transparent', border: r===activeRatio ? '1px solid rgba(139,92,246,0.2)' : '1px solid transparent', borderRadius:5, cursor:'pointer', fontWeight:500 }}>{r}</button>)}
                </div>
                <Link href="/new" style={{ textDecoration:'none' }}>
                  <button style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'8px 16px', fontSize:12, fontWeight:600, color:'#FFFFFF', background:'linear-gradient(180deg,#8B5CF6,#7C3AED)', border:'none', borderRadius:8, cursor:'pointer', boxShadow:'0 4px 14px rgba(139,92,246,0.28)' }}>Edit video <ArrowRight size={12} /></button>
                </Link>
              </div>
            </div>

            {/* Quick presets */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, justifyContent:'center' }}>
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => { setPrompt(p.fill); setPromptPhase('idle'); setDemoTyped(''); setDemoSteps([]); clearTimer(); }}
                  style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 13px', fontSize:12, color:'#A1A1AA', background:'transparent', border:'1px solid #26262E', borderRadius:9999, cursor:'pointer', transition:'all 200ms ease' }}
                  onMouseEnter={e => { e.currentTarget.style.color='#FAFAFA'; e.currentTarget.style.borderColor='#26262E'; e.currentTarget.style.background='#16161C'; }}
                  onMouseLeave={e => { e.currentTarget.style.color='#A1A1AA'; e.currentTarget.style.borderColor='#26262E'; e.currentTarget.style.background='transparent'; }}
                >
                  <p.Icon size={12} strokeWidth={1.75} /><span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── LARGE EDITOR MOCKUP ── */}
      <div style={{ position:'relative', zIndex:10, maxWidth:1200, margin:'clamp(32px,5vw,56px) auto 0', padding:'0 clamp(16px,3vw,40px)', animation:'slide-up 0.9s cubic-bezier(0.22,1,0.36,1) 0.3s both' }}>
        <EditorMockup isDone={isDone} />
      </div>

      {/* ── LOGO STRIP ── */}
      <div style={{ position:'relative', zIndex:10, borderTop:'1px solid #26262E', background:'#101014', padding:'24px 0 28px', marginTop:60 }}>
        <p style={{ fontSize:11, color:'#71717A', letterSpacing:'0.06em', textTransform:'uppercase', textAlign:'center', margin:'0 0 18px' }}>Trusted by creators at</p>
        <div style={{ position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, left:0, width:100, height:'100%', background:'linear-gradient(to right,#09090B,transparent)', zIndex:2, pointerEvents:'none' }} />
          <div style={{ position:'absolute', top:0, right:0, width:100, height:'100%', background:'linear-gradient(to left,#09090B,transparent)', zIndex:2, pointerEvents:'none' }} />
          <div className="marquee-track">
            {[...Array(2)].map((_, si) => (
              <div key={si} style={{ display:'flex', alignItems:'center', gap:48, paddingRight:48 }}>
                {BRAND_LOGOS.map(({ name, svg }) => (
                  <div key={name} style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, opacity:0.25, color:'#FAFAFA', transition:'opacity 250ms ease', cursor:'default' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.65'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.25'; }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: svg }} style={{ display:'flex', alignItems:'center' }} />
                    <span style={{ fontSize:14, fontWeight:700, color:'#FAFAFA', letterSpacing:'-0.01em', whiteSpace:'nowrap' }}>{name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Editor Mockup ─────────────────────────────────────────────────────────────
function EditorMockup({ isDone }: { isDone: boolean }) {
  return (
    <div style={{ position:'relative' }}>
      {/* Glow under the mockup */}
      <div style={{ position:'absolute', bottom:'-20px', left:'10%', right:'10%', height:100, background:'radial-gradient(ellipse at 50% 100%, rgba(139,92,246,0.18) 0%, transparent 70%)', filter:'blur(30px)', pointerEvents:'none', zIndex:-1 }} />

      <div style={{ borderRadius:14, border:'1px solid #26262E', overflow:'hidden', background:'#101014', boxShadow:'0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.035)' }}>

        {/* Topbar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 14px', height:40, background:'#16161C', borderBottom:'1px solid #26262E' }}>
          <div style={{ display:'flex', gap:5 }}>
            {['rgba(220,60,60,0.65)','rgba(220,160,40,0.65)','rgba(40,180,80,0.65)'].map((bg,i) => <div key={i} style={{ width:10, height:10, borderRadius:'50%', background:bg }} />)}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:'#71717A' }}>podcast_episode_14.mp4</span>
            {isDone && <span style={{ fontSize:9, color:'#A78BFA', background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.2)', padding:'2px 7px', borderRadius:9999, fontWeight:600 }}>✦ AI Edit ready</span>}
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <div style={{ width:44, height:22, background:'#1E1E26', borderRadius:5, border:'1px solid #33333D' }} />
            <div style={{ width:44, height:22, background:'#1E1E26', borderRadius:5, border:'1px solid #33333D' }} />
            <div style={{ width:56, height:22, background:'linear-gradient(180deg,#8B5CF6,#7C3AED)', borderRadius:5 }} />
          </div>
        </div>

        {/* Body */}
        <div style={{ display:'flex', height:420 }}>

          {/* AI Sidebar */}
          <div style={{ width:150, background:'#16161C', borderRight:'1px solid #26262E', padding:12, flexShrink:0, display:'flex', flexDirection:'column', gap:2 }}>
            <p style={{ fontSize:9, color:'#A78BFA', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', margin:'0 0 8px' }}>✦ AI Edit</p>
            {[
              { label:'Tighten pacing', tag:'AI CUT',     active:true  },
              { label:'Remove pauses', tag:'AI CUT',     active:false },
              { label:'Add captions',  tag:'AI CAPTION', active:false },
              { label:'Smart reframe', tag:'AI REFRAME', active:false },
              { label:'Highlights',    tag:'AI KEEP',    active:false },
            ].map((item, i) => (
              <div key={i} style={{ padding:'7px 9px', borderRadius:7, background: item.active ? 'rgba(139,92,246,0.12)' : 'transparent', border:`1px solid ${item.active ? 'rgba(139,92,246,0.25)' : 'transparent'}`, marginBottom:2 }}>
                <div style={{ fontSize:10, color: item.active ? '#FAFAFA' : '#71717A', fontWeight: item.active ? 500 : 400, marginBottom:2 }}>{item.label}</div>
                <div style={{ fontSize:8, color:'#A78BFA', fontWeight:600, letterSpacing:'0.07em' }}>{item.tag}</div>
              </div>
            ))}
            <div style={{ marginTop:'auto', padding:9, borderRadius:7, background:'rgba(139,92,246,0.04)', border:'1px solid rgba(139,92,246,0.09)' }}>
              <p style={{ fontSize:9, color:'#A1A1AA', margin:0, lineHeight:1.5 }}>{isDone ? <>✓ 5 edits applied<br />3:42 final</> : '5 edits queued'}</p>
            </div>
          </div>

          {/* Centre — video + timeline */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#101014' }}>

            {/* Video preview */}
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
              <div style={{ width:'100%', aspectRatio:'16/9', background:'#000000', borderRadius:10, border:`1px solid ${isDone ? 'rgba(139,92,246,0.35)' : '#26262E'}`, position:'relative', overflow:'hidden', boxShadow: isDone ? '0 0 28px rgba(139,92,246,0.07)' : 'none', transition:'all 600ms ease' }}>
                <div style={{ position:'absolute', top:0, left:0, right:0, height:'10%', background:'#000' }} />
                <div style={{ position:'absolute', bottom:0, left:0, right:0, height:'10%', background:'#000' }} />
                {/* Fake scene lines */}
                <div style={{ position:'absolute', inset:'12% 8%', display:'flex', flexDirection:'column', gap:10, justifyContent:'center', opacity:0.12 }}>
                  {[75,55,85,45,70].map((w,i) => <div key={i} style={{ height:3, width:`${w}%`, background:'#fff', borderRadius:2 }} />)}
                </div>
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ width:42, height:42, borderRadius:'50%', background:'rgba(255,255,255,0.10)', border:'1px solid rgba(255,255,255,0.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Play size={13} fill="white" color="white" style={{ marginLeft:2 }} />
                  </div>
                </div>
                <div style={{ position:'absolute', top:10, left:10, display:'flex', alignItems:'center', gap:4, background:'rgba(0,0,0,0.30)', padding:'2px 8px', borderRadius:9999 }}>
                  <span style={{ position:'relative', width:4, height:4, display:'inline-block' }}>
                    <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(139,92,246,0.5)', animation:'ping 1.8s ease-out infinite' }} />
                    <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#A78BFA' }} />
                  </span>
                  <span style={{ fontSize:8, color:'#A78BFA', fontWeight:600 }}>✦ AI Edit</span>
                </div>
                <div style={{ position:'absolute', bottom:12, right:10 }}>
                  <span style={{ fontSize:9, color: isDone ? '#A78BFA' : '#333', background: isDone ? 'rgba(139,92,246,0.1)' : 'rgba(0,0,0,0.45)', border: isDone ? '1px solid rgba(139,92,246,0.25)' : '1px solid #33333D', padding:'1px 7px', borderRadius:9999, fontWeight:600, transition:'all 600ms ease' }}>
                    {isDone ? '3:42 · AI Edit' : '42:18 · Raw'}
                  </span>
                </div>
                {isDone && (
                  <div style={{ position:'absolute', bottom:'18%', left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.82)', border:'1px solid rgba(139,92,246,0.06)', borderRadius:4, padding:'3px 12px', whiteSpace:'nowrap', animation:'edit-ready 0.5s ease both' }}>
                    <span style={{ fontSize:9, color:'rgba(255,255,255,0.82)' }}>&ldquo;...and that&apos;s the key insight.&rdquo;</span>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div style={{ background:'#16161C', borderTop:'1px solid #26262E', padding:'10px 16px 14px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontSize:8, color:'#71717A', letterSpacing:'0.04em', textTransform:'uppercase' }}>Timeline</span>
                {isDone && <span style={{ fontSize:8, color:'#A78BFA', fontWeight:600 }}>✦ 14 AI CUTS APPLIED</span>}
              </div>
              {/* Video track */}
              <div style={{ marginBottom:5 }}>
                <div style={{ fontSize:7, color:'#71717A', marginBottom:3, letterSpacing:'0.04em' }}>VIDEO</div>
                <div style={{ display:'flex', gap:2, alignItems:'center', height:18 }}>
                  {[3,0.3,2,0.3,4,0.3,1.5,0.3,3,0.3,2].map((w,i) => {
                    const isCut=i%2===1, isKept=[2,6,8].includes(Math.floor(i/2))&&!isCut;
                    return <div key={i} style={{ height:isCut?8:18, width:w*28, borderRadius:isCut?1:3, flexShrink:0, alignSelf:isCut?'center':'stretch', background:isCut?'transparent':isKept&&isDone?'rgba(139,92,246,0.30)':'#33333D', border:`1px solid ${isCut?'transparent':isKept&&isDone?'rgba(139,92,246,0.5)':'#3F3F46'}`, transition:'all 600ms ease', position:'relative' }}>
                      {isCut&&isDone&&<div style={{ position:'absolute', top:-12, left:'50%', transform:'translateX(-50%)', fontSize:6, color:'#A78BFA', fontWeight:700, whiteSpace:'nowrap' }}>CUT</div>}
                    </div>;
                  })}
                </div>
              </div>
              <div style={{ display:'flex', gap:2, height:10, marginBottom:4 }}>
                {[4,3,3,2.5,2].map((w,i) => <div key={i} style={{ height:10, width:w*28, borderRadius:2, flexShrink:0, background:'#1E1E26', border:'1px solid #26262E' }} />)}
              </div>
              <div style={{ display:'flex', gap:2, height:7, marginBottom:9 }}>
                {[2,1.5,2,1,2.5,1.5].map((w,i) => <div key={i} style={{ height:7, width:w*28, borderRadius:2, flexShrink:0, background:isDone?'rgba(139,92,246,0.1)':'#1E1E26', border:`1px solid ${isDone?'rgba(139,92,246,0.2)':'#1E1E26'}`, transition:'all 600ms ease' }} />)}
              </div>
              {/* Waveform */}
              <div style={{ display:'flex', alignItems:'flex-end', gap:1.5, height:14 }}>
                {BAR_DELAYS.map((delay,i) => <div key={i} style={{ flex:1, height:'100%', borderRadius:2, background:i%3===0?'rgba(139,92,246,0.45)':'rgba(139,92,246,0.14)', animation:`bar-dance 0.65s ease-in-out ${delay} infinite alternate`, transformOrigin:'bottom' }} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
