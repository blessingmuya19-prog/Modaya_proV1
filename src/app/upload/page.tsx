'use client';
import React, { useState } from 'react';
import { UploadZone } from '@/components/upload/UploadZone';
import { EditTypeSelector } from '@/components/upload/EditTypeSelector';
import { AIPromptBox } from '@/components/upload/AIPromptBox';
import { ProcessingScreen } from '@/components/processing/ProcessingScreen';
import { Logo } from '@/components/ui/Logo';
import { ArrowLeft, Film } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Stage = 'upload' | 'configure' | 'processing';

export default function UploadPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [editType, setEditType] = useState('creators');
  const router = useRouter();

  if (stage === 'processing') {
    return <ProcessingScreen filename={file?.name} onComplete={() => router.push('/editor/proj-1')} />;
  }

  const stageLabel: Record<string, string> = { upload: 'Upload', configure: 'Configure' };
  const stages: Stage[] = ['upload', 'configure'];

  return (
    <div style={{ minHeight: '100vh', background: '#050505' }}>
      {/* Top bar */}
      <div style={{ height: 56, borderBottom: '1px solid #242424', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/dashboard" style={{ textDecoration: 'none' }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666', background: 'none', border: 'none', cursor: 'pointer', transition: 'color 150ms' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#A1A1A1'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#666'; }}
          >
            <ArrowLeft size={14} /> Back
          </button>
        </Link>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Logo size={26} />
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Stage indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0' }}>
        {stages.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <div style={{ width: 32, height: 1, background: '#242424' }} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                background: stage === s ? 'transparent' : stage === 'configure' && s === 'upload' ? '#4F8CFF' : '#111111',
                border: stage === s ? '2px solid #4F8CFF' : stage === 'configure' && s === 'upload' ? 'none' : '1px solid #242424',
                color: stage === s ? '#4F8CFF' : stage === 'configure' && s === 'upload' ? '#050505' : '#666',
              }}>
                {stage === 'configure' && s === 'upload' ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12, color: stage === s ? '#FFFFFF' : '#666' }}>{stageLabel[s]}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Content */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 64px' }}>
        {stage === 'upload' && (
          <div style={{ animation: 'slide-up 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <h1 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 'clamp(26px,4vw,40px)', letterSpacing: '-0.04em', lineHeight: 1.05, color: '#FFFFFF', margin: '0 0 8px' }}>
                Upload your footage.
              </h1>
              <p style={{ fontSize: 14, color: '#666', margin: 0 }}>Drop in your raw video and we&apos;ll handle the rest.</p>
            </div>
            <UploadZone onFileSelect={f => { setFile(f); setStage('configure'); }} />
          </div>
        )}

        {stage === 'configure' && (
          <div style={{ animation: 'slide-up 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
            {/* File chip */}
            {file && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32,
                padding: 12, background: '#111111', border: '1px solid #242424', borderRadius: 10,
                animation: 'scale-in 0.25s cubic-bezier(0.22,1,0.36,1)',
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(79,140,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Film size={14} style={{ color: '#4F8CFF' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</p>
                  <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
              </div>
            )}

            <h2 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 28, letterSpacing: '-0.04em', lineHeight: 1.1, color: '#FFFFFF', margin: '0 0 24px' }}>
              What do you want to make?
            </h2>
            <EditTypeSelector selected={editType} onSelect={setEditType} />

            <h2 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 650, fontSize: 20, letterSpacing: '-0.03em', color: '#FFFFFF', margin: '32px 0 16px' }}>
              Describe your edit
            </h2>
            <AIPromptBox onEdit={() => setStage('processing')} />
          </div>
        )}
      </div>
    </div>
  );
}
