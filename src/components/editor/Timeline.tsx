'use client';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, SkipBack, Play, Pause, Volume2, Scissors, Lock, Unlock, Eye, EyeOff } from 'lucide-react';

/* ─── constants ─── */
const TOTAL_S   = 212;   // 3:32
const LABEL_W   = 72;    // px — track label column
const RULER_H   = 24;    // px
const TRACK_H   = 36;    // px per track
const CUT_H     = TRACK_H * 3 + 12; // spans all tracks

/* ─── waveform bars (module-level — SSR safe) ─── */
const WAVEFORM = Array.from({ length: 200 }, (_, i) =>
  Math.abs(Math.sin(i * 0.31 + 1.2) * Math.cos(i * 0.07)) * 0.78 + 0.12
);

/* ─── clip data ─── */
interface Clip { id: string; start: number; end: number; label: string; color: string; border: string; ai?: boolean }

const VIDEO_CLIPS: Clip[] = [
  { id:'v1', start:0,   end:38,  label:'Intro',         color:'#1a1f2e', border:'#2a3a5a' },
  { id:'v2', start:38,  end:74,  label:'Main point',    color:'#1a1f2e', border:'#2a3a5a' },
  { id:'v3', start:74,  end:116, label:'Key insight',   color:'#1a1f2e', border:'#2a3a5a', ai:true },
  { id:'v4', start:116, end:152, label:'Deep dive',     color:'#1a1f2e', border:'#2a3a5a' },
  { id:'v5', start:152, end:212, label:'Strong close',  color:'#1a1f2e', border:'#2a3a5a', ai:true },
];

const AUDIO_CLIPS: Clip[] = [
  { id:'a1', start:0,   end:74,  label:'Main audio',   color:'#1a2210', border:'#2a3a18' },
  { id:'a2', start:74,  end:152, label:'Audio cont.',  color:'#1a2210', border:'#2a3a18', ai:true },
  { id:'a3', start:152, end:212, label:'Audio end',    color:'#1a2210', border:'#2a3a18' },
];

const CAPTION_CLIPS: Clip[] = [
  { id:'cap1', start:4,   end:18,  label:'Caption',  color:'#1e1420', border:'#3a2050' },
  { id:'cap2', start:20,  end:38,  label:'Caption',  color:'#1e1420', border:'#3a2050' },
  { id:'cap3', start:42,  end:60,  label:'Caption',  color:'#1e1420', border:'#3a2050', ai:true },
  { id:'cap4', start:63,  end:82,  label:'Caption',  color:'#1e1420', border:'#3a2050' },
  { id:'cap5', start:86,  end:108, label:'Caption',  color:'#1e1420', border:'#3a2050', ai:true },
  { id:'cap6', start:112, end:138, label:'Caption',  color:'#1e1420', border:'#3a2050' },
  { id:'cap7', start:140, end:162, label:'Caption',  color:'#1e1420', border:'#3a2050' },
  { id:'cap8', start:165, end:192, label:'Caption',  color:'#1e1420', border:'#3a2050', ai:true },
  { id:'cap9', start:195, end:212, label:'Caption',  color:'#1e1420', border:'#3a2050' },
];

/* AI cut regions — shown as darkened gaps */
const AI_CUTS = [
  { id:'cut1', start:38,  end:42,  reason:'Long pause (3.8s)'           },
  { id:'cut2', start:74,  end:86,  reason:'Filler words — "um", "uh"'   },
  { id:'cut3', start:116, end:140, reason:'Repeated sentence'            },
  { id:'cut4', start:192, end:195, reason:'Dead air'                     },
];

