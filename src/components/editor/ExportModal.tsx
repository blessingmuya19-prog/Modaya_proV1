'use client';
import React, { useMemo, useState } from 'react';
import { Download, CheckCircle, X, ChevronDown, AlertTriangle } from 'lucide-react';
import {
  renderToFile, downloadBlob, describeBytes, exportSupported,
} from '@/lib/render/exporter';
import type { Sequence } from '@/lib/render/sequence';

/* ── design tokens (mirrors EditorShell) ── */
const C = {
  bg:     '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b:      '#111111', b2:      '#141414', b3: '#1a1a1a', b4: '#222222',
  accent: '#8B5CF6', accentH: '#A78BFA',
  text:   '#F5F7FA', sec: '#A5ADBA', muted: '#737D8D', dim: '#4D5664',
  green:  '#34D399', greenBg: 'rgba(5,150,105,0.12)', greenBorder: 'rgba(52,211,153,0.25)',
};
const F = "'Inter Tight', Inter, system-ui, sans-serif";

/* ── Export options ── */
type Format   = 'MP4' | 'MOV' | 'WebM';
type Res      = '1080p' | '720p' | '480p';
type Quality  = 'high' | 'balanced' | 'small';

const QUALITY_INFO: Record<Quality, { label: string; note: string; videoBits: number }> = {
  high:     { label: 'High',     note: 'Recommended for posting',        videoBits: 12_000_000 },
  balanced: { label: 'Balanced', note: 'Good quality, smaller file',     videoBits: 7_000_000  },
  small:    { label: 'Small',    note: 'Smallest file, some softness',   videoBits: 3_500_000  },
};
/** Longest-edge pixel target for each resolution choice. */
const RES_LONG_EDGE: Record<Res, number> = { '1080p': 1920, '720p': 1280, '480p': 854 };

type ExportState = 'configure' | 'rendering' | 'done';

const RENDER_STEPS = [
  'Compositing cuts, text and grade',
  'Encoding video stream',
  'Capturing source audio',
  'Muxing audio + video',
  'Finalising file',
];

/* ── sub-components ── */

