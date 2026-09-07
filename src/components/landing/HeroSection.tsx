'use client';
/**
 * Hero — the product, working.
 *
 * The pitch is one line; the demo under it *shows* the whole loop: footage
 * lands, the instruction types itself, the edit is measured and explained,
 * and an edit map appears with what changed and why. No screenshots, no stock
 * video — this is a stylised frame of the real Studio flow.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Play, Cpu, Scissors, Captions, Zap, Sparkles, Smartphone, Film } from 'lucide-react';
import { ACCENT, ACCENT_HI, ACCENT_SOFT, ACCENT_TINT, ACCENT_BRD, ACCENT_GLOW, INK, FONT_D, FONT_M, PrimaryButton, GhostLink } from './kit';

const BAR_DELAYS = Array.from({ length: 22 }, (_, i) => `${(i * 0.05).toFixed(2)}s`);
const DEMO_PROMPT = 'Cut the dead air, keep the strongest 90 seconds, add bold captions and make it punchier at the hook.';
const DEMO_STEPS = [
  'Measured 2 strong moments in your footage',
  'Removed 14 pauses · 3:11 of dead air',
  'Animated zooms on both emphasis points',
  'Captions written & timed to the words',
  'Whip transition where the source jumps',
];
const DEMO_FILE = { name: 'podcast_episode_14.mp4', duration: '42:18' };

const PRESETS = [
  { Icon: Zap,        label: 'Cut the pauses' },
  { Icon: Scissors,   label: 'Find highlights' },
  { Icon: Captions,   label: 'Add captions' },
  { Icon: Smartphone, label: 'Make vertical' },
  { Icon: Sparkles,   label: 'Match a reference' },
  { Icon: Film,       label: 'Punchier cuts' },
];

const FEATURE_POINTS = ['Your footage — never generated', 'Every change explained', 'Every change versioned'];

export function HeroSection() {
  const [uploaded, setUploaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(DEMO_FILE.name);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'working' | 'done'>('idle');
  const [typed, setTyped] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wait = useCallback((ms: number) => new Promise<void>(r => { timerRef.current = setTimeout(r, ms); }), []);
  const clearTimer = useCallback(() => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    if (!uploaded) return;
    let alive = true;
    const loop = async () => {
      setPhase('idle'); setTyped(''); setSteps([]);
      await wait(900); if (!alive) return;
      setPhase('typing');
      for (let i = 0; i <= DEMO_PROMPT.length; i++) {
        if (!alive) return;
        setTyped(DEMO_PROMPT.slice(0, i));
        await wait(16 + Math.random() * 12);
      }
      await wait(420); if (!alive) return;
      setPhase('working');
      for (let i = 0; i < DEMO_STEPS.length; i++) {
        if (!alive) return;
        await wait(560);
        setSteps(s => [...s, DEMO_STEPS[i]]);
      }
      await wait(900); if (!alive) return;
      setPhase('done');
      await wait(4200); if (!alive) return;
      loop();
    };
    loop();
    return () => { alive = false; clearTimer(); };
  }, [uploaded, wait, clearTimer]);

  useEffect(() => {
    const t = setTimeout(() => setUploaded(true), 1400);
    return () => clearTimeout(t);
  }, []);

  const onFile = (f: File | null) => { if (f) { setFileName(f.name); setUploaded(true); } };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0] ?? null); };

  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: INK.bg }}>
      <style>{`
        @keyframes hero-orb { 0%,100%{opacity:.45} 50%{opacity:.85} }
        @keyframes cursor-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes step-in { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes edit-ready { from{opacity:0;transform:scale(.97)} to{opacity:1;transform:scale(1)} }
      `}</style>

      <div aria-hidden style={{
        position: 'absolute', top: '-22%', left: '50%', transform: 'translateX(-50%)',
        width: 1100, height: 700, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(124,92,255,0.16) 0%, transparent 62%)',
        filter: 'blur(64px)', animation: 'hero-orb 7s ease-in-out infinite',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1060, margin: '0 auto', padding: 'clamp(120px, 16vh, 180px) clamp(16px, 4vw, 34px) 0', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 15px', borderRadius: 999, background: ACCENT_TINT, border: `1px solid ${ACCENT_BRD}`, marginBottom: 26 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 10px ${ACCENT_GLOW}` }} />
          <span style={{ fontSize: 12, color: ACCENT_HI, fontWeight: 700, letterSpacing: '0.05em' }}>Editing, not generation</span>
        </div>

        <h1 style={{
          fontFamily: FONT_D, fontWeight: 800, fontSize: 'clamp(38px, 7.2vw, 82px)',
          letterSpacing: '-0.05em', lineHeight: 1.02, color: INK.txt, margin: '0 0 24px',
        }}>
          Drop footage.<br />
          Say the edit.<br />
          <span style={{ color: ACCENT }}>Get the video.</span>
        </h1>

        <p style={{
          fontSize: 'clamp(16px, 1.5vw, 19px)', color: INK.sec, maxWidth: 620,
          margin: '0 auto 34px', lineHeight: 1.65, fontWeight: 400,
        }}>
          Upload your footage — add a reference video if you want that style — and Modaya cuts,
          captions, grades and re-times it for you. No timeline, no keyframes, no manual editing.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
          <PrimaryButton href="/new" sub="No credit card · your footage stays yours">Start editing free</PrimaryButton>
          <GhostLink href="#proof">Watch it work</GhostLink>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap', marginTop: 26 }}>
          {FEATURE_POINTS.map(p => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: INK.mut }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: ACCENT }} /> {p}
            </span>
          ))}
        </div>

        {/* Preset chips — the language you speak to it */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', margin: '38px 0 8px' }}>
          {PRESETS.map(({ Icon, label }) => (
            <button key={label} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px',
              borderRadius: 999, background: INK.card, border: `1px solid ${INK.line}`,
              color: INK.sec, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
              transition: 'border-color 150ms ease, color 150ms ease, background 150ms ease',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT_BRD; e.currentTarget.style.color = ACCENT_HI; e.currentTarget.style.background = INK.card2; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = INK.line; e.currentTarget.style.color = INK.sec; e.currentTarget.style.background = INK.card; }}
            >
              <Icon size={13} color={ACCENT} strokeWidth={2} /> {label}
            </button>
          ))}
        </div>

        {/* ── The product, working ── */}
        <div style={{ marginTop: 44 }}>
          {!uploaded ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                maxWidth: 880, margin: '0 auto', padding: 'clamp(34px, 5vw, 64px)',
                borderRadius: 22, cursor: 'pointer',
                background: dragging ? ACCENT_SOFT : INK.card,
                border: `1.5px dashed ${dragging ? ACCENT : INK.line2}`,
                transition: 'border-color 200ms ease, background 200ms ease',
              }}
            >
              <input ref={fileRef} type="file" accept="video/*" hidden onChange={e => onFile(e.target.files?.[0] ?? null)} />
              <div style={{ width: 54, height: 54, margin: '0 auto 18px', borderRadius: 16, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Upload size={22} color={ACCENT} strokeWidth={2} />
              </div>
              <p style={{ fontFamily: FONT_D, fontSize: 19, fontWeight: 700, color: INK.txt, margin: '0 0 6px' }}>
                Drop your footage — or click to browse
              </p>
              <p style={{ fontSize: 13.5, color: INK.mut, margin: 0 }}>
                MP4 · MOV · WebM · a reference video is optional
              </p>
            </div>
          ) : (
            <HeroDemo fileName={fileName} phase={phase} typed={typed} steps={steps} />
          )}
        </div>
      </div>
    </section>
  );
}

