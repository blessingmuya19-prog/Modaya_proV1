'use client';
import React, { useState, useRef, useCallback } from 'react';
import { ProcessingScreen } from '@/components/processing/ProcessingScreen';
import { Logo } from '@/components/ui/Logo';
import { ArrowLeft, ArrowRight, Upload, X, Zap, Scissors, Flame, Captions, Sparkles, Smartphone, Check, Play, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setMedia, analyseFile, MediaEntry } from '@/lib/videoStore';
import { capturePoster, savePoster } from '@/lib/thumbnailStore';
import { saveMediaFile } from '@/lib/mediaDb';
import { backupFootageToCloud } from '@/lib/mediaCloud';

const PRESETS = [
  { Icon: Zap,        label: 'Make it faster',  fill: 'Make this video faster and remove all unnecessary pauses and dead air.' },
  { Icon: Scissors,   label: 'Remove mistakes', fill: 'Remove filler words, stumbles, repeated sentences and dead air.' },
  { Icon: Flame,      label: 'Find highlights', fill: 'Find the strongest 2 minutes and cut everything else.' },
  { Icon: Captions,   label: 'Add captions',    fill: 'Transcribe and add accurate captions to the full video.' },
  { Icon: Sparkles,   label: 'Clean up',        fill: 'Clean up the pacing, remove silence and tighten the overall edit.' },
  { Icon: Smartphone, label: 'Make vertical',   fill: 'Reframe and crop to 9:16 vertical format, keeping the speaker centred.' },
];