/* ─── helpers ─── */
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2,'0')}`;

/* ─── ruler tick calculation ─── */
function getRulerTicks(zoom: number, totalS: number): { s: number; major: boolean }[] {
  // pick interval so we get ~8-14 ticks regardless of zoom
  const intervals = [5, 10, 15, 20, 30, 60];
  const pxPerS = zoom;
  const targetTicks = 10;
  const totalPx = totalS * pxPerS;
  const rawInterval = totalPx / (targetTicks * pxPerS);
  const interval = intervals.reduce((best, iv) => Math.abs(iv - rawInterval) < Math.abs(best - rawInterval) ? iv : best, intervals[0]);
  const ticks: { s: number; major: boolean }[] = [];
  for (let s = 0; s <= totalS; s += interval / 5) {
    ticks.push({ s, major: s % interval === 0 });
  }
  return ticks;
}

export function Timeline() {
  const [playheadS, setPlayheadS] = useState(48);
  const [playing,   setPlaying  ] = useState(false);
  const [zoom,      setZoom     ] = useState(4.2);       // px per second
  const [scrollX,   setScrollX  ] = useState(0);
  const [hoveredCut, setHoveredCut] = useState<string | null>(null);
  const [hoveredClip, setHoveredClip] = useState<string | null>(null);
  const [lockedTracks, setLockedTracks] = useState<Record<string,boolean>>({});
  const [hiddenTracks, setHiddenTracks] = useState<Record<string,boolean>>({});
  const [dragging,  setDragging ] = useState(false);

  const rulerRef   = useRef<HTMLDivElement>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const rafRef     = useRef<number | null>(null);

  const totalPx = TOTAL_S * zoom;

  /* playback ticker */
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayheadS(s => {
        const next = s + dt;
        if (next >= TOTAL_S) { setPlaying(false); return TOTAL_S; }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing]);

  /* auto-scroll playhead into view */
  useEffect(() => {
    if (!scrollRef.current) return;
    const px = playheadS * zoom;
    const { scrollLeft, clientWidth } = scrollRef.current;
    if (px < scrollLeft + 40 || px > scrollLeft + clientWidth - 40) {
      scrollRef.current.scrollLeft = px - clientWidth / 2;
    }
  }, [playheadS, zoom]);

  /* click ruler to seek */
  const seekRuler = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    setPlayheadS(Math.max(0, Math.min(TOTAL_S, x / zoom)));
  }, [zoom]);

  /* drag ruler */
  const onRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setDragging(true);
    seekRuler(e);
    const onMove = (ev: MouseEvent) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const x = ev.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
      setPlayheadS(Math.max(0, Math.min(TOTAL_S, x / zoom)));
    };
    const onUp = () => { setDragging(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const ticks = getRulerTicks(zoom, TOTAL_S);
  const playheadPx = playheadS * zoom;

  const tracks = [
    { id:'video',    label:'Video',    clips: VIDEO_CLIPS,   accent:'#FAFAFA', trackColor:'rgba(255,255,255,0.07)' },
    { id:'audio',    label:'Audio',    clips: AUDIO_CLIPS,   accent:'#34D399', trackColor:'rgba(52,211,153,0.05)' },
    { id:'captions', label:'Captions', clips: CAPTION_CLIPS, accent:'#D4D4D8', trackColor:'rgba(255,255,255,0.05)' },
  ];

  return (
    <div style={{ borderTop:'1px solid #111', background:'#060606', flexShrink:0, display:'flex', flexDirection:'column', height:260, userSelect:'none' }}>

      {/* ── Toolbar ── */}
      <div style={{ height:36, borderBottom:'1px solid #0e0e0e', display:'flex', alignItems:'center', gap:4, padding:'0 10px', flexShrink:0, background:'#070707' }}>

        {/* Transport */}
        <button onClick={() => setPlayheadS(0)} style={toolBtn} title="Go to start">
          <SkipBack size={12} />
        </button>
        <button onClick={() => setPlaying(p => !p)} style={{ ...toolBtn, background:'#111', border:'1px solid #1e1e1e', color:'#FFFFFF', width:28, height:28 }} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" style={{ marginLeft:1 }} />}
        </button>

        <div style={{ width:1, height:18, background:'#141414', margin:'0 4px' }} />

        {/* Timecode */}
        <span style={{ fontFamily:"'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace", fontSize:12, color:'#666', letterSpacing:'0.06em', minWidth:44 }}>
          {fmt(playheadS)}
        </span>
        <span style={{ fontSize:11, color:'#222' }}>/</span>
        <span style={{ fontFamily:"'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace", fontSize:11, color:'#2a2a2a', minWidth:36 }}>
          {fmt(TOTAL_S)}
        </span>

        <div style={{ width:1, height:18, background:'#141414', margin:'0 4px' }} />

        {/* Volume placeholder */}
        <Volume2 size={12} style={{ color:'#2a2a2a' }} />
        <div style={{ width:48, height:2, background:'#1a1a1a', borderRadius:9999, position:'relative', cursor:'pointer' }}>
          <div style={{ width:'80%', height:'100%', background:'#333', borderRadius:9999 }} />
        </div>

        <div style={{ flex:1 }} />

        {/* AI cuts legend */}
        <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 9px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.14)', borderRadius:9999 }}>
          <div style={{ width:8, height:8, borderRadius:2, background:'rgba(255,255,255,0.4)', border:'1px solid rgba(255,255,255,0.6)' }} />
          <span style={{ fontSize:10, color:'#FAFAFA', fontWeight:600 }}>AI edited</span>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 9px', background:'rgba(255,82,82,0.05)', border:'1px solid rgba(255,82,82,0.15)', borderRadius:9999 }}>
          <div style={{ width:8, height:8, background:'repeating-linear-gradient(45deg,rgba(255,82,82,0.4) 0px,rgba(255,82,82,0.4) 1px,transparent 1px,transparent 4px)', borderRadius:2 }} />
          <span style={{ fontSize:10, color:'#FF5252', fontWeight:600 }}>Cuts</span>
        </div>

        <div style={{ width:1, height:18, background:'#141414', margin:'0 4px' }} />

        {/* Zoom */}
        <button onClick={() => setZoom(z => Math.max(1.5, z - 0.8))} style={toolBtn} title="Zoom out"><ZoomOut size={12} /></button>
        <div style={{ width:52, height:3, background:'#141414', borderRadius:9999, cursor:'pointer', position:'relative' }}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            setZoom(1.5 + pct * 10);
          }}
        >
          <div style={{ width:`${((zoom - 1.5) / 10) * 100}%`, height:'100%', background:'#333', borderRadius:9999, transition:'width 100ms' }} />
        </div>
        <button onClick={() => setZoom(z => Math.min(11.5, z + 0.8))} style={toolBtn} title="Zoom in"><ZoomIn size={12} /></button>

        <div style={{ width:1, height:18, background:'#141414', margin:'0 4px' }} />
        <button style={toolBtn} title="Cut"><Scissors size={12} /></button>
      </div>

      {/* ── Main scrollable area ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* Track labels column */}
        <div style={{ width:LABEL_W, flexShrink:0, background:'#070707', borderRight:'1px solid #0e0e0e', display:'flex', flexDirection:'column' }}>
          {/* Ruler corner */}
          <div style={{ height:RULER_H, borderBottom:'1px solid #0e0e0e', background:'#060606' }} />
          {/* Label rows */}
          {tracks.map(t => (
            <div key={t.id} style={{ height:TRACK_H, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 6px 0 10px', borderBottom:'1px solid #0a0a0a', opacity: hiddenTracks[t.id] ? 0.3 : 1 }}>
              <span style={{ fontSize:10, fontWeight:600, color: hiddenTracks[t.id] ? '#333' : '#444', letterSpacing:'0.05em', textTransform:'uppercase' }}>{t.label}</span>
              <div style={{ display:'flex', gap:2 }}>
                <button onClick={() => setHiddenTracks(h => ({ ...h, [t.id]: !h[t.id] }))} style={{ background:'none', border:'none', cursor:'pointer', color: hiddenTracks[t.id] ? '#FAFAFA' : '#222', padding:2, display:'flex', borderRadius:3 }}
                  title={hiddenTracks[t.id] ? 'Show track' : 'Hide track'}>
                  {hiddenTracks[t.id] ? <EyeOff size={9} /> : <Eye size={9} />}
                </button>
                <button onClick={() => setLockedTracks(l => ({ ...l, [t.id]: !l[t.id] }))} style={{ background:'none', border:'none', cursor:'pointer', color: lockedTracks[t.id] ? '#F59E0B' : '#222', padding:2, display:'flex', borderRadius:3 }}
                  title={lockedTracks[t.id] ? 'Unlock track' : 'Lock track'}>
                  {lockedTracks[t.id] ? <Lock size={9} /> : <Unlock size={9} />}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Scrollable track area */}
        <div ref={scrollRef} style={{ flex:1, overflow:'auto', position:'relative', minWidth:0 }}
          onScroll={e => setScrollX((e.target as HTMLDivElement).scrollLeft)}>
          <div style={{ width:totalPx, position:'relative', minWidth:'100%' }}>

            {/* ── Ruler ── */}
            <div ref={rulerRef} onMouseDown={onRulerMouseDown}
              style={{ height:RULER_H, position:'sticky', top:0, background:'#060606', borderBottom:'1px solid #0e0e0e', zIndex:20, cursor:'col-resize', width:totalPx }}>
              {ticks.map((t, i) => (
                <div key={i} style={{ position:'absolute', left:t.s * zoom, top:0, bottom:0, display:'flex', flexDirection:'column', alignItems:'center' }}>
                  <div style={{ width:1, height: t.major ? 10 : 5, background: t.major ? '#2a2a2a' : '#1a1a1a', marginTop:'auto' }} />
                  {t.major && (
                    <span style={{ position:'absolute', bottom:2, left:3, fontSize:9, color:'#333', whiteSpace:'nowrap', fontFamily:"'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace" }}>
                      {fmt(t.s)}
                    </span>
                  )}
                </div>
              ))}

              {/* Playhead on ruler */}
              <div style={{ position:'absolute', top:0, left:playheadPx, transform:'translateX(-50%)', zIndex:30, pointerEvents:'none', display:'flex', flexDirection:'column', alignItems:'center' }}>
                <div style={{ width:0, height:0, borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:'7px solid #FAFAFA' }} />
              </div>
            </div>

            {/* ── Track rows ── */}
            {tracks.map((track) => {
              const hidden = hiddenTracks[track.id];
              return (
                <div key={track.id} style={{ height:TRACK_H, position:'relative', borderBottom:'1px solid #0a0a0a', background: hidden ? '#060606' : track.trackColor, opacity: hidden ? 0.25 : 1 }}>

                  {/* Grid lines every 10s */}
                  {Array.from({ length: Math.ceil(TOTAL_S / 10) }, (_, i) => (
                    <div key={i} style={{ position:'absolute', top:0, bottom:0, left:i*10*zoom, width:1, background:'rgba(255,255,255,0.02)', pointerEvents:'none' }} />
                  ))}

                  {/* Audio waveform for audio track */}
                  {track.id === 'audio' && (
                    <div style={{ position:'absolute', inset:'6px 0', display:'flex', alignItems:'center', pointerEvents:'none' }}>
                      {WAVEFORM.map((h, i) => (
                        <div key={i} style={{ flex:1, height:`${h * 100}%`, background:'rgba(52,211,153,0.18)', borderRadius:1 }} />
                      ))}
                    </div>
                  )}

                  {/* Clips */}
                  {track.clips.map(clip => (
                    <div key={clip.id}
                      onMouseEnter={() => setHoveredClip(clip.id)}
                      onMouseLeave={() => setHoveredClip(null)}
                      style={{
                        position:'absolute', top:3, bottom:3,
                        left:clip.start * zoom, width:(clip.end - clip.start) * zoom - 2,
                        background: clip.ai
                          ? track.id === 'video'   ? 'rgba(255,255,255,0.18)'
                          : track.id === 'audio'   ? 'rgba(52,211,153,0.18)'
                          : 'rgba(255,255,255,0.18)'
                          : clip.color,
                        border:`1px solid ${clip.ai
                          ? track.id === 'video'   ? 'rgba(255,255,255,0.5)'
                          : track.id === 'audio'   ? 'rgba(52,211,153,0.5)'
                          : 'rgba(255,255,255,0.5)'
                          : clip.border}`,
                        borderRadius:5, cursor: lockedTracks[track.id] ? 'not-allowed' : 'grab',
                        overflow:'hidden', transition:'filter 120ms',
                        filter: hoveredClip === clip.id && !lockedTracks[track.id] ? 'brightness(1.4)' : 'brightness(1)',
                        boxShadow: clip.ai ? `0 0 0 1px ${track.accent}22` : 'none',
                      }}>
                      {/* Clip label — only if wide enough */}
                      {(clip.end - clip.start) * zoom > 40 && (
                        <span style={{ position:'absolute', left:6, top:'50%', transform:'translateY(-50%)', fontSize:9, fontWeight:600, color: clip.ai ? track.accent : '#333', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'90%' }}>
                          {clip.ai && '✦ '}{clip.label}
                        </span>
                      )}

                      {/* Resize handle right */}
                      {!lockedTracks[track.id] && (
                        <div style={{ position:'absolute', top:0, right:0, width:4, bottom:0, cursor:'ew-resize', background:'transparent' }}
                          onMouseEnter={e => { e.currentTarget.style.background = track.accent + '44'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        />
                      )}
                    </div>
                  ))}

                  {/* Clip hover tooltip */}
                  {hoveredClip && track.clips.find(c => c.id === hoveredClip) && (() => {
                    const clip = track.clips.find(c => c.id === hoveredClip)!;
                    return (
                      <div style={{ position:'absolute', top:-36, left:clip.start * zoom, zIndex:50, background:'#111', border:'1px solid #1e1e1e', borderRadius:7, padding:'5px 9px', whiteSpace:'nowrap', boxShadow:'0 4px 20px rgba(0,0,0,0.6)', pointerEvents:'none' }}>
                        <span style={{ fontSize:10, color:'#A1A1A1', fontWeight:500 }}>{clip.label}</span>
                        <span style={{ fontSize:10, color:'#333', marginLeft:6 }}>{fmt(clip.start)} → {fmt(clip.end)}</span>
                        {clip.ai && <span style={{ fontSize:9, color:track.accent, marginLeft:6, fontWeight:700 }}>AI</span>}
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {/* ── AI Cut regions (across all tracks) ── */}
            {AI_CUTS.map(cut => (
              <div key={cut.id}
                onMouseEnter={() => setHoveredCut(cut.id)}
                onMouseLeave={() => setHoveredCut(null)}
                style={{
                  position:'absolute',
                  top: RULER_H,
                  left: cut.start * zoom,
                  width: (cut.end - cut.start) * zoom,
                  height: TRACK_H * tracks.length,
                  background:'repeating-linear-gradient(45deg,rgba(255,82,82,0.06) 0px,rgba(255,82,82,0.06) 2px,transparent 2px,transparent 8px)',
                  borderLeft:'1.5px solid rgba(255,82,82,0.5)',
                  borderRight:'1.5px solid rgba(255,82,82,0.5)',
                  zIndex:10, cursor:'pointer',
                  transition:'background 150ms',
                }}
              >
                {/* Cut label at top */}
                {(cut.end - cut.start) * zoom > 20 && (
                  <div style={{ position:'absolute', top:2, left:3, right:3, display:'flex', alignItems:'center', gap:3 }}>
                    <div style={{ width:12, height:12, borderRadius:3, background:'rgba(255,82,82,0.15)', border:'1px solid rgba(255,82,82,0.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:6, fontWeight:900, color:'#FF5252' }}>✂</span>
                    </div>
                    {(cut.end - cut.start) * zoom > 50 && (
                      <span style={{ fontSize:8, color:'rgba(255,82,82,0.7)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{fmt(cut.end - cut.start)}s cut</span>
                    )}
                  </div>
                )}

                {/* Hover tooltip */}
                {hoveredCut === cut.id && (
                  <div style={{ position:'absolute', top:-52, left:'50%', transform:'translateX(-50%)', background:'#111', border:'1px solid #222', borderRadius:8, padding:'8px 12px', whiteSpace:'nowrap', boxShadow:'0 8px 30px rgba(0,0,0,0.7)', zIndex:100, pointerEvents:'none' }}>
                    <p style={{ fontSize:11, fontWeight:600, color:'#FF5252', margin:'0 0 2px', fontFamily:"'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace" }}>AI removed · {fmt(cut.end - cut.start)} sec</p>
                    <p style={{ fontSize:10, color:'#555', margin:0 }}>{cut.reason}</p>
                    <div style={{ position:'absolute', bottom:-5, left:'50%', transform:'translateX(-50%)', width:8, height:8, background:'#111', border:'1px solid #222', borderBottom:'none', borderRight:'none', rotate:'225deg' }} />
                  </div>
                )}
              </div>
            ))}

            {/* ── Playhead ── */}
            <div style={{ position:'absolute', top:RULER_H, left:playheadPx, bottom:0, width:1, background:'#FAFAFA', zIndex:25, pointerEvents:'none', boxShadow:'0 0 6px rgba(255,255,255,0.5)' }}>
              <div style={{ position:'absolute', top:0, left:-4, width:9, height:9, background:'#FAFAFA', borderRadius:'50%', boxShadow:'0 0 8px rgba(255,255,255,0.7)' }} />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

const toolBtn: React.CSSProperties = {
  width:26, height:26, display:'flex', alignItems:'center', justifyContent:'center',
  background:'transparent', border:'none', cursor:'pointer', color:'#333', borderRadius:5,
  transition:'all 120ms',
};