/* ── demo card ────────────────────────────────────────────────────────────── */

function HeroDemo({ fileName, phase, typed, steps }: {
  fileName: string; phase: 'idle' | 'typing' | 'working' | 'done'; typed: string; steps: string[];
}) {
  const done = phase === 'done';
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', textAlign: 'left', borderRadius: 20, overflow: 'hidden', border: `1px solid ${INK.line}`, background: INK.card, boxShadow: `0 44px 110px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03), 0 0 60px ${ACCENT_GLOW.replace('0.32', '0.10')}` }}>
      {/* window chrome */}
      <div style={{ height: 42, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', background: INK.card2, borderBottom: `1px solid ${INK.line}` }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {['#E5584E', '#E8A23D', '#3FBF6F'].map(c => <span key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.85 }} />)}
        </div>
        <span style={{ fontFamily: FONT_M, fontSize: 11, color: INK.dim, marginLeft: 6 }}>{fileName}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: done ? ACCENT_HI : INK.dim, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          <Cpu size={12} color={done ? ACCENT : INK.dim} /> {done ? 'Edit ready' : 'Modaya at work'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 4fr)', minHeight: 420 }}>
        {/* left — the editor's view */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, borderRight: `1px solid ${INK.line}` }}>
          {/* prompt bubble */}
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ width: 26, height: 26, borderRadius: 9, flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: `1px solid ${INK.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Film size={12} color={INK.sec} />
            </span>
            <div style={{ flex: 1, background: INK.card2, border: `1px solid ${INK.line}`, borderRadius: '4px 14px 14px 14px', padding: '12px 14px', minHeight: 52 }}>
              <span style={{ fontSize: 13, color: INK.sec, lineHeight: 1.55 }}>
                {typed}{phase === 'typing' && <span style={{ animation: 'cursor-blink 1s steps(1) infinite', color: ACCENT }}>▍</span>}
              </span>
            </div>
          </div>

          {/* measured steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, animation: 'step-in 0.35s ease both' }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', background: ACCENT_SOFT, border: `1px solid ${ACCENT_BRD}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: ACCENT }} />
                </span>
                <span style={{ fontSize: 12.5, color: INK.sec }}>{s}</span>
              </div>
            ))}
            {phase === 'working' && steps.length < DEMO_STEPS.length && (
              <span style={{ fontSize: 12.5, color: INK.dim }}>measuring…</span>
            )}
          </div>

          {/* edit map */}
          <div style={{ marginTop: 'auto', background: INK.card2, border: `1px solid ${INK.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: INK.mut, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Edit map</span>
              <span style={{ fontSize: 10.5, color: ACCENT_HI, fontFamily: FONT_M }}>{done ? '6 changes · every one explained' : 'loading…'}</span>
            </div>
            <div style={{ position: 'relative', height: 26, borderRadius: 7, background: INK.well, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 8, transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.10)' }} />
              {[['4%', 'CUT', ACCENT], ['22%', 'ZOOM', ACCENT_HI], ['38%', 'CAPTION', ACCENT], ['58%', 'CUT', ACCENT_HI], ['76%', 'ZOOM', ACCENT], ['92%', 'CUT', ACCENT_HI]].map(([pos, label, col], i) => (
                <div key={i} style={{ position: 'absolute', left: pos, top: 4, bottom: 4, width: 2, background: col, borderRadius: 2, boxShadow: `0 0 8px ${col}` }} title={label} />
              ))}
              {done && (
                <div style={{ position: 'absolute', left: 0, width: '100%', top: 0, bottom: 0, background: 'linear-gradient(90deg, rgba(124,92,255,0.0), rgba(124,92,255,0.12))' }} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {['CUT', 'ZOOM', 'CAPTION'].map(t => (
                <span key={t} style={{ fontSize: 9.5, color: INK.dim, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: ACCENT }} /> {t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* right — the picture */}
        <div style={{ position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <div style={{ width: '100%', aspectRatio: '16/9', maxHeight: 300, background: 'linear-gradient(180deg, #101014 0%, #070709 100%)', borderRadius: 10, border: `1px solid ${done ? ACCENT_BRD : INK.line}`, overflow: 'hidden', position: 'relative', transition: 'border-color 600ms ease' }}>
            <div style={{ position: 'absolute', inset: '14% 10%', display: 'flex', flexDirection: 'column', gap: 11, justifyContent: 'center', opacity: 0.16 }}>
              {[74, 54, 84, 46, 68].map((w, i) => <div key={i} style={{ height: 3.5, width: `${w}%`, background: '#fff', borderRadius: 3 }} />)}
            </div>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: `1px solid ${done ? ACCENT_BRD : 'rgba(255,255,255,0.2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 600ms ease' }}>
                <Play size={14} fill={done ? ACCENT : '#fff'} color={done ? ACCENT : '#fff'} style={{ marginLeft: 3 }} />
              </div>
            </div>
            <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.4)', padding: '3px 9px', borderRadius: 999, border: `1px solid ${done ? ACCENT_BRD : 'rgba(255,255,255,0.12)'}` }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: done ? ACCENT_HI : INK.mut, letterSpacing: '0.06em' }}>{done ? 'AI EDIT · 5 CUTS' : 'RAW FOOTAGE'}</span>
            </div>
            <div style={{ position: 'absolute', bottom: 10, right: 10 }}>
              <span style={{ fontSize: 9.5, color: INK.sec, background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: 999, fontFamily: FONT_M }}>
                {done ? '3:42 · edit' : '42:18 · raw'}
              </span>
            </div>
            {done && (
              <div style={{ position: 'absolute', bottom: '16%', left: '50%', transform: 'translateX(-50%)', background: 'rgba(5,5,5,0.85)', border: `1px solid ${ACCENT_BRD}`, borderRadius: 5, padding: '3px 12px', animation: 'edit-ready 0.5s ease both' }}>
                <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.85)' }}>&ldquo;…and that&rsquo;s the key insight.&rdquo;</span>
              </div>
            )}
          </div>
          <div style={{ position: 'absolute', bottom: 12, left: 22, right: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: INK.dim, fontFamily: FONT_M }}>{done ? '0:00 / 3:42' : '—'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: done ? ACCENT_HI : INK.dim }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: done ? ACCENT : INK.dim, boxShadow: done ? `0 0 8px ${ACCENT_GLOW}` : 'none' }} />
              {done ? 'ready to export' : 'analysing audio'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
