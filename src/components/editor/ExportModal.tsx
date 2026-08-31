'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Download, CheckCircle, X, ChevronDown } from 'lucide-react';

/* ── design tokens (mirrors EditorShell) ── */
const C = {
  bg:     '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b:      '#111111', b2:      '#141414', b3: '#1a1a1a', b4: '#222222',
  accent: '#4F8CFF', accentH: '#6EA3FF',
  text:   '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  green:  '#34D399', greenBg: 'rgba(5,150,105,0.12)', greenBorder: 'rgba(52,211,153,0.25)',
};
const F = "'Inter Tight', Inter, system-ui, sans-serif";

/* ── Export options ── */
type Format   = 'MP4' | 'MOV' | 'WebM';
type Res      = '4K' | '1080p' | '720p' | '480p';
type Ratio    = '16:9' | '9:16' | '1:1' | '4:5';
type Quality  = 'max' | 'high' | 'balanced' | 'small';

interface Preset {
  format:   Format;
  res:      Res;
  ratio:    Ratio;
  quality:  Quality;
  fps:      number;
  captions: boolean;
  desc:     string;
}



const QUALITY_INFO: Record<Quality, { label: string; bitrate: string; note: string }> = {
  max:      { label: 'Maximum',  bitrate: '~50 Mbps', note: 'Largest file, best for archiving' },
  high:     { label: 'High',     bitrate: '~16 Mbps', note: 'Recommended for most platforms'   },
  balanced: { label: 'Balanced', bitrate: '~8 Mbps',  note: 'Good quality, smaller file'       },
  small:    { label: 'Small',    bitrate: '~4 Mbps',  note: 'Smallest file, some quality loss' },
};

const RES_LABEL: Record<Res, string> = { '4K':'3840 × 2160', '1080p':'1920 × 1080', '720p':'1280 × 720', '480p':'854 × 480' };
const FILE_SIZE: Record<Quality, Record<Res, string>> = {
  max:      { '4K':'~1.8 GB', '1080p':'~820 MB', '720p':'~440 MB', '480p':'~240 MB' },
  high:     { '4K':'~650 MB', '1080p':'~260 MB', '720p':'~140 MB', '480p':'~75 MB'  },
  balanced: { '4K':'~320 MB', '1080p':'~130 MB', '720p':'~70 MB',  '480p':'~38 MB'  },
  small:    { '4K':'~160 MB', '1080p':'~64 MB',  '720p':'~34 MB',  '480p':'~18 MB'  },
};

type ExportState = 'configure' | 'rendering' | 'done';

const RENDER_STEPS = [
  'Analysing clip boundaries',
  'Applying colour grade',
  'Burning in captions',
  'Encoding video stream',
  'Muxing audio',
  'Finalising container',
];

/* ── sub-components ── */

function Divider() {
  return <div style={{ height: 1, background: C.b2, margin: '20px 0' }} />;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: F, fontSize: 10, fontWeight: 500, letterSpacing: '0.04em',
      textTransform: 'uppercase', color: C.muted, margin: '0 0 8px' }}>
      {children}
    </p>
  );
}

function OptBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '9px 6px', fontFamily: F, fontSize: 12, fontWeight: active ? 600 : 500,
      borderRadius: 8, cursor: 'pointer', transition: 'all 120ms',
      border: `1px solid ${active ? C.accent + '55' : C.b3}`,
      background: active ? C.accent + '12' : C.s3,
      color: active ? C.accent : C.sec,
    }}>
      {children}
    </button>
  );
}

