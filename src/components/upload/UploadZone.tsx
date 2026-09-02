'use client';
import React, { useState, useCallback, useRef } from 'react';
import { Upload, Film } from 'lucide-react';

export function UploadZone({ onFileSelect }: { onFileSelect: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDragEnter = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(false); }, []);
  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('video/')) onFileSelect(f);
  }, [onFileSelect]);

  return (
    <div
      onDragEnter={onDragEnter} onDragLeave={onDragLeave}
      onDragOver={onDragOver} onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        width: '100%', minHeight: 280,
        border: `2px dashed ${dragging ? '#8B5CF6' : '#242424'}`,
        borderRadius: 16,
        background: dragging ? 'rgba(139,92,246,0.04)' : '#111111',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', cursor: 'pointer',
        transform: dragging ? 'scale(1.01)' : 'scale(1)',
        transition: 'all 200ms ease',
        padding: 32,
        boxShadow: dragging ? 'inset 0 0 40px rgba(139,92,246,0.05)' : 'none',
      }}
      onMouseEnter={e => { if (!dragging) { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#181818'; } }}
      onMouseLeave={e => { if (!dragging) { e.currentTarget.style.borderColor = '#242424'; e.currentTarget.style.background = '#111111'; } }}
    >
      <input ref={inputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }} />

      <div style={{
        width: 56, height: 56, borderRadius: 16, marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: dragging ? 'rgba(139,92,246,0.15)' : '#181818',
        border: `1px solid ${dragging ? 'rgba(139,92,246,0.4)' : '#242424'}`,
        transform: dragging ? 'translateY(-4px)' : 'none',
        transition: 'all 200ms ease',
      }}>
        {dragging
          ? <Film size={24} style={{ color: '#8B5CF6' }} />
          : <Upload size={24} style={{ color: '#666' }} />
        }
      </div>

      <p style={{
        fontFamily: "'Inter Tight',sans-serif", fontWeight: 650, fontSize: 18,
        color: dragging ? '#8B5CF6' : '#FFFFFF',
        margin: '0 0 8px', letterSpacing: '-0.025em',
        transition: 'color 200ms',
      }}>
        {dragging ? 'Drop it here' : 'Drop your video here'}
      </p>
      <p style={{ fontSize: 14, color: '#A1A1A1', margin: '0 0 12px' }}>
        or <span style={{ color: '#FFFFFF', textDecoration: 'underline', cursor: 'pointer' }}>choose a file</span>
      </p>
      <p style={{ fontSize: 12, color: '#666', margin: 0 }}>MP4, MOV, WebM · Up to 60 minutes</p>
    </div>
  );
}