export default function UploadPage() {
  const [stage, setStage] = useState<'upload' | 'prompt' | 'processing'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [detectedMeta, setDetectedMeta] = useState<Omit<MediaEntry,'objectUrl'>|null>(null);
  const [captions,   setCaptions  ] = useState(true);
  const [uploading,  setUploading ] = useState(false);
  const [uploadError,setUploadError] = useState<string | null>(null);
  const [projectId,  setProjectId ] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const uploadAndProcess = async () => {
    if (!file || !prompt.trim()) return;
    setUploadError(null);
    setUploading(true);
    try {
      // Use already-analysed meta (or re-analyse if needed)
      const meta = detectedMeta ?? await analyseFile(file);

      // Capture a poster frame so the project has a real thumbnail everywhere
      const posterUrl = previewUrl ?? URL.createObjectURL(file);
      const thumbnail = await capturePoster(posterUrl).catch(() => '');

      // Send only metadata — no file bytes (Vercel 4.5MB limit + read-only FS)
      // The blob URL stays in-browser for playback.
      const res = await fetch('/api/upload', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename:    file.name,
          sizeMb:      Math.round((file.size / (1024 * 1024)) * 10) / 10,
          prompt,
          aspectRatio: meta.aspectRatio,
          durationS:   meta.durationS,
          width:       meta.width,
          height:      meta.height,
          thumbnail,
        }),
      });
      let data: Record<string, string> = {};
      try { data = await res.json(); } catch { /* non-JSON response */ }

      if (res.ok && data.projectId) {
        // Success — store blob URL and move to processing screen
        const objUrl = previewUrl ?? URL.createObjectURL(file);
        setMedia(data.projectId, { ...meta, objectUrl: objUrl });
        if (thumbnail) savePoster(data.projectId, thumbnail);
        // Keep the actual bytes so the project still plays after a refresh or
        // when it's reopened from the dashboard in a new session.
        void saveMediaFile(data.projectId, file, {
          mimeType:    meta.mimeType,
          mediaType:   meta.mediaType,
          aspectRatio: meta.aspectRatio,
          width:       meta.width,
          height:      meta.height,
          durationS:   meta.durationS,
          filename:    meta.filename,
        });
        // Durable server copy so the project reopens on any device (no-op on
        // read-only serverless hosts, where IndexedDB remains the store).
        backupFootageToCloud(data.projectId, file, { filename: meta.filename });
        setProjectId(data.projectId);
        setStage('processing');
      } else if (res.status === 401) {
        setUploadError('You\'re not signed in. Please sign in and try again.');
        setUploading(false);
      } else if (res.status === 413) {
        setUploadError('File too large for this server. This demo supports files up to 4 MB.');
        setUploading(false);
      } else {
        setUploadError(data.error ?? `Server error (${res.status}). Please try again.`);
        setUploading(false);
      }
    } catch (err) {
      console.error('[upload client]', err);
      setUploadError('Could not reach the server. Check your connection and try again.');
      setUploading(false);
    }
  };

  const handleFile = useCallback(async (f: File | null) => {
    if (!f) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url  = URL.createObjectURL(f);
    setPreviewUrl(url);
    setFile(f);
    // Auto-detect format, dimensions, duration
    const meta = await analyseFile(f);
    setDetectedMeta(meta);
    setStage('prompt');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('video/')) handleFile(f);
  };

  const formatBytes = (b: number) => b < 1024*1024 ? `${(b/1024).toFixed(0)} KB` : `${(b/(1024*1024)).toFixed(1)} MB`;

  if (stage === 'processing') {
    return <ProcessingScreen filename={file?.name} onComplete={() => router.push(`/studio/${projectId ?? 'proj-1'}`)} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{ height: 56, borderBottom: '1px solid #141414', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#737D8D', background: 'none', border: 'none', cursor: 'pointer', transition: 'color 150ms' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#444'; }}
          >
            <ArrowLeft size={14} /> Back
          </button>
        </Link>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Logo size={24} />
        </div>
        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {['Upload', 'Edit'].map((label, i) => {
            const stepStage = i === 0 ? 'upload' : 'prompt';
            const isActive = stage === stepStage;
            const isDone = (i === 0 && stage === 'prompt');
            return (
              <React.Fragment key={i}>
                {i > 0 && <div style={{ width: 20, height: 1, background: '#1e1e1e' }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, background: isDone ? '#FAFAFA' : isActive ? 'transparent' : 'transparent', border: isDone ? 'none' : isActive ? '1.5px solid #FAFAFA' : '1px solid #1e1e1e', color: isDone ? '#fff' : isActive ? '#FAFAFA' : '#333' }}>
                    {isDone ? <Check size={10} strokeWidth={3} /> : i + 1}
                  </div>
                  <span style={{ fontSize: 12, color: isActive ? '#FFFFFF' : isDone ? '#FAFAFA' : '#333' }}>{label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }} className="upload-content">
        <div style={{ width: '100%', maxWidth: 580 }}>

          {/* ── STAGE: UPLOAD ── */}
          {stage === 'upload' && (
            <div style={{ animation: 'slide-up 0.5s cubic-bezier(0.22,1,0.36,1) both' }}>
              <h1 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 'clamp(24px,4vw,36px)', letterSpacing: '-0.04em', color: '#FFFFFF', margin: '0 0 8px', textAlign: 'center' }}>
                Drop your footage
              </h1>
              <p style={{ fontSize: 15, fontWeight: 400, letterSpacing: '-0.01em', color: '#A5ADBA', textAlign: 'center', margin: '0 0 36px', lineHeight: 1.6 }}>
                Upload your video and tell AI how to edit it.
              </p>

              <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0] ?? null)} />

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                style={{
                  border: `1.5px dashed ${isDragging ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 18, padding: '64px 32px', cursor: 'pointer',
                  background: isDragging ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                  backdropFilter: 'blur(20px)', textAlign: 'center',
                  boxShadow: isDragging ? '0 0 40px rgba(255,255,255,0.1)' : 'inset 0 1px 0 rgba(255,255,255,0.04)',
                  transition: 'all 250ms ease',
                }}
              >
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: isDragging ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isDragging ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', transition: 'all 250ms' }}>
                  <Upload size={22} color={isDragging ? '#FAFAFA' : 'rgba(255,255,255,0.5)'} strokeWidth={1.75} />
                </div>
                <p style={{ fontSize: 16, fontWeight: 600, color: isDragging ? '#FAFAFA' : '#FFFFFF', margin: '0 0 8px', transition: 'color 200ms' }}>
                  {isDragging ? 'Drop it here' : 'Drop your video here'}
                </p>
                <p style={{ fontSize: 14, color: '#737D8D', margin: '0 0 16px' }}>
                  or <span style={{ color: '#FAFAFA' }}>browse files</span>
                </p>
                <p style={{ fontSize: 12, color: '#252525', margin: 0, letterSpacing: '0.05em' }}>MP4 · MOV · WebM · up to 3 hours</p>
              </div>

              <p style={{ textAlign: 'center', fontSize: 12, color: '#222', marginTop: 16 }}>
                Your footage is never shared or used to train AI models.
              </p>
            </div>
          )}

          {/* ── STAGE: PROMPT ── */}
          {stage === 'prompt' && file && (
            <div style={{ animation: 'slide-up 0.45s cubic-bezier(0.22,1,0.36,1) both' }}>
              <h1 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 'clamp(22px,3.5vw,32px)', letterSpacing: '-0.04em', color: '#FFFFFF', margin: '0 0 8px', textAlign: 'center' }}>
                What should we do with it?
              </h1>
              <p style={{ fontSize: 15, fontWeight: 400, letterSpacing: '-0.01em', color: '#A5ADBA', textAlign: 'center', margin: '0 0 28px' }}>
                Tell Modaya how to edit your video.
              </p>

              {/* File chip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0c0c0c', border: '1px solid #1a1a1a', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#111', border: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Play size={12} color="#FAFAFA" fill="#FAFAFA" style={{ marginLeft: 1 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', fontFamily: "'Inter Tight', Inter, system-ui, sans-serif", color: '#A5ADBA', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</p>
                  <p style={{ fontSize: 11, fontWeight: 400, letterSpacing: '-0.01em', fontFamily: "'Inter Tight', Inter, system-ui, sans-serif", color: '#737D8D', margin: 0 }}>{formatBytes(file.size)}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 9999, padding: '2px 8px' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#FAFAFA' }} />
                  <span style={{ fontSize: 10, color: '#FAFAFA', fontWeight: 600 }}>Ready</span>
                </div>
                <button onClick={() => { setFile(null); setStage('upload'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#737D8D', display: 'flex', padding: 0 }}>
                  <X size={14} />
                </button>
              </div>

              {/* Prompt textarea */}
              <div style={{ background: '#0A0A0A', border: '1px solid #1e1e1e', borderRadius: 14, overflow: 'hidden', marginBottom: 10 }}
                onFocus={() => {}} // handled by textarea
              >
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe your edit... e.g. Make this faster, remove pauses, add captions and keep the strongest moments."
                  rows={4}
                  style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '16px 18px 12px', fontSize: 14, color: '#FFFFFF', fontFamily: "'Inter Tight', Inter, system-ui, sans-serif", resize: 'none', lineHeight: 1.5, letterSpacing: '-0.01em', boxSizing: 'border-box' }}
                />
                {/* Controls bar */}
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '10px 14px', borderTop: '1px solid #141414', background: '#050505' }} className="prompt-controls">
                  {/* Auto-detected format badge */}
                  {detectedMeta && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 7, background: '#0e0e0e',
                      border: '1px solid #1e1e1e' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#FAFAFA',
                        letterSpacing: '0.04em', textTransform: 'uppercase',
                        fontFamily: "'Inter Tight', sans-serif" }}>
                        Auto-detected
                      </span>
                      <span style={{ width: 1, height: 10, background: '#2a2a2a' }} />
                      <span style={{ fontSize: 11, fontWeight: 500, color: '#A5ADBA',
                        fontFamily: "'Inter Tight', sans-serif" }}>
                        {detectedMeta.aspectRatio}
                      </span>
                      {detectedMeta.width > 0 && (
                        <>
                          <span style={{ width: 1, height: 10, background: '#2a2a2a' }} />
                          <span style={{ fontSize: 11, color: '#737D8D',
                            fontFamily: "'Inter Tight', sans-serif" }}>
                            {detectedMeta.width}×{detectedMeta.height}
                          </span>
                        </>
                      )}
                      {detectedMeta.durationS > 0 && (
                        <>
                          <span style={{ width: 1, height: 10, background: '#2a2a2a' }} />
                          <span style={{ fontSize: 11, color: '#737D8D',
                            fontFamily: "'Inter Tight', sans-serif" }}>
                            {Math.floor(detectedMeta.durationS / 60)}:{String(Math.floor(detectedMeta.durationS % 60)).padStart(2,'0')}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  {/* Captions toggle */}
                  <button onClick={() => setCaptions(!captions)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', fontSize: 11, fontWeight: 500, borderRadius: 8, border: `1px solid ${captions ? 'rgba(255,255,255,0.25)' : '#1a1a1a'}`, background: captions ? 'rgba(255,255,255,0.08)' : 'transparent', color: captions ? '#FAFAFA' : '#3a3a3a', cursor: 'pointer', transition: 'all 150ms' }}>
                    <Captions size={11} /> Captions
                  </button>
                  {/* Submit */}
                  <div style={{ marginLeft: 'auto' }} className="ml-auto">
                    <button
                      onClick={uploadAndProcess} disabled={uploading || !prompt.trim()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, color: prompt.trim() && !uploading ? '#09090B' : '#FFFFFF', background: prompt.trim() && !uploading ? 'linear-gradient(180deg,#FFFFFF,#E4E4E7)' : '#1C1C21', border: 'none', borderRadius: 10, cursor: prompt.trim() && !uploading ? 'pointer' : 'not-allowed', boxShadow: prompt.trim() && !uploading ? '0 1px 2px rgba(0,0,0,0.45)' : 'none', transition: 'all 200ms' }}
                    >
                      {uploading ? 'Uploading…' : 'Edit video'} <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Upload error banner ── */}
              {uploadError && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '12px 16px',
                  background: 'rgba(248,113,113,0.07)',
                  border: '1px solid rgba(248,113,113,0.25)',
                  borderRadius: 10,
                  marginTop: 12,
                  animation: 'slide-up 0.3s cubic-bezier(0.22,1,0.36,1)',
                }}>
                  <AlertCircle size={16} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 13, fontWeight: 600,
                      color: '#f87171', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
                      Upload failed
                    </p>
                    <p style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 12, fontWeight: 400,
                      color: '#fca5a5', margin: 0, lineHeight: 1.5 }}>
                      {uploadError}
                    </p>
                  </div>
                  <button
                    onClick={() => setUploadError(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      color: '#f87171', display: 'flex', padding: 2, flexShrink: 0,
                      opacity: 0.7, transition: 'opacity 120ms' }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Quick presets */}
              <p style={{ fontSize: 11, color: '#4D5664', margin: '16px 0 10px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Quick edits</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {PRESETS.map((p, i) => (
                  <button key={i} onClick={() => setPrompt(p.fill)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', fontSize: 12, color: prompt === p.fill ? '#FAFAFA' : '#444', background: prompt === p.fill ? 'rgba(255,255,255,0.08)' : 'transparent', border: `1px solid ${prompt === p.fill ? 'rgba(255,255,255,0.22)' : '#1a1a1a'}`, borderRadius: 9999, cursor: 'pointer', transition: 'all 200ms' }}
                    onMouseEnter={e => { if (prompt !== p.fill) { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderColor = '#2e2e2e'; } }}
                    onMouseLeave={e => { if (prompt !== p.fill) { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = '#1a1a1a'; } }}
                  >
                    <p.Icon size={11} strokeWidth={1.75} /><span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