function FormatSelect({ value, onChange }: { value: Format; onChange: (f: Format) => void }) {
  const formats: Format[] = ['MP4', 'MOV', 'WebM'];
  const [open, setOpen] = React.useState(false);

  const FORMAT_DESC: Record<Format, string> = {
    MP4:  'Most compatible · H.264',
    MOV:  'Apple ProRes · macOS',
    WebM: 'Web-optimised · VP9',
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', background: C.s3,
          border: `1px solid ${open ? C.accent + '55' : C.b3}`,
          borderRadius: open ? '8px 8px 0 0' : 8,
          fontFamily: F, fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',
          color: C.text, cursor: 'pointer', outline: 'none', transition: 'border-color 120ms',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: F, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
            padding: '2px 7px', borderRadius: 4,
            background: C.accent + '18', border: `1px solid ${C.accent}33`,
            color: C.accent,
          }}>{value}</span>
          <span style={{ fontFamily: F, fontSize: 12, fontWeight: 400, color: C.muted }}>
            {FORMAT_DESC[value]}
          </span>
        </span>
        <ChevronDown
          size={13} color={C.muted}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms', flexShrink: 0 }}
        />
      </button>

      {/* Dropdown list */}
      {open && (
        <>
          {/* Click-away backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
            background: C.s2, border: `1px solid ${C.accent + '44'}`,
            borderTop: 'none', borderRadius: '0 0 8px 8px',
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {formats.map((f, i) => (
              <button
                key={f}
                onClick={() => { onChange(f); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: f === value ? C.accent + '10' : 'transparent',
                  border: 'none',
                  borderTop: i > 0 ? `1px solid ${C.b2}` : 'none',
                  fontFamily: F, cursor: 'pointer', textAlign: 'left',
                  transition: 'background 100ms',
                }}
                onMouseEnter={e => { if (f !== value) e.currentTarget.style.background = C.s3; }}
                onMouseLeave={e => { if (f !== value) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  fontFamily: F, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                  background: f === value ? C.accent + '22' : C.b3,
                  border: `1px solid ${f === value ? C.accent + '44' : C.b4}`,
                  color: f === value ? C.accent : C.muted,
                }}>{f}</span>
                <span style={{ fontFamily: F, fontSize: 12, fontWeight: 400,
                  color: f === value ? C.text : C.sec }}>
                  {FORMAT_DESC[f]}
                </span>
                {f === value && (
                  <span style={{ marginLeft: 'auto', fontFamily: F, fontSize: 10,
                    fontWeight: 600, color: C.accent }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RenderingScreen({ resolution, ratio, quality, captions, onDone }:
  { resolution: Res; ratio: Ratio; quality: Quality; captions: boolean; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [stepIdx,  setStepIdx ] = useState(0);
  const raf = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let p = 0;
    raf.current = setInterval(() => {
      const inc = Math.random() * 4 + 1.5;
      p = Math.min(100, p + inc);
      setProgress(p);
      setStepIdx(Math.min(RENDER_STEPS.length - 1, Math.floor((p / 100) * RENDER_STEPS.length)));
      if (p >= 100) {
        clearInterval(raf.current!);
        setTimeout(onDone, 600);
      }
    }, 180);
    return () => { if (raf.current) clearInterval(raf.current); };
  }, [onDone]);

  const pct = Math.round(progress);

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent,
          boxShadow: `0 0 8px ${C.accent}`, animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
        <span style={{ fontFamily: F, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: C.accent }}>Rendering</span>
        <span style={{ fontFamily: F, fontSize: 11, fontWeight: 500, color: C.muted, marginLeft: 'auto',
          fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      </div>

      <h3 style={{ fontFamily: F, fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em',
        color: C.text, margin: '0 0 6px' }}>
        Exporting your video
      </h3>
      <p style={{ fontFamily: F, fontSize: 13, fontWeight: 400, color: C.muted, margin: '0 0 28px' }}>
        {resolution} · {ratio} · {QUALITY_INFO[quality].label}{captions ? ' · Captions' : ''}
      </p>

      {/* Progress bar */}
      <div style={{ height: 3, background: C.b2, borderRadius: 9999, marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, borderRadius: 9999,
          background: `linear-gradient(90deg, ${C.accent}, ${C.accentH})`,
          transition: 'width 200ms linear', boxShadow: `0 0 8px ${C.accent}66` }} />
      </div>

      {/* Step timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {RENDER_STEPS.map((step, i) => {
          const done    = i < stepIdx;
          const current = i === stepIdx;
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10,
              opacity: i > stepIdx + 1 ? 0.28 : 1, transition: 'opacity 300ms' }}>
              {/* dot */}
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: done ? C.green : current ? C.accent : C.b4,
                boxShadow: current ? `0 0 6px ${C.accent}` : 'none',
                transition: 'all 300ms' }} />
              <span style={{ fontFamily: F, fontSize: 12, fontWeight: current ? 600 : 400,
                letterSpacing: '-0.01em', lineHeight: 1.3,
                color: done ? C.muted : current ? C.text : C.dim,
                transition: 'all 300ms' }}>
                {step}
              </span>
              {done && (
                <span style={{ fontFamily: F, fontSize: 10, fontWeight: 600, color: C.green,
                  marginLeft: 'auto', letterSpacing: '0.02em' }}>✓</span>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontFamily: F, fontSize: 11, fontWeight: 400, color: C.dim,
        margin: '24px 0 0', textAlign: 'center' }}>
        Estimated time remaining: {Math.max(0, Math.round((100 - progress) / 18))}s
      </p>
    </div>
  );
}