function Divider() {
  return <div style={{ height: 1, background: C.b2, margin: '18px 0' }} />;
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
  const formats: Format[] = ['MP4', 'WebM', 'MOV'];
  const [open, setOpen] = React.useState(false);

  const FORMAT_DESC: Record<Format, string> = {
    MP4:  'Most compatible · H.264 (browser records MP4 where supported)',
    WebM: 'VP9/Opus · works everywhere recording does',
    MOV:  'QuickTime · exported as MP4 here',
  };

  return (
    <div style={{ position: 'relative' }}>
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
            background: C.accent + '18', border: `1px solid ${C.accent}33`, color: C.accent,
          }}>{value}</span>
          <span style={{ fontFamily: F, fontSize: 12, fontWeight: 400, color: C.muted }}>
            {FORMAT_DESC[value]}
          </span>
        </span>
        <ChevronDown size={13} color={C.muted}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms', flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
            background: C.s2, border: `1px solid ${C.accent + '44'}`,
            borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {formats.map((f, i) => (
              <button
                key={f}
                onClick={() => { onChange(f); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  background: f === value ? C.accent + '10' : 'transparent',
                  border: 'none', borderTop: i > 0 ? `1px solid ${C.b2}` : 'none',
                  fontFamily: F, cursor: 'pointer', textAlign: 'left', transition: 'background 100ms',
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
                <span style={{ fontFamily: F, fontSize: 12, fontWeight: 400, color: f === value ? C.text : C.sec }}>
                  {FORMAT_DESC[f]}
                </span>
                {f === value && (
                  <span style={{ marginLeft: 'auto', fontFamily: F, fontSize: 10, fontWeight: 600, color: C.accent }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RenderingScreen({ resolution, quality, progress, error, onBack }: {
  resolution: Res; quality: Quality; progress: number; error: string | null; onBack: () => void;
}) {
  const pct = Math.round(progress * 100);
  const stepIdx = error ? -1 : Math.min(RENDER_STEPS.length - 1, Math.floor(progress * RENDER_STEPS.length));

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent,
          boxShadow: `0 0 8px ${C.accent}`, animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
        <span style={{ fontFamily: F, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: C.accent }}>
          {error ? 'Failed' : 'Recording'}
        </span>
        <span style={{ fontFamily: F, fontSize: 11, fontWeight: 500, color: C.muted, marginLeft: 'auto',
          fontVariantNumeric: 'tabular-nums' }}>{error ? '' : `${pct}%`}</span>
      </div>

      <h3 style={{ fontFamily: F, fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em', color: C.text, margin: '0 0 6px' }}>
        {error ? 'Export failed' : 'Exporting your video'}
      </h3>
      <p style={{ fontFamily: F, fontSize: 13, fontWeight: 400, color: C.muted, margin: '0 0 28px' }}>
        {resolution} · {QUALITY_INFO[quality].label}
      </p>

      {error ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <AlertTriangle size={20} color="#ef4444" />
          </div>
          <p style={{ fontFamily: F, fontSize: 12, fontWeight: 400, color: C.muted, margin: '0 0 18px' }}>{error}</p>
          <button onClick={onBack} style={{
            padding: '10px 22px', fontFamily: F, fontSize: 13, fontWeight: 600,
            background: C.s3, color: C.text, border: `1px solid ${C.b3}`, borderRadius: 8, cursor: 'pointer',
          }}>
            Back to settings
          </button>
        </div>
      ) : (
        <>
          <div style={{ height: 3, background: C.b2, borderRadius: 9999, marginBottom: 24, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 9999,
              background: `linear-gradient(90deg, ${C.accent}, ${C.accentH})`,
              transition: 'width 200ms linear', boxShadow: `0 0 8px ${C.accent}66` }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {RENDER_STEPS.map((step, i) => {
              const done = i < stepIdx;
              const current = i === stepIdx;
              return (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10,
                  opacity: i > stepIdx + 1 ? 0.28 : 1, transition: 'opacity 300ms' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: done ? C.green : current ? C.accent : C.b4,
                    boxShadow: current ? `0 0 6px ${C.accent}` : 'none', transition: 'all 300ms' }} />
                  <span style={{ fontFamily: F, fontSize: 12, fontWeight: current ? 600 : 400,
                    letterSpacing: '-0.01em', lineHeight: 1.3,
                    color: done ? C.muted : current ? C.text : C.dim, transition: 'all 300ms' }}>
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

          <p style={{ fontFamily: F, fontSize: 11, fontWeight: 400, color: C.dim, margin: '24px 0 0', textAlign: 'center' }}>
            Recording in real time — it takes about as long as the finished clip. Keep this tab in the foreground.
          </p>
        </>
      )}
    </div>
  );
}

function DoneScreen({ result, filename, onDownload, onClose }: {
  result: { extension: string; mimeType: string; blob: Blob; durationS: number };
  filename: string;
  onDownload: () => void;
  onClose: () => void;
}) {
  const mm = Math.floor(result.durationS / 60);
  const ss = String(Math.floor(result.durationS % 60)).padStart(2, '0');
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: C.greenBg,
        border: `1px solid ${C.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px', animation: 'scale-in 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
        <CheckCircle size={24} color={C.green} />
      </div>

      <h3 style={{ fontFamily: F, fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em', color: C.text, margin: '0 0 6px' }}>
        Your video is ready
      </h3>
      <p style={{ fontFamily: F, fontSize: 13, fontWeight: 400, color: C.muted, margin: '0 0 28px' }}>
        {filename}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[
          { label: 'Duration', value: `${mm}:${ss}` },
          { label: 'Format',   value: result.extension.toUpperCase() },
          { label: 'Size',     value: describeBytes(result.blob.size) },
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

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <button onClick={onDownload} style={{
          flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          padding: '13px', fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
          background: C.accent, color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer',
          boxShadow: `0 4px 16px ${C.accent}44`, transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = C.accentH; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.accent; }}
        >
          <Download size={14} /> Download again
        </button>
        <button onClick={onClose} style={{
          flex: 1, padding: '13px', fontFamily: F, fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',
          background: C.s3, color: C.sec, border: `1px solid ${C.b3}`, borderRadius: 10, cursor: 'pointer',
          transition: 'all 150ms',
        }}>
          Done
        </button>
      </div>
      <p style={{ fontFamily: F, fontSize: 11, fontWeight: 400, color: C.dim, margin: 0 }}>
        Saved straight to your downloads — the file lives only on this device.
      </p>
    </div>
  );
}

/* ── Main modal ── */
export interface ExportModalProps {
  open:       boolean;
  onClose:    () => void;
  /** Required for a real export; absent only in non-live shell mockups. */
  sequence?:  Sequence | null;
  sourceUrl?: string | null;
  sourceId?:  string;
  projectName?: string;
}

export function ExportModal({ open, onClose, sequence = null, sourceUrl = null, sourceId = 'main', projectName }: ExportModalProps) {
  const [state,    setState]    = useState<ExportState>('configure');
  const [format,   setFormat]   = useState<Format>('MP4');
  const [res,      setRes]      = useState<Res>('1080p');
  const [quality,  setQuality]  = useState<Quality>('high');
  const [fps]      = useState(30);
  const [progress, setProgress] = useState(0);
  const [error,    setError]    = useState<string | null>(null);
  const [result,   setResult]   = useState<{ blob: Blob; extension: string; mimeType: string; durationS: number } | null>(null);

  const supported = useMemo(() => exportSupported(), []);
  const ready = !!sequence && !!sourceUrl;

  const filename = useMemo(() => {
    const base = (projectName || 'modaya-export').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').trim() || 'modaya-export';
    return `${base.replace(/\s+/g, '-').toLowerCase()}.${result?.extension ?? 'mp4'}`;
  }, [projectName, result]);

  const reset = () => { setState('configure'); setError(null); setProgress(0); setResult(null); };
  const handleClose = () => { reset(); onClose(); };

  const startExport = async () => {
    if (!sequence || !sourceUrl) return;
    setError(null);
    setProgress(0);
    setState('rendering');
    try {
      const r = await renderToFile({
        sequence,
        sourceUrl,
        sourceId,
        resLongEdge: RES_LONG_EDGE[res],
        fps,
        videoBits: QUALITY_INFO[quality].videoBits,
        preferFormat: format === 'WebM' ? 'webm' : 'mp4',
        onProgress: setProgress,
      });
      setResult(r);
      downloadBlob(r.blob, `${(projectName || 'modaya').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'modaya'}.${r.extension}`);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong while recording.');
    }
  };

  if (!open) return null;

  return (
    <div onClick={handleClose} style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: C.surface, border: `1px solid ${C.b3}`,
        borderRadius: 16, padding: '28px 28px 24px', boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        animation: 'scale-in 0.25s cubic-bezier(0.22,1,0.36,1)', maxHeight: '90vh', overflowY: 'auto', position: 'relative',
      }}>
        {state !== 'rendering' && (
          <button onClick={handleClose} style={{
            position: 'absolute', top: 16, right: 16, width: 28, height: 28, borderRadius: 8,
            background: C.s3, border: `1px solid ${C.b3}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: C.muted, transition: 'all 120ms',
          }}>
            <X size={13} />
          </button>
        )}

        {state === 'configure' && (
          <div>
            <h3 style={{ fontFamily: F, fontWeight: 700, fontSize: 22, letterSpacing: '-0.025em', color: C.text, margin: '0 0 4px' }}>
              Export
            </h3>
            <p style={{ fontFamily: F, fontSize: 13, fontWeight: 400, color: C.muted, margin: '0 0 4px' }}>
              Renders exactly what the preview shows — cuts, captions, text and grade.
            </p>
            {(!supported || !ready) && (
              <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)',
                display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <AlertTriangle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontFamily: F, fontSize: 12, fontWeight: 400, color: C.sec, lineHeight: 1.45 }}>
                  {!supported
                    ? 'This browser cannot record a video here (needs canvas captureStream + MediaRecorder). Try a current Chrome or Edge.'
                    : 'Re-upload the media in this browser first — export records the playable preview.'}
                </span>
              </div>
            )}

            <Divider />

            <Label>Format</Label>
            <FormatSelect value={format} onChange={setFormat} />

            <div style={{ height: 16 }} />

            <Label>Resolution</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {(['1080p', '720p', '480p'] as Res[]).map(r => (
                <OptBtn key={r} active={res === r} onClick={() => setRes(r)}>{r}</OptBtn>
              ))}
            </div>

            <Label>Quality</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {(['high', 'balanced', 'small'] as Quality[]).map(q => (
                <button key={q} onClick={() => setQuality(q)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'all 120ms',
                  border: `1px solid ${quality === q ? C.accent + '55' : C.b3}`,
                  background: quality === q ? C.accent + '0e' : C.s3,
                }}>
                  <div style={{ textAlign: 'left' }}>
                    <span style={{ fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
                      color: quality === q ? C.accent : C.text, display: 'block' }}>{QUALITY_INFO[q].label}</span>
                    <span style={{ fontFamily: F, fontSize: 11, fontWeight: 400, color: C.muted, display: 'block', marginTop: 1 }}>
                      {QUALITY_INFO[q].note}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <button onClick={startExport} disabled={!supported || !ready} style={{
              width: '100%', padding: '14px', fontFamily: F, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
              background: (!supported || !ready) ? C.b3 : C.accent,
              color: (!supported || !ready) ? C.dim : '#fff',
              border: 'none', borderRadius: 10,
              cursor: (!supported || !ready) ? 'not-allowed' : 'pointer',
              boxShadow: (!supported || !ready) ? 'none' : `0 4px 20px ${C.accent}44`, transition: 'all 150ms',
            }}>
              Export · {res} · {QUALITY_INFO[quality].label}
            </button>
            <p style={{ fontFamily: F, fontSize: 11, fontWeight: 400, color: C.dim, margin: '10px 0 0', textAlign: 'center' }}>
              Records in real time ({Math.round((sequence?.durationS ?? 0))}s ≈ that long) and downloads on this device.
            </p>
          </div>
        )}

        {state === 'rendering' && (
          <RenderingScreen resolution={res} quality={quality} progress={progress} error={error} onBack={reset} />
        )}

        {state === 'done' && result && (
          <DoneScreen
            result={result}
            filename={filename}
            onDownload={() => downloadBlob(result.blob, filename)}
            onClose={handleClose}
          />
        )}
      </div>
    </div>
  );
}
