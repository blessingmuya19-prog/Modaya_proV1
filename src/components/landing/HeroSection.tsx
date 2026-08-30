'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight, Upload, Play, X, Zap, Scissors, Flame, Captions, Sparkles, Smartphone } from 'lucide-react';
import Link from 'next/link';

// ── Module-level constants (SSR-safe) ─────────────────────────────────────────
const BAR_DELAYS = Array.from({ length: 18 }, (_, i) => `${(i * 0.055).toFixed(2)}s`);
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
  { name: 'YouTube',   svg: `<svg viewBox="0 0 71 50" fill="currentColor" width="28" height="20"><path d="M69.5 7.8C68.7 4.9 66.4 2.6 63.5 1.8 57.9 0 35.5 0 35.5 0S13.2 0 7.5 1.8C4.6 2.6 2.3 4.9 1.5 7.8 0 13.5 0 25 0 25s0 11.5 1.5 17.2c.8 2.9 3.1 5.2 6 6C13.2 50 35.5 50 35.5 50s22.4 0 28.1-1.8c2.9-.8 5.2-3.1 6-6C71 36.5 71 25 71 25s0-11.5-1.5-17.2zM28.4 35.6V14.4L46.9 25l-18.5 10.6z"/></svg>` },
  { name: 'TikTok',    svg: `<svg viewBox="0 0 48 48" fill="currentColor" width="20" height="20"><path d="M41 4h-7.3v26.1c0 3.4-2.7 6.2-6.1 6.2s-6.1-2.8-6.1-6.2 2.7-6.1 6.1-6.1c.6 0 1.2.1 1.7.2V16.8c-.6-.1-1.1-.1-1.7-.1-7.4 0-13.4 6-13.4 13.4S20.2 43.5 27.6 43.5 41 37.5 41 30.1V19.4c2.7 1.9 6 3 9.5 3V15c-5.2 0-9.5-4.9-9.5-11z"/></svg>` },
  { name: 'Instagram', svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>` },
  { name: 'LinkedIn',  svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20.447 20.452H16.89v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a1.98 1.98 0 0 1-1.977-1.98c0-1.093.885-1.979 1.977-1.979s1.977.886 1.977 1.979a1.98 1.98 0 0 1-1.977 1.98zm1.761 13.019H3.574V9h3.524v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>` },
  { name: 'Twitch',    svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>` },
  { name: 'Spotify',   svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>` },
  { name: 'X',         svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>` },
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

  // Demo loop — auto-runs when video "uploaded"
  useEffect(() => {
    if (uploadState !== 'uploaded') return;
    let alive = true;
    const runLoop = async () => {
      if (!alive) return;
      setPromptPhase('idle'); setDemoTyped(''); setDemoSteps([]);
      await wait(1800); if (!alive) return;
      setPromptPhase('typing');
      for (let i = 0; i <= DEMO_PROMPT.length; i++) {
        if (!alive) return;
        setDemoTyped(DEMO_PROMPT.slice(0, i));
        await wait(20 + Math.random() * 15);
      }
      await wait(500); if (!alive) return;
      setPromptPhase('processing');
      for (let i = 0; i < DEMO_STEPS.length; i++) {
        if (!alive) return;
        await wait(700);
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
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    handleFile(e.dataTransfer.files[0] ?? null);
  };
  const handleDemoUpload = () => { setUploadedFile(DEMO_FILE); setUploadState('uploaded'); };
  const handleReset = () => {
    setUploadState('empty'); setUploadedFile(null);
    setPrompt(''); setPromptPhase('idle'); setDemoTyped(''); setDemoSteps([]);
    clearTimer();
  };

  const isDone = promptPhase === 'done';

  return (
    <section style={{ position: 'relative', zIndex: 0, minHeight: '100vh', background: '#050505', overflow: 'hidden' }}>
      <style>{`
        @keyframes cursor-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes step-in { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes fade-up { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes edit-ready { from{opacity:0;transform:scale(.95)} to{opacity:1;transform:scale(1)} }
        @keyframes drag-pulse { 0%,100%{border-color:rgba(79,140,255,0.5)} 50%{border-color:rgba(79,140,255,1)} }
        @keyframes box-float  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes marquee    { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes hero-glow  { 0%,100%{opacity:.6} 50%{opacity:1} }
        .marquee-track { display:flex; width:max-content; animation:marquee 30s linear infinite; }
        .marquee-track:hover { animation-play-state:paused; }
      `}</style>

      {/* Background glow */}
      <div style={{ position:'absolute', top:'-10%', right:'-5%', width:700, height:700, pointerEvents:'none', background:'radial-gradient(ellipse at center, rgba(79,140,255,0.12) 0%, rgba(79,140,255,0.03) 45%, transparent 70%)', filter:'blur(80px)', animation:'hero-glow 6s ease-in-out infinite' }} />
      <div style={{ position:'absolute', top:'30%', left:'-10%', width:500, height:500, pointerEvents:'none', background:'radial-gradient(ellipse at center, rgba(50,111,234,0.08) 0%, transparent 70%)', filter:'blur(70px)' }} />

      {/* ── TWO-COLUMN HERO ─────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px', minHeight: '100vh', display: 'flex', alignItems: 'center', gap: 64, position: 'relative', zIndex: 10 }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ flex: '0 0 auto', width: '44%', paddingTop: 80 }}>

          {/* Overline pill */}
          <div style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'5px 14px', borderRadius:9999, background:'rgba(79,140,255,0.1)', border:'1px solid rgba(79,140,255,0.22)', marginBottom:28, animation:'slide-up 0.5s cubic-bezier(0.22,1,0.36,1) 0.05s both' }}>
            <span style={{ position:'relative', width:6, height:6, display:'inline-block' }}>
              <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(79,140,255,0.5)', animation:'ping 1.8s ease-out infinite' }} />
              <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#4F8CFF' }} />
            </span>
            <span style={{ fontSize:11, fontWeight:600, color:'#4F8CFF', letterSpacing:'0.1em', textTransform:'uppercase' }}>AI Video Editor</span>
          </div>

          {/* Headline — left-aligned, massive */}
          <h1 style={{ fontFamily:"'Inter Tight',sans-serif", fontWeight:800, fontSize:'clamp(42px,4.5vw,72px)', letterSpacing:'-0.055em', lineHeight:1.0, margin:'0 0 24px', color:'#FFFFFF', animation:'slide-up 0.6s cubic-bezier(0.22,1,0.36,1) 0.1s both' }}>
            {uploadState === 'empty'
              ? <><span>Your videos.</span><br /><span style={{ color:'rgba(255,255,255,0.28)' }}>Edited by AI.</span></>
              : <><span>Your footage</span><br /><span style={{ color:'rgba(255,255,255,0.28)' }}>is ready.</span></>
            }
          </h1>

          {/* Subline */}
          <p style={{ fontSize:18, color:'#6B6B6B', lineHeight:1.65, margin:'0 0 40px', maxWidth:420, animation:'slide-up 0.6s cubic-bezier(0.22,1,0.36,1) 0.16s both' }}>
            {uploadState === 'empty'
              ? 'Upload a video. Tell Modaya how you want it edited. AI handles the rest.'
              : 'Now tell Modaya what to do with it.'
            }
          </p>

          {/* ── STATE A: Upload zone ── */}
          {uploadState === 'empty' && (
            <div style={{ animation:'slide-up 0.7s cubic-bezier(0.22,1,0.36,1) 0.22s both' }}>
              <input ref={fileInputRef} type="file" accept="video/*" style={{ display:'none' }} onChange={e => handleFile(e.target.files?.[0] ?? null)} />

              <div
                onClick={handleDemoUpload}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                style={{
                  border: isDragging ? '1.5px dashed rgba(79,140,255,0.8)' : '1.5px dashed rgba(255,255,255,0.1)',
                  borderRadius: 18, padding: '40px 32px', cursor: 'pointer',
                  background: isDragging ? 'rgba(79,140,255,0.06)' : 'rgba(255,255,255,0.025)',
                  backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: isDragging ? '0 0 40px rgba(79,140,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
                  transition: 'all 300ms ease',
                  animation: isDragging ? 'drag-pulse 0.8s ease infinite' : 'box-float 4s ease-in-out infinite',
                  textAlign: 'center',
                }}
              >
                <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(255,255,255,0.05)', backdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'inset 0 1px 0 rgba(255,255,255,0.12)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
                  <Upload size={20} color="rgba(255,255,255,0.7)" strokeWidth={1.75} />
                </div>
                <p style={{ fontSize:15, fontWeight:600, color:'#FFFFFF', margin:'0 0 6px' }}>
                  {isDragging ? 'Drop it here' : 'Drop your video here'}
                </p>
                <p style={{ fontSize:13, color:'#3a3a3a', margin:'0 0 14px' }}>
                  or <span style={{ color:'#4F8CFF', textDecoration:'underline', textDecorationColor:'rgba(79,140,255,0.3)' }}>choose a file</span>
                </p>
                <p style={{ fontSize:11, color:'#282828', margin:0, letterSpacing:'0.06em' }}>MP4 · MOV · WebM</p>
              </div>

              {/* CTAs below upload box */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:20 }}>
                <Link href="/upload" style={{ textDecoration:'none' }}>
                  <button style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'0 28px', height:52, fontSize:15, fontWeight:700, color:'#FFFFFF', background:'linear-gradient(135deg,#4F8CFF,#326FEA)', border:'none', borderRadius:12, cursor:'pointer', boxShadow:'0 4px 20px rgba(79,140,255,0.35)', transition:'all 220ms ease' }}
                    onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 8px 32px rgba(79,140,255,0.5)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='0 4px 20px rgba(79,140,255,0.35)'; }}
                  >
                    Start editing free <ArrowRight size={16} />
                  </button>
                </Link>
                <span style={{ fontSize:12, color:'#2e2e2e' }}>7-day free trial · No credit card</span>
              </div>
            </div>
          )}

          {/* ── STATE B: Prompt + presets ── */}
          {uploadState === 'uploaded' && uploadedFile && (
            <div style={{ display:'flex', flexDirection:'column', gap:12, animation:'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both' }}>

              {/* Uploaded file chip */}
              <div style={{ display:'flex', alignItems:'center', gap:10, background:'#0A0A0A', border:'1px solid #222', borderRadius:10, padding:'10px 14px' }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:'rgba(40,180,80,0.9)', flexShrink:0 }} />
                <span style={{ fontSize:13, color:'#A1A1A1', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{uploadedFile.name}</span>
                <span style={{ fontSize:12, color:'#444', flexShrink:0 }}>{uploadedFile.duration}</span>
                <button onClick={handleReset} style={{ background:'none', border:'none', cursor:'pointer', color:'#444', padding:0, display:'flex', alignItems:'center' }}><X size={14} /></button>
              </div>

              {/* AI Prompt box */}
              <div style={{ background:'#0A0A0A', border:`1px solid ${promptPhase !== 'idle' ? 'rgba(79,140,255,0.35)' : '#222'}`, borderRadius:14, overflow:'hidden', boxShadow: promptPhase !== 'idle' ? '0 0 40px rgba(79,140,255,0.1)' : 'none', transition:'all 400ms ease' }}>
                <div style={{ padding:'14px 16px 10px', minHeight:90, textAlign:'left' }}>
                  <div style={{ fontSize:10, color:'#333', letterSpacing:'0.07em', marginBottom:8, display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ color:'#4F8CFF' }}>✦</span> What should we do with this video?
                  </div>
                  {promptPhase === 'idle' && !prompt && <span style={{ fontSize:13, color:'#252525' }}>Describe your edit...</span>}
                  {promptPhase === 'typing' && <span style={{ fontSize:13, color:'#A1A1A1', lineHeight:1.65 }}>{demoTyped}<span style={{ display:'inline-block', width:2, height:13, background:'#4F8CFF', marginLeft:1, verticalAlign:'text-bottom', animation:'cursor-blink 0.9s step-end infinite' }} /></span>}
                  {promptPhase === 'idle' && prompt && <span style={{ fontSize:13, color:'#A1A1A1', lineHeight:1.65 }}>{prompt}</span>}
                  {(promptPhase === 'processing' || promptPhase === 'done') && (
                    <div>
                      <p style={{ fontSize:12, color:'#444', margin:'0 0 10px', lineHeight:1.6 }}>{DEMO_PROMPT}</p>
                      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                        {demoSteps.map((s, i) => <div key={i} style={{ display:'flex', alignItems:'center', gap:7, animation:'step-in 0.3s ease both' }}><span style={{ fontSize:11, color:'#3a3a3a', fontFamily:'monospace' }}>{s[0]}</span><span style={{ fontSize:12, color:'#6B6B6B' }}>{s.slice(2)}</span></div>)}
                        {promptPhase === 'done' && <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:3, animation:'edit-ready 0.4s ease both' }}><span style={{ fontSize:12, fontWeight:700, color:'#FFFFFF' }}>✦ Edit ready</span><span style={{ fontSize:10, color:'#4F8CFF', background:'rgba(79,140,255,0.1)', border:'1px solid rgba(79,140,255,0.22)', padding:'2px 8px', borderRadius:9999, fontWeight:600 }}>3:42 · was 42:18</span></div>}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 12px', borderTop:'1px solid #181818', background:'#050505' }}>
                  <div style={{ display:'flex', gap:4 }}>
                    {['9:16','16:9','1:1'].map(r => <button key={r} onClick={() => setActiveRatio(r)} style={{ padding:'3px 8px', fontSize:11, fontWeight:500, color: r===activeRatio ? '#4F8CFF' : '#333', background: r===activeRatio ? 'rgba(79,140,255,0.1)' : 'transparent', border: r===activeRatio ? '1px solid rgba(79,140,255,0.22)' : '1px solid transparent', borderRadius:5, cursor:'pointer' }}>{r}</button>)}
                  </div>
                  <Link href="/upload" style={{ textDecoration:'none' }}>
                    <button style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'7px 16px', fontSize:12, fontWeight:600, color:'#FFFFFF', background:'linear-gradient(135deg,#4F8CFF,#326FEA)', border:'none', borderRadius:7, cursor:'pointer', boxShadow:'0 4px 14px rgba(79,140,255,0.3)' }}>
                      Edit video <ArrowRight size={12} />
                    </button>
                  </Link>
                </div>
              </div>

              {/* Presets */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                {PRESETS.map((p, i) => (
                  <button key={i} onClick={() => { setPrompt(p.fill); setPromptPhase('idle'); setDemoTyped(''); setDemoSteps([]); clearTimer(); }}
                    style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 13px', fontSize:12, color:'#555', background:'#0A0A0A', border:'1px solid #222', borderRadius:9999, cursor:'pointer', transition:'all 200ms ease' }}
                    onMouseEnter={e => { e.currentTarget.style.color='#FFFFFF'; e.currentTarget.style.borderColor='#3a3a3a'; e.currentTarget.style.background='#111'; }}
                    onMouseLeave={e => { e.currentTarget.style.color='#555'; e.currentTarget.style.borderColor='#222'; e.currentTarget.style.background='#0A0A0A'; }}
                  >
                    <p.Icon size={12} strokeWidth={1.75} /><span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN — Editor mockup ── */}
        <div style={{ flex: 1, paddingTop: 80, minWidth: 0, animation:'slide-up 0.8s cubic-bezier(0.22,1,0.36,1) 0.3s both' }}>
          <EditorMockup isDone={isDone} />
        </div>
      </div>

      {/* ── LOGO MARQUEE ──────────────────────────────────────────────────── */}
      <div style={{ position:'relative', zIndex:10, borderTop:'1px solid #111', background:'#030303', padding:'28px 0' }}>
        <p style={{ fontSize:11, color:'#252525', letterSpacing:'0.12em', textTransform:'uppercase', textAlign:'center', margin:'0 0 20px' }}>Trusted by creators at</p>

        <div style={{ position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, left:0, width:120, height:'100%', background:'linear-gradient(to right,#030303,transparent)', zIndex:2, pointerEvents:'none' }} />
          <div style={{ position:'absolute', top:0, right:0, width:120, height:'100%', background:'linear-gradient(to left,#030303,transparent)', zIndex:2, pointerEvents:'none' }} />

          <div className="marquee-track">
            {[...Array(2)].map((_, si) => (
              <div key={si} style={{ display:'flex', alignItems:'center', gap:56, paddingRight:56 }}>
                {BRAND_LOGOS.map(({ name, svg }) => (
                  <div key={name} style={{ display:'flex', alignItems:'center', gap:9, flexShrink:0, opacity:0.3, color:'#FFFFFF', transition:'opacity 300ms ease' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.3'; }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: svg }} style={{ display:'flex', alignItems:'center' }} />
                    <span style={{ fontSize:15, fontWeight:700, color:'#FFFFFF', letterSpacing:'-0.01em', whiteSpace:'nowrap' }}>{name}</span>
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
      {/* Glow */}
      <div style={{ position:'absolute', inset:'-30px', zIndex:-1, background:'radial-gradient(ellipse 60% 40% at 60% 80%, rgba(79,140,255,0.14) 0%, transparent 70%)', filter:'blur(40px)', pointerEvents:'none' }} />

      <div style={{ borderRadius:16, border:'1px solid #1e1e1e', overflow:'hidden', background:'#0A0A0A', boxShadow:'0 40px 100px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.03)' }}>

        {/* Topbar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 14px', height:42, background:'#111', borderBottom:'1px solid #1e1e1e' }}>
          <div style={{ display:'flex', gap:5 }}>
            {['rgba(220,60,60,0.7)','rgba(220,160,40,0.7)','rgba(40,180,80,0.7)'].map((bg,i) => <div key={i} style={{ width:10, height:10, borderRadius:'50%', background:bg }} />)}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <span style={{ fontSize:11, color:'#3a3a3a' }}>podcast_ep14.mp4</span>
            {isDone && <span style={{ fontSize:9, color:'#4F8CFF', background:'rgba(79,140,255,0.1)', border:'1px solid rgba(79,140,255,0.22)', padding:'2px 7px', borderRadius:9999, fontWeight:600 }}>✦ AI Edit ready</span>}
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <div style={{ width:46, height:22, background:'#1a1a1a', borderRadius:5, border:'1px solid #222' }} />
            <div style={{ width:46, height:22, background:'#1a1a1a', borderRadius:5, border:'1px solid #222' }} />
            <div style={{ width:58, height:22, background:'linear-gradient(135deg,#4F8CFF,#326FEA)', borderRadius:5 }} />
          </div>
        </div>

        {/* Body */}
        <div style={{ display:'flex', height:400 }}>

          {/* AI Sidebar */}
          <div style={{ width:155, background:'#0A0A0A', borderRight:'1px solid #1e1e1e', padding:12, flexShrink:0, display:'flex', flexDirection:'column', gap:3 }}>
            <p style={{ fontSize:9, color:'#252525', letterSpacing:'0.1em', textTransform:'uppercase', margin:'0 0 8px' }}>✦ AI Edit</p>
            {[
              { label:'Tighten pacing', tag:'AI CUT',     active:true },
              { label:'Remove pauses', tag:'AI CUT',     active:false },
              { label:'Add captions',  tag:'AI CAPTION', active:false },
              { label:'Smart reframe', tag:'AI REFRAME', active:false },
              { label:'Highlights',    tag:'AI KEEP',    active:false },
            ].map((item, i) => (
              <div key={i} style={{ padding:'7px 9px', borderRadius:7, background: item.active ? 'rgba(79,140,255,0.1)' : 'transparent', border:`1px solid ${item.active ? 'rgba(79,140,255,0.25)' : 'transparent'}` }}>
                <div style={{ fontSize:10, color: item.active ? '#FFFFFF' : '#2e2e2e', fontWeight: item.active ? 500 : 400, marginBottom:2 }}>{item.label}</div>
                <div style={{ fontSize:8, color:'#4F8CFF', fontWeight:600, letterSpacing:'0.07em' }}>{item.tag}</div>
              </div>
            ))}
            <div style={{ marginTop:'auto', padding:9, borderRadius:7, background:'rgba(79,140,255,0.05)', border:'1px solid rgba(79,140,255,0.1)' }}>
              <p style={{ fontSize:9, color:'#555', margin:0, lineHeight:1.5 }}>{isDone ? <>✓ 5 edits applied<br />3:42 final</> : '5 edits queued'}</p>
            </div>
          </div>

          {/* Centre */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#050505' }}>
            {/* Video preview */}
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
              <div style={{ width:'100%', aspectRatio:'16/9', background:'#111', borderRadius:9, border:`1px solid ${isDone ? 'rgba(79,140,255,0.22)' : '#1a1a1a'}`, position:'relative', overflow:'hidden', boxShadow: isDone ? '0 0 30px rgba(79,140,255,0.07)' : 'none', transition:'all 600ms ease' }}>
                <div style={{ position:'absolute', top:0, left:0, right:0, height:'10%', background:'#000' }} />
                <div style={{ position:'absolute', bottom:0, left:0, right:0, height:'10%', background:'#000' }} />
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ width:40, height:40, borderRadius:'50%', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Play size={13} fill="white" color="white" style={{ marginLeft:2 }} />
                  </div>
                </div>
                <div style={{ position:'absolute', top:10, left:10, display:'flex', alignItems:'center', gap:4, background:'rgba(0,0,0,0.8)', padding:'2px 8px', borderRadius:9999 }}>
                  <span style={{ position:'relative', width:4, height:4, display:'inline-block' }}>
                    <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(79,140,255,0.5)', animation:'ping 1.8s ease-out infinite' }} />
                    <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:'#4F8CFF' }} />
                  </span>
                  <span style={{ fontSize:8, color:'#4F8CFF', fontWeight:600 }}>✦ AI Edit</span>
                </div>
                <div style={{ position:'absolute', bottom:12, right:10 }}>
                  <span style={{ fontSize:9, color: isDone ? '#4F8CFF' : '#444', background: isDone ? 'rgba(79,140,255,0.1)' : 'rgba(0,0,0,0.6)', border: isDone ? '1px solid rgba(79,140,255,0.28)' : '1px solid #333', padding:'1px 7px', borderRadius:9999, fontWeight:600, transition:'all 600ms ease' }}>
                    {isDone ? '3:42 · AI Edit' : '42:18 · Raw'}
                  </span>
                </div>
                {isDone && (
                  <div style={{ position:'absolute', bottom:'17%', left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.82)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:4, padding:'3px 12px', whiteSpace:'nowrap', animation:'edit-ready 0.5s ease both' }}>
                    <span style={{ fontSize:9, color:'rgba(255,255,255,0.85)' }}>&ldquo;...and that&apos;s the key insight.&rdquo;</span>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div style={{ background:'#0A0A0A', borderTop:'1px solid #1e1e1e', padding:'10px 14px 12px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontSize:8, color:'#222', letterSpacing:'0.08em', textTransform:'uppercase' }}>Timeline</span>
                {isDone && <span style={{ fontSize:8, color:'#4F8CFF', fontWeight:600 }}>✦ 14 AI CUTS</span>}
              </div>
              {/* Video track */}
              <div style={{ marginBottom:4 }}>
                <div style={{ fontSize:7, color:'#222', marginBottom:3, letterSpacing:'0.06em' }}>VIDEO</div>
                <div style={{ display:'flex', gap:2, alignItems:'center', height:18 }}>
                  {[3,0.3,2,0.3,4,0.3,1.5,0.3,3,0.3,2].map((w,i) => {
                    const isCut = i%2===1, isKept=[2,6,8].includes(Math.floor(i/2))&&!isCut;
                    return <div key={i} style={{ height:isCut?8:18, width:w*24, borderRadius:isCut?1:3, flexShrink:0, alignSelf:isCut?'center':'stretch', background:isCut?'#161616':isKept&&isDone?'rgba(79,140,255,0.2)':'#1c1c1c', border:`1px solid ${isCut?'#1e1e1e':isKept&&isDone?'rgba(79,140,255,0.4)':'#252525'}`, transition:'all 600ms ease', position:'relative' }}>
                      {isCut&&isDone&&<div style={{ position:'absolute', top:-11, left:'50%', transform:'translateX(-50%)', fontSize:6, color:'#4F8CFF', fontWeight:700, whiteSpace:'nowrap' }}>CUT</div>}
                    </div>;
                  })}
                </div>
              </div>
              {/* Audio + Captions tracks */}
              <div style={{ display:'flex', gap:2, height:10, marginBottom:4 }}>
                {[4,3,3,2.5,2].map((w,i) => <div key={i} style={{ height:10, width:w*24, borderRadius:2, flexShrink:0, background:'#131313', border:'1px solid #1a1a1a' }} />)}
              </div>
              <div style={{ display:'flex', gap:2, height:7, marginBottom:8 }}>
                {[2,1.5,2,1,2.5,1.5].map((w,i) => <div key={i} style={{ height:7, width:w*24, borderRadius:2, flexShrink:0, background:isDone?'rgba(79,140,255,0.12)':'#0e0e0e', border:`1px solid ${isDone?'rgba(79,140,255,0.24)':'#181818'}`, transition:'all 600ms ease' }} />)}
              </div>
              {/* Waveform */}
              <div style={{ display:'flex', alignItems:'flex-end', gap:1.5, height:12 }}>
                {BAR_DELAYS.map((delay,i) => <div key={i} style={{ flex:1, height:'100%', borderRadius:2, background:i%3===0?'rgba(79,140,255,0.5)':'rgba(79,140,255,0.16)', animation:`bar-dance 0.65s ease-in-out ${delay} infinite alternate`, transformOrigin:'bottom' }} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