function DoneScreen({ resolution, ratio, quality, format, onClose }:
  { resolution: Res; ratio: Ratio; quality: Quality; format: Format; onClose: () => void }) {
  const size = FILE_SIZE[quality][resolution];
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      {/* Success icon */}
      <div style={{ width: 52, height: 52, borderRadius: '50%',
        background: C.greenBg, border: `1px solid ${C.greenBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px', animation: 'scale-in 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
        <CheckCircle size={24} color={C.green} />
      </div>

      <h3 style={{ fontFamily: F, fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em',
        color: C.text, margin: '0 0 6px' }}>
        Ready to download
      </h3>
      <p style={{ fontFamily: F, fontSize: 13, fontWeight: 400, color: C.muted, margin: '0 0 28px' }}>
        Podcast Episode 14 · {resolution} · {ratio} · {format}
      </p>

      {/* File info row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[
          { label: 'Duration', value: '3:32'     },
          { label: 'Format',   value: format      },
          { label: 'Size',     value: size        },
          { label: 'Quality',  value: QUALITY_INFO[quality].label },
        ].map(({ label, value }) => (
          <div key={label} style={{ flex: 1, padding: '10px 6px', background: C.s3,
            border: `1px solid ${C.b3}`, borderRadius: 8 }}>
            <p style={{ fontFamily: F, fontSize: 9, fontWeight: 500, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: C.muted, margin: '0 0 4px' }}>{label}</p>
            <p style={{ fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
              color: C.text, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <button style={{
          flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          padding: '13px', fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
          background: C.accent, color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer',
          boxShadow: `0 4px 16px ${C.accent}44`, transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = C.accentH; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.accent;  e.currentTarget.style.transform = ''; }}
        >
          <Download size={14} /> Download
        </button>
        <button onClick={onClose} style={{
          flex: 1, padding: '13px', fontFamily: F, fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',
          background: C.s3, color: C.sec, border: `1px solid ${C.b3}`, borderRadius: 10, cursor: 'pointer',
          transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.b4; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.b3; e.currentTarget.style.color = C.sec; }}
        >
          Done
        </button>
      </div>

      <p style={{ fontFamily: F, fontSize: 11, fontWeight: 400, color: C.dim, margin: 0 }}>
        Link expires in 48 hours
      </p>
    </div>
  );
}

/* ── Main modal ── */
export function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state,    setState   ] = useState<ExportState>('configure');
  const [format,   setFormat  ] = useState<Format>('MP4');
  const [res,      setRes     ] = useState<Res>('1080p');
  const [ratio,    setRatio   ] = useState<Ratio>('16:9');
  const [quality,  setQuality ] = useState<Quality>('high');
  const [fps,      setFps     ] = useState(30);
  const [captions, setCaptions] = useState(true);

  const handleClose = () => { setState('configure'); onClose(); };

  if (!open) return null;

  return (
    /* Backdrop */
    <div onClick={handleClose} style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      {/* Sheet */}
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        background: C.surface, border: `1px solid ${C.b3}`,
        borderRadius: 16, padding: '28px 28px 24px',
        boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        animation: 'scale-in 0.25s cubic-bezier(0.22,1,0.36,1)',
        maxHeight: '90vh', overflowY: 'auto',
        position: 'relative',
      }}>
        {/* Close button */}
        {state !== 'rendering' && (
          <button onClick={handleClose} style={{
            position: 'absolute', top: 16, right: 16,
            width: 28, height: 28, borderRadius: 8,
            background: C.s3, border: `1px solid ${C.b3}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: C.muted, transition: 'all 120ms',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.b4; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.b3; }}
          >
            <X size={13} />
          </button>
        )}

        {/* ── Configure ── */}
        {state === 'configure' && (
          <div>
            <h3 style={{ fontFamily: F, fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em',
              color: C.text, margin: '0 0 4px' }}>
              Export
            </h3>
            <p style={{ fontFamily: F, fontSize: 13, fontWeight: 400, color: C.muted, margin: '0 0 24px' }}>
              Podcast Episode 14 · 3:32
            </p>

            <Divider />

            {/* Format */}
            <Label>Format</Label>
            <FormatSelect value={format} onChange={setFormat} />

            <div style={{ height: 16 }} />

            {/* Resolution */}
            <Label>Resolution</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {(['4K','1080p','720p','480p'] as Res[]).map(r => (
                <OptBtn key={r} active={res === r} onClick={() => setRes(r)}>
                  <span style={{ display: 'block' }}>{r}</span>
                  <span style={{ fontFamily: F, fontSize: 9, fontWeight: 400, color: res === r ? C.accent + 'cc' : C.dim,
                    display: 'block', marginTop: 2 }}>{RES_LABEL[r].split(' × ')[0]}</span>
                </OptBtn>
              ))}
            </div>

            {/* Aspect ratio */}
            <Label>Aspect ratio</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {(['16:9','9:16','1:1','4:5'] as Ratio[]).map(r => (
                <OptBtn key={r} active={ratio === r} onClick={() => setRatio(r)}>{r}</OptBtn>
              ))}
            </div>

            {/* Quality */}
            <Label>Quality</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {(['max','high','balanced','small'] as Quality[]).map(q => (
                <button key={q} onClick={() => setQuality(q)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'all 120ms',
                  border: `1px solid ${quality === q ? C.accent + '55' : C.b3}`,
                  background: quality === q ? C.accent + '0e' : C.s3,
                }}>
                  <div style={{ textAlign: 'left' }}>
                    <span style={{ fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
                      color: quality === q ? C.accent : C.text, display: 'block' }}>
                      {QUALITY_INFO[q].label}
                    </span>
                    <span style={{ fontFamily: F, fontSize: 11, fontWeight: 400, color: C.muted, display: 'block', marginTop: 1 }}>
                      {QUALITY_INFO[q].note}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ fontFamily: F, fontSize: 11, fontWeight: 500, color: quality === q ? C.accent : C.muted,
                      display: 'block', fontVariantNumeric: 'tabular-nums' }}>
                      {QUALITY_INFO[q].bitrate}
                    </span>
                    <span style={{ fontFamily: F, fontSize: 10, fontWeight: 400, color: C.dim, display: 'block', marginTop: 1 }}>
                      {FILE_SIZE[q][res]}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* FPS + Captions row */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              {/* FPS */}
              <div style={{ flex: 1 }}>
                <Label>Frame rate</Label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[24, 30, 60].map(f => (
                    <OptBtn key={f} active={fps === f} onClick={() => setFps(f)}>{f} fps</OptBtn>
                  ))}
                </div>
              </div>
            </div>

            {/* Captions toggle */}
            <button onClick={() => setCaptions(c => !c)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '11px 12px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${captions ? C.accent + '44' : C.b3}`,
              background: captions ? C.accent + '08' : C.s3,
              marginBottom: 24, transition: 'all 120ms',
            }}>
              <span style={{ fontFamily: F, fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',
                color: captions ? C.text : C.sec }}>Burn in captions</span>
              {/* toggle */}
              <div style={{ width: 34, height: 18, borderRadius: 9999, position: 'relative',
                background: captions ? C.accent : C.b4, transition: 'background 200ms' }}>
                <div style={{ position: 'absolute', top: 2, left: captions ? 18 : 2, width: 14, height: 14,
                  borderRadius: '50%', background: '#fff', transition: 'left 200ms',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </div>
            </button>

            {/* Export button */}
            <button onClick={() => setState('rendering')} style={{
              width: '100%', padding: '14px', fontFamily: F, fontSize: 14, fontWeight: 600,
              letterSpacing: '-0.01em', background: C.accent, color: '#fff',
              border: 'none', borderRadius: 10, cursor: 'pointer',
              boxShadow: `0 4px 20px ${C.accent}44`, transition: 'all 150ms',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = C.accentH; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.accent;  e.currentTarget.style.transform = ''; }}
            >
              Export · {res} {ratio} {QUALITY_INFO[quality].label}
            </button>
          </div>
        )}

        {/* ── Rendering ── */}
        {state === 'rendering' && (
          <RenderingScreen
            resolution={res} ratio={ratio} quality={quality} captions={captions}
            onDone={() => setState('done')}
          />
        )}

        {/* ── Done ── */}
        {state === 'done' && (
          <DoneScreen resolution={res} ratio={ratio} quality={quality} format={format} onClose={handleClose} />
        )}
      </div>
    </div>
  );
}
