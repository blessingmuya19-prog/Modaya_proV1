'use client';
import React, { useState } from 'react';

// Pre-computed so server and client render identical heights
const AUDIO_WAVEFORM = Array.from({ length: 120 }, (_, i) =>
  `${Math.abs(Math.sin(i * 0.3)) * 70 + 15}%`
);

const mockCuts = [
  { id: 'c1', position: 18, duration: 2.4, reason: 'Long pause' },
  { id: 'c2', position: 36, duration: 4.1, reason: 'Repeated sentence' },
  { id: 'c3', position: 52, duration: 1.8, reason: 'Filler words ("um", "uh")' },
  { id: 'c4', position: 71, duration: 6.2, reason: 'Off-topic tangent' },
];

const mockKeeps = [
  { id: 'k1', position: 28, reason: 'Strong emotional moment' },
  { id: 'k2', position: 62, reason: 'Key insight delivery' },
];

const videoClips  = [{ s:0,w:15 },{ s:16,w:18,ai:true },{ s:35,w:15 },{ s:51,w:19,ai:true },{ s:71,w:29 }];
const audioClips  = [{ s:0,w:33 },{ s:34,w:35 },{ s:70,w:30 }];
const captionClips = [{ s:2,w:10 },{ s:13,w:14 },{ s:28,w:8 },{ s:37,w:12 },{ s:50,w:9 },{ s:60,w:10 },{ s:72,w:15 },{ s:88,w:9 }];

export function Timeline() {
  const [playhead, setPlayhead] = useState(28);
  const [hoveredCut, setHoveredCut] = useState<string | null>(null);
  const [hoveredKeep, setHoveredKeep] = useState<string | null>(null);

  const LABEL_W = 56;

  return (
    <div style={{ borderTop: '1px solid #242424', background: '#0A0A0A', flexShrink: 0, height: 140 }}>
      {/* Header */}
      <div style={{ height: 32, borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10, color: '#666', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Timeline</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#666' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(79,140,255,0.5)', border: '1px solid rgba(79,140,255,0.4)', display: 'inline-block' }} />
            AI cuts
          </span>
        </div>
        <span style={{ fontSize: 10, color: '#444' }}>3:32 total</span>
      </div>

      {/* Body */}
      <div style={{ position: 'relative', padding: '8px 8px 8px', height: 108, overflow: 'hidden' }}>
        {/* Playhead */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: '#4F8CFF', zIndex: 30, pointerEvents: 'none', left: `calc(${LABEL_W}px + ${playhead}% * (100% - ${LABEL_W}px) / 100)` }}>
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, background: '#4F8CFF', rotate: '45deg' }} />
        </div>

        {/* Tracks */}
        <div style={{ paddingLeft: LABEL_W, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Video',    clips: videoClips,   h: 22, baseBg: '#1a1a1a', baseBorder: '#242424', aiBg: 'rgba(79,140,255,0.12)', aiBorder: 'rgba(79,140,255,0.4)' },
            { label: 'Audio',    clips: audioClips,   h: 16, baseBg: '#0A0A0A', baseBorder: '#1a1a2a', aiBg: '', aiBorder: '' },
            { label: 'Captions', clips: captionClips, h: 11, baseBg: '#141421', baseBorder: '#1a1a2a', aiBg: '', aiBorder: '' },
          ].map((track, ti) => (
            <div key={ti} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: -LABEL_W, width: LABEL_W - 4, textAlign: 'right', fontSize: 9, color: '#444' }}>
                {track.label}
              </div>
              <div
                style={{ flex: 1, height: track.h, position: 'relative', background: '#0A0A0A', cursor: 'pointer', borderRadius: 3 }}
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPlayhead(((e.clientX - rect.left) / rect.width) * 100);
                }}
              >
                {track.clips.map((clip, i) => (
                  <div key={i} style={{
                    position: 'absolute', top: 1, bottom: 1, borderRadius: 4,
                    left: `${(clip as { s: number; w: number; ai?: boolean }).s}%`,
                    width: `${(clip as { s: number; w: number; ai?: boolean }).w}%`,
                    background: (clip as { ai?: boolean }).ai && track.aiBg ? track.aiBg : track.baseBg,
                    border: `1px solid ${(clip as { ai?: boolean }).ai && track.aiBorder ? track.aiBorder : track.baseBorder}`,
                  }} />
                ))}

                {/* Waveform for audio */}
                  {ti === 1 && (
                    <div style={{ position: 'absolute', inset: 2, display: 'flex', alignItems: 'flex-end', gap: 0.5, overflow: 'hidden' }}>
                      {AUDIO_WAVEFORM.map((h, i) => (
                        <div key={i} style={{ flex: 1, borderRadius: 1, height: h, background: 'rgba(255,255,255,0.06)' }} />
                      ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* AI Cut markers */}
        {mockCuts.map(cut => (
          <div
            key={cut.id}
            style={{ position: 'absolute', top: 8, zIndex: 20, left: `calc(${LABEL_W}px + ${cut.position}% * (100% - ${LABEL_W}px) / 100)` }}
            onMouseEnter={() => setHoveredCut(cut.id)}
            onMouseLeave={() => setHoveredCut(null)}
          >
            <div style={{ width: 2, height: 56, background: 'rgba(79,140,255,0.6)', cursor: 'pointer' }} />
            <div style={{ position: 'absolute', top: -4, left: -4, width: 10, height: 10, background: 'rgba(200,255,61,0.85)', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 5, color: '#050505', fontWeight: 900 }}>AI</span>
            </div>
            {hoveredCut === cut.id && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8,
                background: '#181818', border: '1px solid #242424', borderRadius: 8,
                padding: '8px 10px', width: 160, boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                pointerEvents: 'none', animation: 'fade-in 0.15s ease',
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF', margin: '0 0 3px' }}>AI removed {cut.duration}s</p>
                <p style={{ fontSize: 10, color: '#666', margin: 0 }}>&ldquo;{cut.reason}&rdquo;</p>
              </div>
            )}
          </div>
        ))}

        {/* AI Keep markers */}
        {mockKeeps.map(keep => (
          <div
            key={keep.id}
            style={{ position: 'absolute', top: 8, zIndex: 20, left: `calc(${LABEL_W}px + ${keep.position}% * (100% - ${LABEL_W}px) / 100)` }}
            onMouseEnter={() => setHoveredKeep(keep.id)}
            onMouseLeave={() => setHoveredKeep(null)}
          >
            <div style={{ width: 1, height: 56, background: 'rgba(255,255,255,0.15)', cursor: 'pointer' }} />
            <div style={{ position: 'absolute', top: -4, left: -4, width: 10, height: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 2 }} />
            {hoveredKeep === keep.id && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8,
                background: '#181818', border: '1px solid #242424', borderRadius: 8,
                padding: '8px 10px', width: 160, boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                pointerEvents: 'none', animation: 'fade-in 0.15s ease',
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#4F8CFF', margin: '0 0 3px' }}>AI kept this section</p>
                <p style={{ fontSize: 10, color: '#666', margin: 0 }}>&ldquo;{keep.reason}&rdquo;</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
