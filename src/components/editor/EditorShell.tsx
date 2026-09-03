'use client';
import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import Link from 'next/link';
import { Logo, LogoMark } from '../ui/Logo';
import { ExportModal } from './ExportModal';
import { getMedia, subscribeMedia } from '@/lib/videoStore';
import DebugHud from './DebugHud';
import PreviewCanvas from './PreviewCanvas';
import { packClips } from './packClips';
import {
  clampZoom, anchoredScrollLeft, zoomFactor, snapTime, snapEdges, stepTime,
  keyIsForEditor,
} from './timelineGestures';
import { buildSequence, Sequence, StyleLayer, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, Effects, Transform } from '@/lib/render/sequence';
import { analyseReference, analyseAudio, interestCurve } from '@/lib/ai/analyseReference';
import { decodeForAsr, chunkForAsr } from '@/lib/ai/audioForAsr';
import { saveTranscript, loadTranscript, StoredTranscript } from '@/lib/mediaDb';
import { StyleProfile, describeStyle } from '@/lib/ai/styleProfile';
import { generateEditPlan, EditPlan } from '@/lib/ai/styleTransfer';
import { detectSilences } from '@/lib/ai/operations';
import type { ClipSuggestion } from '@/lib/ai/clips';
import { parseClipRequest } from '@/lib/ai/clips';
import { scanVideo, compactScan, type VisualScan, type Keyframe } from '@/lib/ai/visualScan';
import { analyseFile } from '@/lib/videoStore';
import { getProjectMedia } from '@/lib/mediaCloud';
import { getProjectFrames } from '@/lib/thumbnailStore';
import {
  getProjectWaveform, setProjectWaveform, loadCachedWaveform, extractWaveform, resampleWaveform,
} from '@/lib/waveformStore';

/* ──────────────── STAGGER FADE-UP ──────────────── */
// Each zone fades in + rises 14px, staggered 120ms apart
function FadeUp({ delay, children, style }: {
  delay: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      animation: `editor-fade-up 480ms cubic-bezier(0.22,1,0.36,1) ${delay}ms both`,
      ...style,
    }}>
      {children}
    </div>
  );
}
import {
  Upload, Layout, Type, Wand2, Zap, Layers, SlidersHorizontal, AlignLeft as SubIcon,
  Plus, ChevronLeft, ChevronRight, Undo2, Redo2,
  SkipBack, Play, Pause, SkipForward, Maximize2, Minus,
  AlignLeft, AlignCenter, AlignRight,
  Bold, Italic, Underline, Scissors, MousePointer,
  ArrowLeft, Send, RotateCcw, ChevronDown, Film,
} from 'lucide-react';

/* ── App palette ── */
const C = {
  bg:      '#050505', surface: '#070707', s2: '#0a0a0a', s3: '#0e0e0e',
  b:       '#111111', b2:      '#141414', b3: '#1a1a1a',
  accent:  '#FAFAFA', accentH: '#D4D4D8',
  /* Text colour scale — spec §17 */
  text:    '#F5F7FA',   // primary
  sec:     '#A5ADBA',   // secondary
  muted:   '#737D8D',   // muted
  dim:     '#4D5664',   // disabled
  active:  '#FFFFFF',   // active / selected
  ph:      '#737D8D',   // placeholder = muted
};

/* ── Typography foundation ── */
const F = "'Inter',system-ui,-apple-system,sans-serif";

/*
 * ty — single source of truth for all editor type styles.
 * Weights: 400 body | 500 UI | 600 important | 700 headings only
 * Tracking: UI -0.01em | headings -0.025em | timeline -0.005em
 * Line-height: UI 1.2-1.3 | body 1.45-1.5 | timeline 1.1
 */
const ty = {
  /* ─ Toolbar ─ */
  proj:      { fontFamily: F, fontSize: 14, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2,  color: '#F5F7FA' },
  ctrl:      { fontFamily: F, fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',  lineHeight: 1.2,  color: '#A5ADBA' },

  /* ─ Icon-nav sidebar ─ */
  navCap:    { fontFamily: F, fontSize: 9,  fontWeight: 500, letterSpacing: '-0.005em', lineHeight: 1.2,  color: '#737D8D' },

  /* ─ Inspector / Properties panel ─ */
  panelHead: { fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2,  color: '#F5F7FA' },
  secLabel:  { fontFamily: F, fontSize: 10, fontWeight: 500, letterSpacing: '0.04em',   lineHeight: 1.2,
               textTransform: 'uppercase' as const, color: '#737D8D' },
  propLabel: { fontFamily: F, fontSize: 12, fontWeight: 500, letterSpacing: '-0.01em',  lineHeight: 1.25, color: '#A5ADBA' },
  propVal:   { fontFamily: F, fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',  lineHeight: 1.25, color: '#F5F7FA' },
  niLabel:   { fontFamily: F, fontSize: 10, fontWeight: 500, letterSpacing: '0em',      lineHeight: 1,    color: '#4D5664' },
  niVal:     { fontFamily: F, fontSize: 12, fontWeight: 500, letterSpacing: '-0.01em',  lineHeight: 1,    color: '#F5F7FA',
               fontVariantNumeric: 'tabular-nums' as const },

  /* ─ AI Assistant ─ */
  aiHead:    { fontFamily: F, fontSize: 14, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2,  color: '#F5F7FA' },
  aiMsg:     { fontFamily: F, fontSize: 13, fontWeight: 400, letterSpacing: '-0.01em',  lineHeight: 1.5,  color: '#A5ADBA' },
  userMsg:   { fontFamily: F, fontSize: 13, fontWeight: 400, letterSpacing: '-0.01em',  lineHeight: 1.5,  color: '#ffffff' },
  pill:      { fontFamily: F, fontSize: 12, fontWeight: 500, letterSpacing: '-0.01em',  lineHeight: 1.2,  color: '#737D8D' },
  aiInput:   { fontFamily: F, fontSize: 14, fontWeight: 400, letterSpacing: '-0.01em',  lineHeight: 1.5,  color: '#F5F7FA' },
  hint:      { fontFamily: F, fontSize: 10, fontWeight: 400, letterSpacing: '-0.005em', lineHeight: 1.2,  color: '#4D5664' },

  /* ─ Timeline ─ */
  clip:      { fontFamily: F, fontSize: 11, fontWeight: 500, letterSpacing: '-0.005em', lineHeight: 1.1,  color: '#F5F7FA' },
  trackLbl:  { fontFamily: F, fontSize: 11, fontWeight: 500, letterSpacing: '-0.005em', lineHeight: 1.1,  color: '#737D8D',
               whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  timecode:  { fontFamily: F, fontSize: 11, fontWeight: 500, letterSpacing: '-0.005em', lineHeight: 1.1,  color: '#A5ADBA',
               fontVariantNumeric: 'tabular-nums' as const },
  timeBig:   { fontFamily: F, fontSize: 12, fontWeight: 600, letterSpacing: '-0.005em', lineHeight: 1.1,  color: '#F5F7FA',
               fontVariantNumeric: 'tabular-nums' as const },
  tick:      { fontFamily: F, fontSize: 9,  fontWeight: 400, letterSpacing: '-0.005em', lineHeight: 1,    color: '#4D5664',
               fontVariantNumeric: 'tabular-nums' as const },
  meta:      { fontFamily: F, fontSize: 10, fontWeight: 400, letterSpacing: '-0.005em', lineHeight: 1.1,  color: '#4D5664' },

  /* ─ Video player ─ */
  playTime:  { fontFamily: F, fontSize: 11, fontWeight: 500, letterSpacing: '-0.005em', lineHeight: 1.1,  color: '#A5ADBA',
               fontVariantNumeric: 'tabular-nums' as const },

  /* ─ Buttons ─ */
  btnPrimary:{ fontFamily: F, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',  lineHeight: 1.2 },
  btnSec:    { fontFamily: F, fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',  lineHeight: 1.2 },

  /* ─ Badge ─ */
  badge:     { fontFamily: F, fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',   lineHeight: 1.2 },

  /* ─ Tooltip ─ */
  tip:       { fontFamily: F, fontSize: 11, fontWeight: 500, letterSpacing: '-0.01em',  lineHeight: 1.3,  color: '#F5F7FA' },

};

/* ── shared types (mirror db.ts — avoids importing server-only module) ── */
export interface EditorClip {
  id: string; trackId: string; label: string;
  startS: number; endS: number; type: 'video'|'audio'|'text'|'subtitle';
  /** Text clips: where in the frame the words sit, and how they look. */
  textPosition?: 'top'|'centre'|'lower';
  textAlign?: 'left'|'centre'|'right';
  textStyle?: import('@/lib/ai/operations').TextStyle;
}
export interface EditorAIMsg { role: 'user'|'ai'; text: string; ts: string; }

/* ── static constants ── */
const RULER_H   = 28;
const LABEL_W   = 88;

/* How far beyond the visible window the timeline still builds nodes. A full
   screen of slack either side means scrolling never shows a gap while the
   next batch renders. */
const PAD_PX  = 1200;
/* Decoration caps. A clip spanning the whole programme is wider than the
   screen; drawing a filmstrip tile or waveform bar for every 80px/1.5px of it
   costs hundreds of nodes nobody can see. */
const TILE_CAP = 60;
const BAR_CAP  = 400;

const WAVE = Array.from({ length: 400 }, (_, i) =>
  Math.abs(Math.sin(i * 0.28 + 0.9) * Math.cos(i * 0.11)) * 0.8 + 0.12
);
const THUMBS = [
  ['#0d1520','#1a2535'], ['#150d20','#251535'],
  ['#0d1a14','#122018'], ['#1a120d','#251808'],
];
const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(Math.floor(s % 60)).padStart(2,'0')}`;

/* ── track config — keyed by trackId ── */
const TRACK_META: Record<string,{label:string;icon:string;color:string;bg:string;h:number;thumb?:boolean;wave?:boolean}> = {
  text:  { label:'Text',  icon:'T', color:'#E4E4E7', bg:'#2d1b69', h:44 },
  video: { label:'Video', icon:'▣', color:'#2563EB', bg:'#0d1a2e', h:80, thumb:true },
  aud1:  { label:'Audio', icon:'♫', color:'#059669', bg:'#022c22', h:52, wave:true },
  aud2:  { label:'Audio', icon:'♫', color:'#059669', bg:'#022c22', h:52, wave:true },
  subs:  { label:'Subs',  icon:'≡', color:'#0891b2', bg:'#082f49', h:44 },
};
const TRACK_ORDER = ['text','video','aud1','aud2','subs'];

const DEFAULT_DURATION = 60;

/* A single video track covering the whole clip.
   Used until the server's analysis returns real clips, so the ruler, playhead,
   scrubbing and the frame strip all work from the moment the editor opens
   instead of being replaced by a spinner. */
function baseTracks(totalS: number, label: string) {
  return [{
    id: 'video',
    ...TRACK_META.video,
    clips: [{ s: 0, e: totalS, label }],
  }];
}

/* ── build track rows from real API clips — no fake fallback ── */
function buildTracks(clips: EditorClip[], totalS: number) {
  if (!clips || clips.length === 0) return []; // empty = caller substitutes baseTracks

  // Group clips by trackId
  const byTrack: Record<string, EditorClip[]> = {};
  for (const c of clips) {
    if (!byTrack[c.trackId]) byTrack[c.trackId] = [];
    byTrack[c.trackId].push(c);
  }

  // Respect canonical order; append unknown track IDs at end
  const ids = [...TRACK_ORDER.filter(id => byTrack[id]), ...Object.keys(byTrack).filter(id => !TRACK_ORDER.includes(id))];

  return ids.map(id => {
    const meta = TRACK_META[id] ?? { label: id, icon: '▣', color: '#FAFAFA', bg: '#0d1520', h: 46 };
    return {
      id,
      ...meta,
      clips: byTrack[id].map(c => ({ s: c.startS, e: c.endS, label: c.label })),
    };
  });
}

/* ──────────────── ICON NAV ──────────────── */
const ICON_NAV = [
  { icon: Upload,             label: 'Uploads'     },
  { icon: Layout,             label: 'Canvas'      },
  { icon: Type,               label: 'Text'        },
  { icon: Wand2,              label: 'Transitions' },
  { icon: Zap,                label: 'Effects'     },
  { icon: Layers,             label: 'Overlays'    },
  { icon: SlidersHorizontal,  label: 'Colour'      },
  { icon: SubIcon,            label: 'Subtitles'   },
];

function IconNavBase({ active, setActive }: { active:string; setActive:(s:string)=>void }) {
  return (
    <div style={{ width:64, flexShrink:0, background:C.surface, borderRight:`1px solid ${C.b}`,
      display:'flex', flexDirection:'column', alignItems:'center', paddingTop:10, gap:1, overflowY:'auto' }}>
      {/* Logo */}
      <div style={{ marginBottom:12, flexShrink:0 }}>
        <LogoMark size={28} />
      </div>
      {ICON_NAV.map(({ icon:Icon, label }) => {
        const on = active === label;
        return (
          <button key={label} onClick={()=>setActive(label)} title={label} style={{
            width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:3,
            padding:'8px 2px', border:'none', cursor:'pointer', transition:'all 100ms',
            background: on ? C.s3 : 'transparent',
            borderLeft: `2px solid ${on ? C.accent : 'transparent'}`,
          }}
            onMouseEnter={e=>{ if(!on) e.currentTarget.style.background=C.s2; }}
            onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent'; }}
          >
            <Icon size={16} color={on ? C.accent : C.muted} strokeWidth={1.6} />
            <span style={{ ...ty.navCap, color:on ? C.accent : ty.navCap.color }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────── PROPERTIES PANEL ──────────────── */
const IconNav = React.memo(IconNavBase);

function NI({ label, val }: { label:string; val:number }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:3, background:C.s3,
      border:`1px solid ${C.b2}`, borderRadius:5, padding:'4px 6px', flex:1, minWidth:0 }}>
      {label && <span style={{ ...ty.niLabel, flexShrink:0 }}>{label}</span>}
      <span style={{ ...ty.niVal, flex:1, textAlign:'right' as const }}>{val}</span>
    </div>
  );
}
const iB = (on?:boolean):React.CSSProperties => ({
  width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center',
  background: on ? C.s3:'transparent', border:`1px solid ${on ? C.b3:'transparent'}`,
  borderRadius:4, cursor:'pointer', color: on ? C.text:C.muted, transition:'all 100ms',
});

/* ── Panel sub-components ─────────────────────────── */

const TRANSITIONS = [
  { name:'Fade',      duration:'0.4s' },
  { name:'Dissolve',  duration:'0.6s' },
  { name:'Cut',       duration:'0s'   },
  { name:'Dip black', duration:'0.8s' },
  { name:'Dip white', duration:'0.8s' },
  { name:'Wipe →',    duration:'0.5s' },
  { name:'Wipe ←',    duration:'0.5s' },
  { name:'Wipe ↑',    duration:'0.5s' },
  { name:'Slide →',   duration:'0.5s' },
  { name:'Slide ←',   duration:'0.5s' },
  { name:'Push →',    duration:'0.4s' },
  { name:'Push ←',    duration:'0.4s' },
  { name:'Zoom in',   duration:'0.5s' },
  { name:'Zoom out',  duration:'0.5s' },
  { name:'Spin',      duration:'0.6s' },
  { name:'Flip H',    duration:'0.5s' },
];

const EFFECTS = [
  { name:'Blur',        tag:'Lens'    },
  { name:'Sharpen',     tag:'Detail'  },
  { name:'Glow',        tag:'Light'   },
  { name:'Vignette',    tag:'Frame'   },
  { name:'Noise',       tag:'Grain'   },
  { name:'Chromatic',   tag:'Aberr.'  },
  { name:'Glitch',      tag:'Distort' },
  { name:'Shake',       tag:'Motion'  },
  { name:'Zoom pulse',  tag:'Motion'  },
  { name:'Flicker',     tag:'Light'   },
  { name:'Old film',    tag:'Style'   },
  { name:'VHS',         tag:'Style'   },
];

const OVERLAYS = [
  { name:'Lower third',   icon:'⊟' },
  { name:'Title card',    icon:'⊡' },
  { name:'Call-out box',  icon:'◱' },
  { name:'Progress bar',  icon:'▬' },
  { name:'Countdown',     icon:'◎' },
  { name:'Emoji burst',   icon:'✦' },
  { name:'Kinetic text',  icon:'T̲' },
  { name:'Shape mask',    icon:'⬟' },
];

const COLOUR_LOOKS = [
  { name:'Neutral',   swatch:['#e8e2d9','#c4b8aa'] },
  { name:'Cool',      swatch:['#b8c8d8','#7090b0'] },
  { name:'Warm',      swatch:['#d8b890','#b07840'] },
  { name:'Cinematic', swatch:['#202030','#404060'] },
  { name:'Bleach',    swatch:['#f0ece8','#a8a098'] },
  { name:'Moody',     swatch:['#181820','#303048'] },
  { name:'Vibrant',   swatch:['#f040a0','#4080f0'] },
  { name:'Vintage',   swatch:['#c8a870','#806040'] },
];

const clipFmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Divider() {
  return <div style={{ height:1, background:C.b, margin:'8px 0' }} />;
}

function SectionLabel({ children }:{ children:React.ReactNode }) {
  return <p style={{ ...ty.secLabel, margin:'0 0 8px', display:'block' as const }}>{children}</p>;
}

/* ── Panel sub-components ─────────────────────────── */

function TransitionsPanel({
  clips = [],
  onUpdateClips,
  onPushHistory,
}: {
  clips?: EditorClip[];
  onUpdateClips?: (clips: EditorClip[]) => void;
  onPushHistory?: (clips: EditorClip[]) => void;
}) {
  const [sel, setSel] = React.useState('Fade');
  const [duration, setDuration] = React.useState(0.4);
  const [ease, setEase] = React.useState('Ease in-out');

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>
      <SectionLabel>Cut Transition</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:12 }}>
        {TRANSITIONS.map(t => (
          <button key={t.name} onClick={()=>setSel(t.name)} style={{
            padding:'7px 8px', borderRadius:7, border:`1px solid ${sel===t.name ? C.accent+'66' : C.b2}`,
            background: sel===t.name ? C.accent+'12' : C.s3,
            cursor:'pointer', textAlign:'left' as const, transition:'all 120ms',
          }}>
            <span style={{ ...ty.propVal, fontSize:12, display:'block',
              color: sel===t.name ? C.accent : C.text }}>{t.name}</span>
            <span style={{ ...ty.meta, display:'block', marginTop:1 }}>{t.duration}</span>
          </button>
        ))}
      </div>
      <Divider />
      <SectionLabel>Timing</SectionLabel>
      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
          <span style={{ ...ty.propLabel }}>Duration</span>
          <span style={{ ...ty.niVal }}>{duration.toFixed(1)}s</span>
        </div>
        <input
          type="range" min="0.1" max="2.0" step="0.1" value={duration}
          onChange={e => setDuration(Number(e.target.value))}
          style={{ width:'100%', accentColor: C.accent, cursor:'pointer' }}
        />
      </div>
      <Divider />
      <SectionLabel>Ease Curve</SectionLabel>
      {['Linear','Ease in','Ease out','Ease in-out'].map(e => (
        <button key={e} onClick={()=>setEase(e)} style={{
          display:'block', width:'100%', padding:'7px 9px', marginBottom:3,
          borderRadius:7, border:`1px solid ${ease===e ? C.accent+'66' : C.b2}`,
          background: ease===e ? C.accent+'12' : C.s3, cursor:'pointer',
          textAlign:'left' as const, ...ty.propLabel, color: ease===e ? C.text : C.sec,
        }}>
          {e}
        </button>
      ))}
      <div style={{ marginTop:14, padding:'8px 10px', background:C.s2, borderRadius:7, border:`1px solid ${C.b2}` }}>
        <span style={{ ...ty.meta, fontSize:11, color:C.muted, display:'block', lineHeight:1.4 }}>
          Active transition: <strong style={{ color:C.text }}>{sel}</strong> ({duration}s, {ease}). Modaya applies smooth cut blending across sequence boundaries.
        </span>
      </div>
    </div>
  );
}

const EFFECT_PRESETS: Record<string, Partial<Effects>> = {
  'Blur':        { blurPx: 5 },
  'Monochrome':  { saturation: 0, contrast: 1.25 },
  'Cinema Mood': { contrast: 1.3, saturation: 0.75, brightness: 0.9 },
  'Vivid Boost': { saturation: 1.45, brightness: 1.05, contrast: 1.15 },
  'Sepia Tone':  { saturation: 0.65, brightness: 0.95, contrast: 1.1 },
  'Night Tone':  { brightness: 0.72, contrast: 1.2, saturation: 0.85 },
  'Soft Focus':  { blurPx: 2, brightness: 1.05, contrast: 0.95 },
  'Sharpen':     { contrast: 1.25, brightness: 1.02 },
};

function EffectsPanel({
  clips = [],
  styleLayer = {},
  onUpdateStyleLayer,
}: {
  clips?: EditorClip[];
  styleLayer?: StyleLayer;
  onUpdateStyleLayer?: (layer: StyleLayer) => void;
}) {
  const [activeEffect, setActiveEffect] = React.useState<string | null>(null);
  const [intensity, setIntensity] = React.useState(75);

  const applyEffectToLayer = (effectName: string | null, intVal: number) => {
    setActiveEffect(effectName);
    if (!onUpdateStyleLayer) return;

    const baseFx = effectName ? EFFECT_PRESETS[effectName] || {} : {};
    const intMult = intVal / 100;
    const targetFx: Partial<Effects> = {
      brightness: baseFx.brightness !== undefined ? 1 + (baseFx.brightness - 1) * intMult : 1,
      contrast:   baseFx.contrast !== undefined ? 1 + (baseFx.contrast - 1) * intMult : 1,
      saturation: baseFx.saturation !== undefined ? 1 + (baseFx.saturation - 1) * intMult : 1,
      blurPx:     baseFx.blurPx !== undefined ? baseFx.blurPx * intMult : 0,
      opacity:    1,
    };

    const nextLayer: StyleLayer = { ...styleLayer };
    const targetClips = clips.length ? clips.filter(c => c.type === 'video' || c.trackId === 'video') : [{ id: 'base' }];
    for (const c of targetClips) {
      nextLayer[c.id] = {
        ...(nextLayer[c.id] ?? {}),
        effects: {
          ...(nextLayer[c.id]?.effects ?? DEFAULT_EFFECTS),
          ...targetFx,
        },
      };
    }
    onUpdateStyleLayer(nextLayer);
  };

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>
      <SectionLabel>Visual Effects</SectionLabel>
      <div style={{ display:'flex', flexDirection:'column', gap:3, marginBottom:12 }}>
        {EFFECTS.map(ef => {
          const isSelected = activeEffect === ef.name;
          return (
            <button key={ef.name} onClick={() => applyEffectToLayer(isSelected ? null : ef.name, intensity)} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'8px 10px', borderRadius:7,
              border:`1px solid ${isSelected ? C.accent+'66' : C.b2}`,
              background: isSelected ? C.accent+'14' : C.s3,
              cursor:'pointer', transition:'all 120ms',
            }}>
              <span style={{ ...ty.propVal, fontSize:12, color: isSelected ? C.accent : C.text }}>{ef.name}</span>
              <span style={{ ...ty.badge, color: isSelected ? C.accent : C.muted, letterSpacing:'0.02em', background:C.b2,
                padding:'2px 6px', borderRadius:4 }}>{ef.tag}</span>
            </button>
          );
        })}
      </div>
      {activeEffect && (
        <>
          <Divider />
          <SectionLabel>Intensity: {intensity}%</SectionLabel>
          <div style={{ marginBottom:12 }}>
            <input
              type="range" min="10" max="100" step="5" value={intensity}
              onChange={e => {
                const val = Number(e.target.value);
                setIntensity(val);
                applyEffectToLayer(activeEffect, val);
              }}
              style={{ width:'100%', accentColor: C.accent, cursor:'pointer' }}
            />
          </div>
          <button
            onClick={() => applyEffectToLayer(null, 100)}
            style={{ width:'100%', padding:'6px', background:C.s3, border:`1px solid ${C.b2}`, borderRadius:6, color:C.sec, fontSize:11, cursor:'pointer' }}
          >
            Clear effect
          </button>
        </>
      )}
    </div>
  );
}

const LOOK_PRESETS: Record<string, { brightness: number; contrast: number; saturation: number; blurPx: number }> = {
  'Neutral':   { brightness: 1.0,  contrast: 1.0,  saturation: 1.0,  blurPx: 0 },
  'Cool':      { brightness: 0.98, contrast: 1.05, saturation: 0.88, blurPx: 0 },
  'Warm':      { brightness: 1.04, contrast: 1.08, saturation: 1.18, blurPx: 0 },
  'Cinematic': { brightness: 0.92, contrast: 1.22, saturation: 0.85, blurPx: 0 },
  'Bleach':    { brightness: 1.10, contrast: 1.30, saturation: 0.45, blurPx: 0 },
  'Moody':     { brightness: 0.88, contrast: 1.25, saturation: 0.75, blurPx: 0 },
  'Vibrant':   { brightness: 1.05, contrast: 1.15, saturation: 1.40, blurPx: 0 },
  'Vintage':   { brightness: 0.96, contrast: 0.95, saturation: 0.78, blurPx: 0 },
};

function ColourPanel({
  clips = [],
  styleLayer = {},
  onUpdateStyleLayer,
}: {
  clips?: EditorClip[];
  styleLayer?: StyleLayer;
  onUpdateStyleLayer?: (layer: StyleLayer) => void;
}) {
  const [look, setLook] = React.useState('Neutral');
  const [adj, setAdj] = React.useState({ brightness: 1.0, contrast: 1.0, saturation: 1.0, blurPx: 0 });

  const applyGrade = (newLook: string, newAdj: typeof adj) => {
    setLook(newLook);
    setAdj(newAdj);
    if (!onUpdateStyleLayer) return;

    const nextLayer: StyleLayer = { ...styleLayer };
    const targetClips = clips.length ? clips.filter(c => c.type === 'video' || c.trackId === 'video') : [{ id: 'base' }];
    for (const c of targetClips) {
      nextLayer[c.id] = {
        ...(nextLayer[c.id] ?? {}),
        effects: {
          ...(nextLayer[c.id]?.effects ?? DEFAULT_EFFECTS),
          brightness: newAdj.brightness,
          contrast:   newAdj.contrast,
          saturation: newAdj.saturation,
          blurPx:     newAdj.blurPx,
        },
      };
    }
    onUpdateStyleLayer(nextLayer);
  };

  const handleSelectLook = (lookName: string) => {
    const preset = LOOK_PRESETS[lookName] ?? LOOK_PRESETS['Neutral'];
    applyGrade(lookName, preset);
  };

  const updateAdj = (key: keyof typeof adj, val: number) => {
    const next = { ...adj, [key]: val };
    applyGrade('Custom', next);
  };

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>
      <SectionLabel>Colour Look</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:12 }}>
        {COLOUR_LOOKS.map(l => (
          <button key={l.name} onClick={()=>handleSelectLook(l.name)} style={{
            padding:'8px', borderRadius:7, border:`1px solid ${look===l.name ? C.accent+'66' : C.b2}`,
            background: look===l.name ? C.accent+'12' : C.s3, cursor:'pointer', transition:'all 120ms', textAlign:'left' as const,
          }}>
            <div style={{ display:'flex', gap:3, marginBottom:5 }}>
              {l.swatch.map((c,i) => <div key={i} style={{ width:14, height:14, borderRadius:3, background:c }} />)}
            </div>
            <span style={{ ...ty.propVal, fontSize:11, color: look===l.name ? C.accent : C.sec }}>{l.name}</span>
          </button>
        ))}
      </div>
      <Divider />
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <SectionLabel>Adjustments</SectionLabel>
        <button
          onClick={() => handleSelectLook('Neutral')}
          style={{ background:'none', border:'none', color:C.muted, fontSize:10, cursor:'pointer', padding:0 }}
        >
          Reset
        </button>
      </div>

      <div style={{ marginBottom:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ ...ty.propLabel }}>Exposure</span>
          <span style={{ ...ty.niVal }}>{adj.brightness.toFixed(2)}x</span>
        </div>
        <input
          type="range" min="0.5" max="1.5" step="0.02" value={adj.brightness}
          onChange={e => updateAdj('brightness', Number(e.target.value))}
          style={{ width:'100%', accentColor: C.accent, cursor:'pointer' }}
        />
      </div>

      <div style={{ marginBottom:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ ...ty.propLabel }}>Contrast</span>
          <span style={{ ...ty.niVal }}>{adj.contrast.toFixed(2)}x</span>
        </div>
        <input
          type="range" min="0.5" max="1.5" step="0.02" value={adj.contrast}
          onChange={e => updateAdj('contrast', Number(e.target.value))}
          style={{ width:'100%', accentColor: C.accent, cursor:'pointer' }}
        />
      </div>

      <div style={{ marginBottom:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ ...ty.propLabel }}>Saturation</span>
          <span style={{ ...ty.niVal }}>{adj.saturation.toFixed(2)}x</span>
        </div>
        <input
          type="range" min="0.0" max="2.0" step="0.05" value={adj.saturation}
          onChange={e => updateAdj('saturation', Number(e.target.value))}
          style={{ width:'100%', accentColor: C.accent, cursor:'pointer' }}
        />
      </div>

      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ ...ty.propLabel }}>Soft Blur</span>
          <span style={{ ...ty.niVal }}>{adj.blurPx.toFixed(1)}px</span>
        </div>
        <input
          type="range" min="0.0" max="10.0" step="0.5" value={adj.blurPx}
          onChange={e => updateAdj('blurPx', Number(e.target.value))}
          style={{ width:'100%', accentColor: C.accent, cursor:'pointer' }}
        />
      </div>
    </div>
  );
}

const OVERLAY_TEMPLATES = [
  { name:'Lower third',    icon:'⊟', text:'Speaker Name · Modaya Studio', font:'sans' as const, size:'small' as const, pos:'lower' as const, align:'left' as const, bg:'box' as const },
  { name:'Title card',     icon:'⊡', text:'Headline Title',              font:'display' as const, size:'large' as const, pos:'centre' as const, align:'centre' as const, bg:'box' as const },
  { name:'Call to action', icon:'⭐', text:'Subscribe for more',         font:'sans' as const, size:'medium' as const, pos:'lower' as const, align:'centre' as const, bg:'box' as const },
  { name:'Quote highlight', icon:'💬', text:'“Design is how it works.”', font:'handwritten' as const, size:'medium' as const, pos:'centre' as const, align:'centre' as const, bg:'shadow' as const },
  { name:'Chapter stamp',  icon:'⏱️', text:'Chapter 1 — Introduction',   font:'mono' as const, size:'small' as const, pos:'top' as const, align:'left' as const, bg:'box' as const },
  { name:'Stat callout',   icon:'🚀', text:'100% Deterministic Engine',   font:'display' as const, size:'large' as const, pos:'centre' as const, align:'centre' as const, bg:'box' as const },
];

function OverlaysPanel({
  clips = [],
  onUpdateClips,
  playheadS = 0,
  totalS = 60,
  onPushHistory,
  onSetTab,
}: {
  clips?: EditorClip[];
  onUpdateClips?: (clips: EditorClip[]) => void;
  playheadS?: number;
  totalS?: number;
  onPushHistory?: (clips: EditorClip[]) => void;
  onSetTab?: (tab: string) => void;
}) {
  const addOverlayClip = (tmpl: typeof OVERLAY_TEMPLATES[number]) => {
    if (!onUpdateClips) return;
    const startS = Number(Math.max(0, playheadS).toFixed(2));
    const endS   = Number(Math.min(totalS, startS + 4.0).toFixed(2));
    const newClip: EditorClip = {
      id: `text-${Date.now()}`,
      trackId: 'text',
      label: tmpl.text,
      startS,
      endS: Math.max(startS + 0.5, endS),
      type: 'text',
      textPosition: tmpl.pos,
      textAlign: tmpl.align,
      textStyle: {
        font: tmpl.font,
        size: tmpl.size,
        background: tmpl.bg,
        bold: true,
        colour: '#FFFFFF',
      },
    };
    onPushHistory?.(clips);
    onUpdateClips([...clips, newClip]);
    onSetTab?.('Text');
  };

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>
      <SectionLabel>Add Text & Graphic Overlays</SectionLabel>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {OVERLAY_TEMPLATES.map(o => (
          <button key={o.name} onClick={() => addOverlayClip(o)} style={{
            display:'flex', alignItems:'center', gap:10, padding:'9px 10px', borderRadius:7,
            border:`1px solid ${C.b2}`, background:C.s3, cursor:'pointer', transition:'all 120ms',
            textAlign:'left' as const,
          }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.b3; e.currentTarget.style.background=C.s2; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.b2; e.currentTarget.style.background=C.s3; }}
          >
            <span style={{ fontSize:14, color:C.muted, width:18, textAlign:'center' as const, flexShrink:0 }}>{o.icon}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{ ...ty.propVal, fontSize:12, display:'block' }}>{o.name}</span>
              <span style={{ ...ty.meta, fontSize:10, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>{o.text}</span>
            </div>
            <Plus size={11} color={C.dim} style={{ marginLeft:'auto', flexShrink:0 }} />
          </button>
        ))}
      </div>
      <p style={{ ...ty.hint, fontSize:11, color:C.muted, marginTop:12, lineHeight:1.4 }}>
        Click any preset to add a styled overlay at the current playhead position ({clipFmt(playheadS)}).
      </p>
    </div>
  );
}

function TextInspectorPanel({
  clips = [],
  onUpdateClips,
  playheadS = 0,
  totalS = 60,
  onPushHistory,
}: {
  clips?: EditorClip[];
  onUpdateClips?: (clips: EditorClip[]) => void;
  playheadS?: number;
  totalS?: number;
  onPushHistory?: (clips: EditorClip[]) => void;
}) {
  const textClips = clips.filter(c => c.type === 'text' || c.type === 'subtitle' || c.trackId === 'text' || c.trackId === 'subs');
  const activeClip = textClips.find(c => playheadS >= c.startS && playheadS <= c.endS) ?? textClips[0] ?? null;

  const [textVal, setTextVal] = React.useState(activeClip?.label ?? 'Modaya Studio');
  const [font, setFont] = React.useState(activeClip?.textStyle?.font ?? 'display');
  const [size, setSize] = React.useState(activeClip?.textStyle?.size ?? 'medium');
  const [position, setPosition] = React.useState<'top'|'centre'|'lower'>(activeClip?.textPosition ?? 'centre');
  const [align, setAlign] = React.useState<'left'|'centre'|'right'>(activeClip?.textAlign ?? 'centre');
  const [bold, setBold] = React.useState(activeClip?.textStyle?.bold ?? true);
  const [italic, setItalic] = React.useState(activeClip?.textStyle?.italic ?? false);
  const [uppercase, setUppercase] = React.useState(activeClip?.textStyle?.uppercase ?? false);
  const [bgStyle, setBgStyle] = React.useState<'box'|'shadow'|'none'>(activeClip?.textStyle?.background ?? 'box');
  const [color, setColor] = React.useState(activeClip?.textStyle?.colour ?? '#FFFFFF');

  React.useEffect(() => {
    if (activeClip) {
      setTextVal(activeClip.label);
      if (activeClip.textPosition) setPosition(activeClip.textPosition);
      if (activeClip.textAlign) setAlign(activeClip.textAlign);
      if (activeClip.textStyle?.font) setFont(activeClip.textStyle.font);
      if (activeClip.textStyle?.size) setSize(activeClip.textStyle.size);
      if (activeClip.textStyle?.bold !== undefined) setBold(activeClip.textStyle.bold);
      if (activeClip.textStyle?.italic !== undefined) setItalic(activeClip.textStyle.italic);
      if (activeClip.textStyle?.uppercase !== undefined) setUppercase(activeClip.textStyle.uppercase);
      if (activeClip.textStyle?.background) setBgStyle(activeClip.textStyle.background);
      if (activeClip.textStyle?.colour) setColor(activeClip.textStyle.colour);
    }
  }, [activeClip?.id]);

  const updateActiveClip = (patch: Partial<EditorClip> & { textStyle?: Partial<NonNullable<EditorClip['textStyle']>> }) => {
    if (!activeClip || !onUpdateClips) return;
    const updatedClips = clips.map(c => {
      if (c.id !== activeClip.id) return c;
      const mergedStyle = {
        ...(c.textStyle ?? {}),
        ...(patch.textStyle ?? {}),
      };
      return {
        ...c,
        ...patch,
        textStyle: mergedStyle,
      };
    });
    onUpdateClips(updatedClips);
  };

  const handleAddText = () => {
    if (!onUpdateClips) return;
    const startS = Number(Math.max(0, playheadS).toFixed(2));
    const endS = Number(Math.min(totalS, startS + 4.0).toFixed(2));
    const newClip: EditorClip = {
      id: `text-${Date.now()}`,
      trackId: 'text',
      label: textVal || 'New Caption',
      startS,
      endS: Math.max(startS + 0.5, endS),
      type: 'text',
      textPosition: position,
      textAlign: align,
      textStyle: {
        font,
        size,
        bold,
        italic,
        uppercase,
        background: bgStyle,
        colour: color,
      },
    };
    onPushHistory?.(clips);
    onUpdateClips([...clips, newClip]);
  };

  const handleDeleteActive = () => {
    if (!activeClip || !onUpdateClips) return;
    onPushHistory?.(clips);
    onUpdateClips(clips.filter(c => c.id !== activeClip.id));
  };

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'10px 12px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <SectionLabel>{activeClip ? 'Edit Text Overlay' : 'Add Text Overlay'}</SectionLabel>
        {activeClip && (
          <button
            onClick={handleDeleteActive}
            style={{ background:'none', border:'none', color:'#EF4444', fontSize:10, cursor:'pointer', padding:0 }}
          >
            Delete
          </button>
        )}
      </div>

      {/* Text Area */}
      <textarea
        value={textVal}
        onChange={e => {
          const v = e.target.value;
          setTextVal(v);
          if (activeClip) updateActiveClip({ label: v });
        }}
        rows={2}
        placeholder="Enter overlay text…"
        style={{ width:'100%', background:C.s3, border:`1px solid ${C.b2}`, borderRadius:6, padding:'7px 9px',
          fontSize:12, color:C.text, fontFamily:F, resize:'none', outline:'none', boxSizing:'border-box' as const, marginBottom:8 }}
      />

      {/* Alignment */}
      <SectionLabel>Alignment & Placement</SectionLabel>
      <div style={{ display:'flex', gap:4, marginBottom:8 }}>
        {(['left', 'centre', 'right'] as const).map(a => (
          <button
            key={a}
            onClick={() => {
              setAlign(a);
              if (activeClip) updateActiveClip({ textAlign: a });
            }}
            style={{
              flex:1, padding:'5px', borderRadius:5, border:`1px solid ${align===a ? C.accent+'66' : C.b2}`,
              background: align===a ? C.accent+'14' : C.s3, color: align===a ? C.text : C.muted,
              fontSize:11, cursor:'pointer', textTransform:'capitalize' as const,
            }}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Vertical Position */}
      <div style={{ display:'flex', gap:4, marginBottom:10 }}>
        {(['top', 'centre', 'lower'] as const).map(p => (
          <button
            key={p}
            onClick={() => {
              setPosition(p);
              if (activeClip) updateActiveClip({ textPosition: p });
            }}
            style={{
              flex:1, padding:'5px', borderRadius:5, border:`1px solid ${position===p ? C.accent+'66' : C.b2}`,
              background: position===p ? C.accent+'14' : C.s3, color: position===p ? C.text : C.muted,
              fontSize:11, cursor:'pointer', textTransform:'capitalize' as const,
            }}
          >
            {p === 'lower' ? 'Bottom' : p}
          </button>
        ))}
      </div>

      <Divider />

      {/* Font & Size */}
      <SectionLabel>Typography</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, marginBottom:8 }}>
        {[
          { label:'Satoshi', id:'display' as const },
          { label:'Inter',   id:'sans' as const },
          { label:'Mono',    id:'mono' as const },
          { label:'Script',  id:'handwritten' as const },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => {
              setFont(f.id);
              if (activeClip) updateActiveClip({ textStyle: { font: f.id } });
            }}
            style={{
              padding:'6px 8px', borderRadius:5, border:`1px solid ${font===f.id ? C.accent+'66' : C.b2}`,
              background: font===f.id ? C.accent+'14' : C.s3, color: font===f.id ? C.text : C.sec,
              fontSize:11, cursor:'pointer', textAlign:'left' as const,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Size buttons */}
      <div style={{ display:'flex', gap:4, marginBottom:8 }}>
        {(['small', 'medium', 'large'] as const).map(s => (
          <button
            key={s}
            onClick={() => {
              setSize(s);
              if (activeClip) updateActiveClip({ textStyle: { size: s } });
            }}
            style={{
              flex:1, padding:'4px', borderRadius:5, border:`1px solid ${size===s ? C.accent+'66' : C.b2}`,
              background: size===s ? C.accent+'14' : C.s3, color: size===s ? C.text : C.muted,
              fontSize:11, cursor:'pointer', textTransform:'capitalize' as const,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Bold / Italic / Uppercase */}
      <div style={{ display:'flex', gap:4, marginBottom:10 }}>
        <button
          onClick={() => {
            const next = !bold;
            setBold(next);
            if (activeClip) updateActiveClip({ textStyle: { bold: next } });
          }}
          style={iB(bold)}
          title="Bold"
        >
          <Bold size={11} />
        </button>
        <button
          onClick={() => {
            const next = !italic;
            setItalic(next);
            if (activeClip) updateActiveClip({ textStyle: { italic: next } });
          }}
          style={iB(italic)}
          title="Italic"
        >
          <Italic size={11} />
        </button>
        <button
          onClick={() => {
            const next = !uppercase;
            setUppercase(next);
            if (activeClip) updateActiveClip({ textStyle: { uppercase: next } });
          }}
          style={iB(uppercase)}
          title="Uppercase (AA)"
        >
          <span style={{ fontSize:10, fontWeight:700 }}>AA</span>
        </button>
      </div>

      <Divider />

      {/* Background container style */}
      <SectionLabel>Background & Colour</SectionLabel>
      <div style={{ display:'flex', gap:4, marginBottom:8 }}>
        {(['box', 'shadow', 'none'] as const).map(bg => (
          <button
            key={bg}
            onClick={() => {
              setBgStyle(bg);
              if (activeClip) updateActiveClip({ textStyle: { background: bg } });
            }}
            style={{
              flex:1, padding:'4px', borderRadius:5, border:`1px solid ${bgStyle===bg ? C.accent+'66' : C.b2}`,
              background: bgStyle===bg ? C.accent+'14' : C.s3, color: bgStyle===bg ? C.text : C.muted,
              fontSize:11, cursor:'pointer', textTransform:'capitalize' as const,
            }}
          >
            {bg === 'box' ? 'Box fill' : bg === 'shadow' ? 'Shadow' : 'None'}
          </button>
        ))}
      </div>

      {/* Colour swatches */}
      <div style={{ display:'flex', gap:6, marginBottom:12 }}>
        {['#FFFFFF', '#FACC15', '#38BDF8', '#FB7185', '#4ADE80', '#18181B'].map(hex => (
          <div
            key={hex}
            role="button"
            tabIndex={0}
            onClick={() => {
              setColor(hex);
              if (activeClip) updateActiveClip({ textStyle: { colour: hex } });
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                setColor(hex);
                if (activeClip) updateActiveClip({ textStyle: { colour: hex } });
              }
            }}
            style={{
              width:20, height:20, borderRadius:'50%', background:hex,
              border:`2px solid ${color===hex ? C.accent : C.b3}`, cursor:'pointer',
            }}
          />
        ))}
      </div>

      <button
        onClick={handleAddText}
        style={{
          width:'100%', padding:'8px', background:C.accent, color:'#000', border:'none',
          borderRadius:7, fontWeight:600, fontSize:12, cursor:'pointer', display:'flex',
          alignItems:'center', justifyContent:'center', gap:5,
        }}
      >
        <Plus size={13} /> Add text at playhead
      </button>
    </div>
  );
}

function UploadsPanel({
  mediaEntry,
  projectName,
  totalS = 0,
}: {
  mediaEntry?: ReturnType<typeof getMedia> | null;
  projectName?: string;
  totalS?: number;
}) {
  const filename = mediaEntry?.filename || `${projectName || 'Video'}.mp4`;
  const dur = fmt(totalS || mediaEntry?.durationS || 0);
  const dims = mediaEntry?.width && mediaEntry?.height ? `${mediaEntry.width}×${mediaEntry.height}` : '1920×1080';
  const ar = mediaEntry?.aspectRatio || '16:9';

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>
      <SectionLabel>Project Footage</SectionLabel>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px',
          borderRadius:7, border:`1px solid ${C.b2}`, background:C.s3 }}>
          <div style={{ width:28, height:28, borderRadius:5, background:C.b3, display:'flex',
            alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span style={{ fontSize:9, color:C.muted, fontWeight:600, fontFamily:F, letterSpacing:'0.02em' }}>MP4</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ ...ty.propVal, fontSize:11, display:'block',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{filename}</span>
            <span style={{ ...ty.meta, display:'block', marginTop:1 }}>{dur} · {dims} ({ar})</span>
          </div>
        </div>
      </div>
      <Divider />
      <div style={{ padding:'8px 10px', background:C.s2, borderRadius:7, border:`1px solid ${C.b2}` }}>
        <span style={{ ...ty.meta, fontSize:11, color:C.muted, display:'block', lineHeight:1.4 }}>
          Status: <strong style={{ color:'#34D399' }}>Cached & Ready</strong>. Source footage lives in your browser’s local store and streams to the canvas renderer.
        </span>
      </div>
      <p style={{ ...ty.hint, textAlign:'center' as const, margin:'12px 0 0' }}>
        Add more media or reference videos from Studio
      </p>
    </div>
  );
}

interface PropertiesPanelProps {
  tab: string;
  clips?: EditorClip[];
  onUpdateClips?: (clips: EditorClip[]) => void;
  styleLayer?: StyleLayer;
  onUpdateStyleLayer?: (layer: StyleLayer) => void;
  playheadS?: number;
  totalS?: number;
  mediaEntry?: ReturnType<typeof getMedia> | null;
  projectName?: string;
  onSeek?: (s: number) => void;
  onPushHistory?: (clips: EditorClip[]) => void;
  onSetTab?: (tab: string) => void;
}

function PropertiesPanelBase({
  tab,
  clips = [],
  onUpdateClips,
  styleLayer = {},
  onUpdateStyleLayer,
  playheadS = 0,
  totalS = 60,
  mediaEntry = null,
  projectName = 'Project',
  onPushHistory,
  onSetTab,
}: PropertiesPanelProps) {
  const renderBody = () => {
    if (tab === 'Transitions') return <TransitionsPanel clips={clips} onUpdateClips={onUpdateClips} onPushHistory={onPushHistory} />;
    if (tab === 'Effects')     return <EffectsPanel clips={clips} styleLayer={styleLayer} onUpdateStyleLayer={onUpdateStyleLayer} />;
    if (tab === 'Overlays')    return <OverlaysPanel clips={clips} onUpdateClips={onUpdateClips} playheadS={playheadS} totalS={totalS} onPushHistory={onPushHistory} onSetTab={onSetTab} />;
    if (tab === 'Colour')      return <ColourPanel clips={clips} styleLayer={styleLayer} onUpdateStyleLayer={onUpdateStyleLayer} />;
    if (tab === 'Uploads')     return <UploadsPanel mediaEntry={mediaEntry} projectName={projectName} totalS={totalS} />;
    // Text / Canvas / Subtitles
    return <TextInspectorPanel clips={clips} onUpdateClips={onUpdateClips} playheadS={playheadS} totalS={totalS} onPushHistory={onPushHistory} />;
  };

  return (
    <div style={{ width:'clamp(180px,15vw,280px)', flexShrink:0, background:C.surface, borderRight:`1px solid ${C.b}`,
      display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Header */}
      <div style={{ height:42, borderBottom:`1px solid ${C.b}`, display:'flex', alignItems:'center',
        justifyContent:'space-between', padding:'0 12px', flexShrink:0 }}>
        <span style={{ ...ty.panelHead }}>{tab}</span>
        <button style={{ background:'none', border:'none', cursor:'pointer', color:C.muted, display:'flex' }}>
          <ChevronLeft size={14} />
        </button>
      </div>
      {/* Body — delegates to sub-panel */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {renderBody()}
      </div>
    </div>
  );
}

const PropertiesPanel = React.memo(PropertiesPanelBase);

/* ──────────────── AI CHAT ──────────────── */

const QUICK = [
  { label: 'Cut silences',   prompt: 'Remove all pauses and dead air.'           },
  { label: 'Find clips',     prompt: 'Find me 5 short clips for TikTok and Reels.', highlight: true },
  { label: 'Clean fillers',  prompt: 'Remove filler words and repeated phrases.' },
  { label: 'Best moments',   prompt: 'Find the strongest 90 seconds.'            },
  { label: 'Add captions',   prompt: 'Transcribe and add accurate captions.'     },
];

interface Msg {
  role:     'user' | 'ai';
  text:     string;
  summary?: string;          // edit chip shown under AI reply
  savedS?:  number;
  undoable?: boolean;
  /** A learned reference style the user can apply. */
  style?:   StyleProfile;
  /** Clipping engine results — standalone short clips, each cuttable in one tap. */
  clips?:   ClipSuggestion[];
}

function ClipCard({ clip, onCut }: { clip: ClipSuggestion; onCut: () => void }) {
  const scoreColor = clip.score >= 80 ? '#34D399' : clip.score >= 55 ? '#FBBF24' : '#737D8D';
  const isAi = clip.source !== 'measurement';
  return (
    <div style={{
      background: C.s2, border: `1px solid ${C.b3}`, borderRadius: 10, padding: '9px 11px',
      animation: 'msg-in 260ms cubic-bezier(0.22,1,0.36,1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{ ...ty.badge, color: C.accent, background: `${C.accent}18`,
          border: `1px solid ${C.accent}33`, borderRadius: 5, padding: '1px 6px' }}>
          {clipFmt(clip.startS)}–{clipFmt(clip.endS)}
        </span>
        <span style={{ flex: 1, ...ty.meta, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: scoreColor }} />
          {clip.score}
        </span>
        <span style={{ ...ty.meta, color: isAi ? C.accent : C.dim }}>
          {isAi ? 'AI pick' : 'measured'}
        </span>
      </div>
      <p style={{ ...ty.aiMsg, fontSize: 12.5, color: C.text, fontWeight: 600, margin: '0 0 3px',
        lineHeight: 1.35 }}>{clip.title}</p>
      {clip.reason && (
        <p style={{ ...ty.meta, color: C.muted, margin: '0 0 8px', lineHeight: 1.4 }}>{clip.reason}</p>
      )}
      {clip.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {clip.tags.map(t => (
            <span key={t} style={{ ...ty.meta, color: C.sec, background: C.s3,
              border: `1px solid ${C.b2}`, borderRadius: 9999, padding: '1px 7px' }}>#{t}</span>
          ))}
        </div>
      )}
      <button onClick={onCut}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%', padding: '6px', background: C.accent, border: 'none', borderRadius: 7,
          fontFamily: F, fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer',
          transition: 'background 120ms' }}
        onMouseEnter={e => { e.currentTarget.style.background = C.accentH; }}
        onMouseLeave={e => { e.currentTarget.style.background = C.accent; }}>
        <Scissors size={11} /> Cut to this clip
      </button>
    </div>
  );
}

interface AIChatPanelProps {
  projectId:      string;
  initialHistory?: EditorAIMsg[];
  totalS:         number;
  onEditApplied?: (affectedIds: string[], newClips: EditorClip[]) => void;
  onStyleApplied?: (plan: EditPlan) => void;
  /** Isolate a suggested clip on the timeline (keep only that range). */
  onCutToClip?:   (clip: ClipSuggestion) => void;
}

function AIChatPanelBase({ projectId, initialHistory, totalS, onEditApplied, onStyleApplied, onCutToClip }: AIChatPanelProps) {
  const [msgs,    setMsgs   ] = useState<Msg[]>(() => {
    if (initialHistory && initialHistory.length > 0) {
      return initialHistory.map(m => ({ role: m.role, text: m.text }));
    }
    const mins = Math.floor(totalS / 60);
    return [{ role: 'ai', text: `I've analysed your footage — ${mins} min total. Ready to edit. What would you like me to do?` }];
  });
  const [input,   setInput  ] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Msg[][]>([]);   // undo stack
  const bot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bot.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading]);

  /* ── Reference video: learn a style, then replicate it ── */
  const refInput = useRef<HTMLInputElement>(null);
  const [refBusy, setRefBusy] = useState(false);
  const [learnedStyle, setLearnedStyle] = useState<string | null>(null);

  /* Measure the project's own audio once so "cut the pauses" can act on real
     silence rather than a guess. Runs in the background; never blocks typing. */
  const silences = useRef<[number, number][]>([]);
  const energy   = useRef<number[]>([]);
  /* The same idea for the picture: shot changes, movement and brightness,
     measured once from the pixels, plus a few frames kept back for a model
     that can actually look at them. */
  const visual    = useRef<VisualScan | null>(null);
  const keyframes = useRef<Keyframe[]>([]);
  /** 'pending' while the decode runs, so the AI can say so instead of guessing. */
  const audioState = useRef<'pending' | 'ready' | 'failed'>('pending');
  const [asr, setAsr] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  /**
   * Whether a key-free provider can actually answer. Discovered once; gates
   * auto-transcription for clipping so a user with no key gets measured clips
   * straight away instead of a doomed Whisper call (speech recognition needs
   * a Groq key; the measurement engine does not).
   */
  const aiReady = useRef<boolean | null>(null);
  /**
   * The transcript lives in the browser and travels with every AI request.
   * The server keeps a copy, but on a serverless host the next request can
   * land on an instance that has never seen it — so the browser is the source
   * of truth.
   */
  const transcript = useRef<StoredTranscript | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/ai')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) aiReady.current = !!d?.configured; })
      .catch(() => { if (!cancelled) aiReady.current = false; });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadTranscript(projectId).then(t => {
      if (!cancelled && t?.segments?.length) { transcript.current = t; setAsr('done'); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);
  const asrTried = useRef(false);
  useEffect(() => {
    let cancelled = false;
    audioState.current = 'pending';
    (async () => {
      try {
        const stored = await getProjectMedia(projectId);
        if (!stored || cancelled) { audioState.current = 'failed'; return; }
        const env = await analyseAudio(stored.blob);
        if (cancelled) return;
        if (!env) { audioState.current = 'failed'; return; }
        silences.current = detectSilences(env.rms, env.hopS);
        energy.current   = interestCurve(env, stored.durationS || totalS);
        audioState.current = 'ready';
      } catch {
        // no audio track, an undecodable codec, or a file too large to decode
        if (!cancelled) audioState.current = 'failed';
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  /* Watch the video once, in the background. Never blocks the editor: the
     scan is abandoned the moment the project changes. */
  useEffect(() => {
    const stop = new AbortController();
    (async () => {
      try {
        const stored = await getProjectMedia(projectId);
        if (!stored || stop.signal.aborted) return;
        const seen = await scanVideo(stored.blob, { signal: stop.signal });
        if (!seen || stop.signal.aborted) return;
        visual.current    = compactScan(seen.scan);
        keyframes.current = seen.keyframes;
      } catch {
        /* No frames to measure is not an error worth interrupting anyone for;
           the AI simply says it has not seen the picture. */
      }
    })();
    return () => stop.abort();
  }, [projectId]);

  /**
   * Speech recognition. Deliberately on demand rather than automatic: it costs
   * a provider call, and plenty of edits never need words. Chunks are uploaded
   * in order so partial progress is still usable if a later one fails.
   */
  const transcribe = async () => {
    if (asr === 'running') return;
    asrTried.current = true;
    setAsr('running');
    say({ role: 'ai', text: 'Listening to the audio and writing down what is said…' });

    try {
      const stored = await getProjectMedia(projectId);
      if (!stored) {
        replaceLast("I can't find the media for this project in this browser — reopen it and try again.");
        setAsr('failed');
        return;
      }

      const samples = await decodeForAsr(stored.blob);
      if (!samples || samples.length === 0) {
        replaceLast("I couldn't decode any audio from this file — it may have no audio track.");
        setAsr('failed');
        return;
      }

      const chunks = chunkForAsr(samples);
      let total = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          replaceLast(`Transcribing… part ${i + 1} of ${chunks.length}.`);
        }
        const form = new FormData();
        form.append('audio', chunks[i].blob, 'audio.wav');
        form.append('offsetS', String(chunks[i].offsetS));
        form.append('durationS', String(totalS));

        const res = await fetch(`/api/projects/${projectId}/transcribe`, { method: 'POST', body: form });

        // A platform-level rejection (body too large, function timeout) is not
        // JSON, and swallowing it produced a bare "failed" with no cause.
        const text = await res.text();
        let data: { error?: string; segments?: unknown[] } | null = null;
        try { data = JSON.parse(text); } catch { data = null; }

        if (!res.ok) {
          const message = data?.error ?? (
            res.status === 413 ? `The server refused part ${i + 1} as too large (${Math.round(chunks[i].blob.size / 1e6)} MB).`
          : res.status === 504 || res.status === 408
                              ? `Part ${i + 1} took too long and the server gave up. A shorter clip will work.`
          : res.status === 401 ? 'You have been signed out — sign in and try again.'
          :                      `Transcription failed on part ${i + 1} (HTTP ${res.status}).`);
          replaceLast(message);
          setAsr(total > 0 ? 'done' : 'failed');
          return;
        }
        const got = Array.isArray(data?.segments)
          ? (data.segments as StoredTranscript['segments']) : [];
        total += got.length;

        if (got.length) {
          const previous = (transcript.current?.segments ?? [])
            .filter(sg => sg.endS <= chunks[i].offsetS + 0.001);
          transcript.current = {
            segments: [...previous, ...got].sort((x, y) => x.startS - y.startS).slice(0, 5000),
            language: (data as { language?: string })?.language ?? transcript.current?.language ?? '',
            model:    (data as { model?: string })?.model ?? 'whisper',
            madeAt:   new Date().toISOString(),
          };
          await saveTranscript(projectId, transcript.current).catch(() => {});
        }
      }

      setAsr('done');
      replaceLast(total > 0
        ? `Done — ${total} lines transcribed. I can now write real captions, cut filler words, or find where something was said.`
        : "I listened to the whole thing but couldn't make out any speech.");
    } catch {
      replaceLast('Something went wrong while transcribing.');
      setAsr('failed');
    }
  };

  const say = (m: Msg) => setMsgs(prev => [...prev, m]);
  const replaceLast = (text: string) =>
    setMsgs(prev => prev.map((m, i) => (i === prev.length - 1 ? { ...m, text } : m)));

  const learnReference = async (file: File) => {
    if (refBusy) return;
    setRefBusy(true);
    say({ role: 'user', text: `Edit it like this: ${file.name}` });
    say({ role: 'ai', text: 'Watching the reference…' });

    try {
      const meta = await analyseFile(file);
      if (!meta.durationS) {
        replaceLast("I couldn't read that file — try an mp4 or mov.");
        return;
      }

      const res = await analyseReference(
        file, { name: file.name, durationS: meta.durationS },
        p => replaceLast(p.message),
      );
      if (!res) {
        replaceLast("I couldn't decode that video. Try a different file or a shorter clip.");
        return;
      }

      const { profile } = res;
      const description = describeStyle(profile);
      setLearnedStyle(`${profile.sourceName} — ${description}`);
      replaceLast(`Got it. ${description}`);
      setMsgs(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, style: profile } : m));
    } catch {
      replaceLast('Something went wrong reading that reference.');
    } finally {
      setRefBusy(false);
    }
  };

  const applyStyle = async (profile: StyleProfile) => {
    if (refBusy) return;
    setRefBusy(true);
    say({ role: 'ai', text: 'Re-cutting your footage in that style…' });

    try {
      // The target's own audio decides which sections survive the cut
      const stored = await getProjectMedia(projectId);
      const env    = stored ? await analyseAudio(stored.blob) : null;
      const dur    = stored?.durationS || totalS;

      const plan = generateEditPlan({
        profile,
        durationS: dur,
        sourceName: stored?.filename,
        onsets:   env?.onsets ?? [],
        interest: interestCurve(env, dur),
      });

      onStyleApplied?.(plan);
      setMsgs(prev => prev.map((m, i) => (i === prev.length - 1
        ? { ...m, text: `Done — I cut your video the way "${profile.sourceName}" is cut.`,
            summary: plan.summary }
        : m)));
    } catch {
      replaceLast("I couldn't apply that style — your media may not be loaded.");
    } finally {
      setRefBusy(false);
    }
  };

  /** Requests that are meaningless without words on the timeline. */
  const needsTranscript = (text: string) =>
    /caption|subtitle|filler|\bums?\b|\buhs?\b|transcri|what (did|do|does|is)\s+(they|he|she|it|the)|what.*(say|said|talk|about)|quote|word/i
      .test(text);

  /**
   * Finding clips on meaning rather than loudness needs the words too — with
   * a Groq key the transcript is what lets the model pick moments, write hook
   * titles and score shareability instead of just ranking energy. Asking for
   * clips is consent for speech recognition, exactly as captions are.
   */
  const wantsClips = (text: string) =>
    /\bclips?\b|\bshorts?\b|tiktok|reels?|viral|\b(?:give|find|make)(?: me)?\s*\d+\b/i
      .test(text);

  /** Questions that are only answerable by looking at the picture. */
  const needsVision = (text: string) =>
    /what (?:can |do )?you see|what.?s (?:in|happening|going on)|describe|look at|watch|see the|visual|colour|color|wearing|who is|what is (?:he|she|it|this|that)|jersey|logo|scene|shot|background/i
      .test(text);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Msg = { role: 'user', text: text.trim() };
    setMsgs(m => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Transcribe first rather than refusing. The request itself is consent —
      // nobody asks for captions and then objects to speech recognition.
      // Captions/filler always need words. Clips only auto-transcribe when a
      // provider is actually configured: transcription needs a Groq key, and
      // with no key the measurement engine answers fine on its own — there is
      // no point failing a Whisper call that was never going to work.
      const clipReq = wantsClips(text) ? parseClipRequest(text) : null;
      const needWords = needsTranscript(text) ||
        (wantsClips(text) && aiReady.current !== false);
      if (needWords && asr !== 'done' && !asrTried.current) {
        await transcribe();
      }

      // Clip-hunting ("find me 5 clips", "90 second short", "viral moments")
      // goes to the dedicated clipping engine: free browser measurements, an
      // OpenShorts-style virality score from the transcript LLM, and the
      // optional TwelveLabs Pegasus visual ranker. Everything else is a normal
      // edit question for the general AI route.
      let data: any = null;
      if (clipReq) {
        const res = await fetch(`/api/projects/${projectId}/clips`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            message:  text.trim(),
            count:    clipReq.count,
            targetLenS: clipReq.targetLenS,
            bias:     clipReq.bias,
            silences: silences.current.slice(0, 200),
            energy:   energy.current.slice(0, 7200),
            visual:   visual.current ?? undefined,
            transcript: transcript.current ?? undefined,
          }),
        });
        data = await res.json().catch(() => null);
      }
      if (!clipReq || !Array.isArray(data?.clips) || data.clips.length === 0) {
        const res  = await fetch(`/api/projects/${projectId}/ai`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            message:  text.trim(),
            silences: silences.current.slice(0, 200),
            energy:   energy.current.slice(0, 7200),
            audio:    audioState.current,
            transcript: transcript.current ?? undefined,
            style:    learnedStyle ?? undefined,
            visual:   visual.current ?? undefined,
            // Frames are heavy. They travel only when the question needs eyes.
            frames:   needsVision(text) ? keyframes.current.map(k => k.dataUrl).slice(0, 6) : undefined,
          }),
        });
        data = await res.json();
      }

      const clipsOut: ClipSuggestion[] | undefined = clipReq
        ? (Array.isArray(data?.clips) ? data.clips : undefined)
        : (Array.isArray(data?.edit?.clips) ? data.edit.clips : undefined);

      const aiReply: Msg = {
        role:     'ai',
        text:     data?.reply ?? data.aiMessage?.text ?? 'Edit applied.',
        summary:  data.edit?.summary,
        savedS:   data.edit?.savedS,
        undoable: true,
        ...(clipsOut && clipsOut.length ? { clips: clipsOut } : {}),
      };

      // Save undo snapshot before applying
      setHistory(h => [...h, msgs]);
      setMsgs(m => [...m, aiReply]);

      // Notify shell to highlight affected clips / update timeline
      if (data.edit?.affectedIds && onEditApplied) {
        onEditApplied(data.edit.affectedIds, data.edit.newClips ?? []);
      }
    } catch {
      setMsgs(m => [...m, { role: 'ai', text: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setMsgs([...prev, { role: 'ai', text: 'Edit undone. Timeline restored to previous state.' }]);
    onEditApplied?.([], []);
  };

  return (
    <div className="editor-ai-panel-inner" style={{
      width: 'clamp(280px,22vw,400px)', flexShrink: 0,
      background: C.surface, borderLeft: `1px solid ${C.b}`,
      display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{ height: 42, borderBottom: `1px solid ${C.b}`, display: 'flex',
        alignItems: 'center', gap: 8, padding: '0 12px', flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent,
          boxShadow: `0 0 6px ${C.accent}88`, animation: 'anim-glow-pulse 2.8s ease-in-out infinite' }} />
        <span style={{ ...ty.aiHead }}>AI Editor</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {history.length > 0 && (
            <button onClick={undo}
              style={{ fontFamily: F, fontSize: 11, fontWeight: 500, color: C.muted,
                background: 'none', border: `1px solid ${C.b3}`, borderRadius: 6,
                padding: '3px 8px', cursor: 'pointer', transition: 'all 120ms' }}
              onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.accent + '55'; }}
              onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.b3; }}
            >↩ Undo</button>
          )}
          <div style={{ padding: '2px 8px', background: `${C.accent}14`,
            border: `1px solid ${C.accent}30`, borderRadius: 9999 }}>
            <span style={{ ...ty.badge, color: C.accent, letterSpacing: '0.02em' }}>v3</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px 6px',
        display: 'flex', flexDirection: 'column', gap: 10 }}>

        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column',
            alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>

            {m.role === 'ai' && (
              <div style={{ width: 18, height: 18, borderRadius: '50%',
                background: `${C.accent}18`, border: `1px solid ${C.accent}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 7, fontWeight: 700, color: C.accent }}>AI</span>
              </div>
            )}

            <div style={{
              maxWidth: '92%', padding: '8px 11px',
              borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '3px 12px 12px 12px',
              background: m.role === 'user' ? C.accent : C.s3,
              border: m.role === 'user' ? 'none' : `1px solid ${C.b3}`,
              ...ty.aiMsg,
              color: m.role === 'user' ? '#fff' : undefined,
              animation: 'msg-in 220ms cubic-bezier(0.22,1,0.36,1)',
            } as React.CSSProperties}>
              {m.text}
            </div>

            {/* Learned reference style — one tap to replicate it */}
            {m.style && (
              <button onClick={() => applyStyle(m.style!)} disabled={refBusy}
                style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 11px', background: `${C.accent}18`,
                  border: `1px solid ${C.accent}55`, borderRadius: 9999,
                  fontFamily: F, fontSize: 11, fontWeight: 600, color: C.accent,
                  cursor: refBusy ? 'default' : 'pointer', opacity: refBusy ? 0.5 : 1 }}>
                <Wand2 size={11} /> Edit my video in this style
              </button>
            )}

            {/* Clipping engine results — one tap to isolate a clip */}
            {m.clips && m.clips.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 340 }}>
                {m.clips.map((c) => (
                  <ClipCard key={c.id} clip={c} onCut={() => onCutToClip?.(c)} />
                ))}
              </div>
            )}

            {/* Edit summary chip */}
            {m.summary && (
              <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 9px', background: 'rgba(52,211,153,0.08)',
                border: '1px solid rgba(52,211,153,0.2)', borderRadius: 9999,
                animation: 'msg-in 260ms cubic-bezier(0.22,1,0.36,1)' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#34D399', flexShrink: 0 }} />
                <span style={{ fontFamily: F, fontSize: 11, fontWeight: 600, color: '#34D399' }}>
                  {m.summary}
                </span>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%',
              background: `${C.accent}18`, border: `1px solid ${C.accent}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 7, fontWeight: 700, color: C.accent }}>AI</span>
            </div>
            <div style={{ padding: '8px 11px', background: C.s3, border: `1px solid ${C.b3}`,
              borderRadius: '3px 12px 12px 12px', display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: '50%',
                  background: C.muted,
                  animation: `pulse-dot 1.2s ease-in-out ${i * 200}ms infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bot} />
      </div>

      {/* Quick pills */}
      <div style={{ padding: '7px 10px', borderTop: `1px solid ${C.b}`,
        display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <input ref={refInput} type="file" accept="video/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void learnReference(f); e.target.value = ''; }} />

        <button onClick={() => refInput.current?.click()} disabled={refBusy || loading}
          title="Upload a video whose editing style you want copied"
          style={{ ...ty.pill, display: 'flex', alignItems: 'center', gap: 5,
            background: `${C.accent}14`, border: `1px solid ${C.accent}44`, color: C.accent,
            borderRadius: 9999, padding: '4px 9px',
            cursor: refBusy || loading ? 'not-allowed' : 'pointer',
            opacity: refBusy || loading ? 0.5 : 1, transition: 'all 120ms' }}>
          <Film size={11} /> {refBusy ? 'Learning…' : 'Reference video'}
        </button>

        {QUICK.map((q, i) => (
          <button key={i} onClick={() => send(q.prompt)}
            disabled={loading}
            style={{ ...ty.pill,
              background: (q as { highlight?: boolean }).highlight ? `${C.accent}14` : 'transparent',
              border: `1px solid ${(q as { highlight?: boolean }).highlight ? C.accent + '44' : C.b2}`,
              color: (q as { highlight?: boolean }).highlight ? C.accent : undefined,
              borderRadius: 9999, padding: '4px 8px', cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 120ms', opacity: loading ? 0.5 : 1 }}
            onMouseEnter={e => { if (!loading) { e.currentTarget.style.color = '#A1A1A1'; e.currentTarget.style.borderColor = C.b3; } }}
            onMouseLeave={e => { e.currentTarget.style.color = (q as { highlight?: boolean }).highlight ? C.accent : C.muted; e.currentTarget.style.borderColor = (q as { highlight?: boolean }).highlight ? C.accent + '44' : C.b2; }}
          >{q.label}</button>
        ))}
      </div>

      {/* Input */}
      <div style={{ padding: '7px 10px 12px', borderTop: `1px solid ${C.b}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, background: C.s2,
          border: `1px solid ${loading ? C.accent + '44' : C.b3}`, borderRadius: 9,
          padding: '6px 7px 6px 11px', transition: 'border-color 150ms' }}>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Tell AI what to edit…" rows={1}
            disabled={loading}
            style={{ flex: 1, ...ty.aiInput, resize: 'none', lineHeight: 1.5,
              maxHeight: 68, overflowY: 'auto', background: 'transparent',
              border: 'none', outline: 'none',
              color: loading ? C.muted : C.text }} />
          <button onClick={() => send(input)} disabled={!input.trim() || loading}
            style={{ width: 26, height: 26, borderRadius: 6,
              background: input.trim() && !loading ? C.accent : C.b2,
              border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 150ms' }}>
            {loading
              ? <div style={{ width: 10, height: 10, borderRadius: '50%',
                  border: '1.5px solid currentColor', borderTopColor: 'transparent',
                  color: C.muted, animation: 'spin-ai 0.7s linear infinite' }} />
              : <Send size={10} color={input.trim() ? '#fff' : C.dim} />}
          </button>
        </div>
        <p style={{ ...ty.hint, margin: '4px 0 0', textAlign: 'center' as const }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>

      <style>{`
        @keyframes msg-in  { from { opacity:0; transform:translateY(6px) scale(0.97) } to { opacity:1; transform:none } }
        @keyframes spin-ai { to { transform:rotate(360deg) } }
      `}</style>
    </div>
  );
}

/* ──────────────── VIDEO PREVIEW ──────────────── */
const AIChatPanel = React.memo(AIChatPanelBase);

function VideoPreview({ playheadS, playing, onToggle, onSeek, onStop, onEnd, totalS, videoUrl, aspectRatio,
  sequence, projectId }:
  { playheadS:number; playing:boolean; onToggle:()=>void; onSeek:(s:number)=>void; onStop:()=>void; onEnd:()=>void;
    totalS:number; videoUrl?:string|null; aspectRatio?:string;
    sequence:Sequence; projectId?:string }) {

  // Any detected ratio, not just the three we happened to hard-code
  const cssAspect = (() => {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio ?? '');
    if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return `${m[1]}/${m[2]}`;
    return '16/9';
  })();

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'#000',
      overflow:'hidden', minWidth:0 }}>

      {/* Screen area */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
        padding:'16px', minHeight:0, overflow:'hidden' }}>

        <div style={{ position:'relative', height:'100%',
          aspectRatio: cssAspect,
          maxHeight:'100%', maxWidth:'100%',
          borderRadius:10, overflow:'hidden',
          boxShadow:'0 12px 60px rgba(0,0,0,0.8)',
          border:`1px solid ${C.b3}`,
          background:'#000', cursor:'pointer' }}
          onClick={onToggle}>

          {videoUrl ? (
            /* ── Composited programme output ── */
            <PreviewCanvas
              sequence={sequence}
              sourceUrl={videoUrl}
              sourceId={projectId ?? 'main'}
              playing={playing}
              playheadS={playheadS}
              onTime={onSeek}
              onPaused={onStop}
              onEnded={onEnd}
            />
          ) : (
            /* ── Mockup canvas (no video available) ── */
            <>
              <div style={{ position:'absolute',inset:0,background:'linear-gradient(180deg,#1a2030 0%,#2a2520 60%,#1a1815 100%)' }} />
              <div style={{ position:'absolute',bottom:0,left:'50%',transform:'translateX(-50%)',width:'45%',height:'90%',
                background:'linear-gradient(180deg,transparent 10%,rgba(140,110,90,0.15) 100%)',borderRadius:'50% 50% 0 0' }} />
              <div style={{ position:'absolute',bottom:'16%',left:'50%',transform:'translateX(-50%)',
                background:'rgba(0,0,0,0.78)',padding:'7px 16px',borderRadius:4,backdropFilter:'blur(2px)',whiteSpace:'nowrap' }}>
                <span style={{ ...ty.aiMsg, fontSize:13, color:'rgba(255,255,255,0.92)' }}>Preview unavailable — re-upload to play</span>
              </div>
            </>
          )}

          {/* AI badge overlay */}
          <div style={{ position:'absolute',top:10,left:10,display:'flex',alignItems:'center',gap:5,
            background:'rgba(0,0,0,0.65)',backdropFilter:'blur(6px)',padding:'3px 9px',borderRadius:9999,
            border:`1px solid ${C.accent}44`, pointerEvents:'none' }}>
            <div style={{ width:5,height:5,borderRadius:'50%',background:C.accent,boxShadow:`0 0 5px ${C.accent}` }} />
            <span style={{ ...ty.badge, color:C.accent }}>AI Edit · v3</span>
          </div>

          {/* Play/pause overlay — only shown when no video or paused */}
          {(!videoUrl || !playing) && (
            <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',
              background: videoUrl && !playing ? 'rgba(0,0,0,0.25)' : 'transparent', transition:'background 200ms' }}>
              <div style={{ width:48,height:48,borderRadius:'50%',background:'rgba(255,255,255,0.14)',
                border:'1px solid rgba(255,255,255,0.22)',backdropFilter:'blur(4px)',
                display:'flex',alignItems:'center',justifyContent:'center' }}>
                {playing ? <Pause size={20} fill="#fff" color="#fff"/> : <Play size={20} fill="#fff" color="#fff" style={{marginLeft:2}}/>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transport bar */}
      <div style={{ borderTop:`1px solid ${C.b}`, background:C.surface, flexShrink:0 }}>
        {/* Controls row — scrubbing happens on the timeline below */}
        <div style={{ height:44, display:'flex', alignItems:'center', padding:'0 16px', gap:8 }}>
          <span style={{ ...ty.playTime, minWidth:44 }}>{fmt(playheadS)}</span>
          <div style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:10 }}>
            <button onClick={()=>onSeek(0)} style={vB}><SkipBack size={14}/></button>
            <button onClick={onToggle} style={{ width:34,height:34,borderRadius:'50%',background:'#FFFFFF',
              border:'none',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0 }}>
              {playing ? <Pause size={14} fill="#000" color="#000"/> : <Play size={14} fill="#000" color="#000" style={{marginLeft:1}}/>}
            </button>
            <button onClick={()=>onSeek(Math.min(totalS,playheadS+10))} style={vB}><SkipForward size={14}/></button>
          </div>
          <span style={{ ...ty.playTime }}>{fmt(totalS)}</span>
          <button style={vB}><Maximize2 size={13}/></button>
        </div>
      </div>
    </div>
  );
}
const vB:React.CSSProperties = { width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',
  background:'none',border:'none',cursor:'pointer',color:C.muted,borderRadius:7,transition:'all 100ms' };

/* ──────────────── TIMELINE ──────────────── */
function TimelinePanel({ playheadS, setPlayheadS, playing, setPlaying, totalS, tracks, highlightIds, projectId, analysing, onUndo, onRedo, onSplit, onReset }:
  { playheadS:number; setPlayheadS:(s:number)=>void; playing:boolean; setPlaying:(b:boolean)=>void;
    totalS:number; tracks: ReturnType<typeof buildTracks>; highlightIds?: string[]; projectId?: string;
    analysing?: boolean; onUndo?: () => void; onRedo?: () => void; onSplit?: () => void; onReset?: () => void }) {

  const [frames, setFrames] = useState<string[]>([]);
  const [waveform, setWaveform] = useState<number[] | null>(() => projectId ? getProjectWaveform(projectId) : null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const poll = setInterval(() => {
      const w = getProjectWaveform(projectId);
      if (w && w.length) {
        if (!cancelled) setWaveform(w);
        clearInterval(poll);
      }
    }, 400);
    void loadCachedWaveform(projectId).then(w => {
      if (w && w.length && !cancelled) {
        setWaveform(w);
        clearInterval(poll);
      }
    });
    return () => { cancelled = true; clearInterval(poll); };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    // Poll while frames stream in from the parallel extractor, then stop
    let sig = '';
    const check = () => {
      const f = getProjectFrames(projectId);
      // Only re-render when the strip actually gained frames
      const next = `${f.length}:${f.reduce((n, x) => n + (x ? 1 : 0), 0)}`;
      if (f.length > 0 && next !== sig) { sig = next; setFrames([...f]); }
      if (f.length > 0 && f.every(Boolean)) clearInterval(id);
    };
    check();
    const id = setInterval(check, 250);
    return () => clearInterval(id);
  }, [projectId]);

  const scrollRef    = useRef<HTMLDivElement>(null);
  const rulerRef     = useRef<HTMLDivElement>(null);
  const containerW   = useRef(800);
  const dragging     = useRef(false);       // true while user drags playhead
  const wasPlaying   = useRef(false);       // playback state before scrub started

  const [zoom, setZoom] = useState(() => {
    if (!totalS) return 8;
    return Math.max(4, Math.min(80, (containerW.current * 0.75) / totalS));
  });

  /* The slice of the timeline that is actually on screen, in pixels. Only
     clips inside it are put in the DOM: a 13-minute video captioned line by
     line has hundreds of clips, and rendering them all made scrolling and
     playback crawl. Updated from the scroll position, never from the
     playhead, so it costs nothing during playback. */
  const [view, setView] = useState({ left: 0, width: 1600 });
  const viewRaf = useRef(0);
  const readView = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const left = node.scrollLeft, width = node.clientWidth;
    setView(v => (Math.abs(v.left - left) < 24 && v.width === width ? v : { left, width }));
  }, []);
  const onTimelineScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const node = e.currentTarget;
    if (viewRaf.current) return;                 // one read per frame, at most
    viewRaf.current = requestAnimationFrame(() => { viewRaf.current = 0; readView(node); });
  }, [readView]);
  useEffect(() => () => { if (viewRaf.current) cancelAnimationFrame(viewRaf.current); }, []);

  /* Zoom has to be applied before the scroll position that goes with it, or
     the browser clamps the scroll against the old content width. */
  const pendingScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || pendingScroll.current == null) return;
    node.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
    readView(node);
  });

  /* The wheel, CapCut style: it scrolls the timeline sideways, and with ctrl
     or ⌘ held (which is also what a trackpad pinch sends) it zooms about the
     pointer instead of the left edge. Registered by hand because React's
     wheel listener is passive — preventDefault would be ignored, and the
     page would zoom instead of the timeline. */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = node.getBoundingClientRect();
        const pointerX = Math.max(0, e.clientX - rect.left);
        setZoom(z => {
          const next = clampZoom(z * zoomFactor(e.deltaY));
          if (next === z) return z;
          pendingScroll.current = anchoredScrollLeft(
            { zoom: z, next, pointerX, scrollLeft: node.scrollLeft });
          return next;
        });
        return;
      }
      // Let a genuinely vertical list scroll vertically; otherwise a plain
      // wheel walks along the timeline, which is what an editor wants.
      const canScrollDown = node.scrollHeight > node.clientHeight + 4;
      if (canScrollDown || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (!e.deltaY) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [scrollRef]);

  const scrollMounted = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    containerW.current = node.clientWidth - LABEL_W;
    readView(node);
    setZoom(z => {
      const ideal = Math.max(4, Math.min(80, (containerW.current * 0.75) / totalS));
      return z === 8 && totalS > 0 ? ideal : z;
    });
  }, [totalS, readView]);

  const totalPx = totalS * zoom;

  const interval = zoom < 0.5 ? 120 : zoom < 1 ? 60 : zoom < 4 ? 30 : zoom < 10 ? 10 : zoom < 20 ? 5 : 1;
  /* Zoomed right in this is thousands of objects. It depends on zoom and
     duration only, so it must not be rebuilt on every frame of playback. */
  const ticks = useMemo(() => {
    const out: {s:number;major:boolean}[] = [];
    for (let t = 0; t <= totalS; t += interval/5) out.push({ s: t, major: t % interval === 0 });
    return out;
  }, [interval, totalS]);

  /* Ruler marks rebuild only on zoom / duration change — not on every frame of
     playback, which is what made the whole timeline re-render at 60fps. */
  const tickMarks = useMemo(() => ticks.filter(t => {
    const px = t.s * zoom;
    return px >= view.left - PAD_PX && px <= view.left + view.width + PAD_PX;
  }).map(t=>(
    <div key={t.s} style={{ position:'absolute', left:t.s*zoom, top:0, bottom:0 }}>
      <div style={{ position:'absolute', bottom:0, width:1,
        height:t.major?10:5, background:t.major?C.b3:C.b2 }} />
      {t.major && t.s>0 && (
        <span style={{ position:'absolute', bottom:2, left:2,
          ...ty.tick, whiteSpace:'nowrap' as const }}>{fmt(t.s)}</span>
      )}
    </div>
  )), [zoom, totalS, view]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Convert a clientX to seconds, accounting for scroll */
  const clientXToS = useCallback((clientX: number): number => {
    if (!rulerRef.current) return 0;
    const r   = rulerRef.current.getBoundingClientRect();
    const raw = clientX - r.left + (scrollRef.current?.scrollLeft ?? 0);
    return Math.max(0, Math.min(totalS, raw / zoom));
  }, [zoom, totalS]);

  /* Every cut the playhead should stick to. Rebuilt only when the edit
     changes, not while dragging. */
  const edges = useMemo(() => snapEdges(tracks, totalS), [tracks, totalS]);

  /* A drag lands on a cut if it comes close, unless alt is held — the escape
     hatch CapCut gives you when you need a position between two cuts. */
  const timeAt = useCallback((clientX: number, ev?: { altKey?: boolean }) => {
    const raw = clientXToS(clientX);
    if (ev?.altKey) return raw;
    return Math.max(0, Math.min(totalS, snapTime(raw, edges, zoom)));
  }, [clientXToS, edges, zoom, totalS]);

  /* One scrub gesture, wherever it starts. Grabbing the ruler, the playhead
     or any empty part of a track all do the same thing — CapCut lets you
     scrub from anywhere, and hunting for a 4px ruler strip is miserable. */
  const beginScrub = useCallback((e: React.MouseEvent, opts: { pauseWhileDragging: boolean }) => {
    e.preventDefault();
    dragging.current   = true;
    wasPlaying.current = playing;
    if (opts.pauseWhileDragging && playing) setPlaying(false);

    setPlayheadS(timeAt(e.clientX, e));

    const move = (ev: MouseEvent) => { ev.preventDefault(); setPlayheadS(timeAt(ev.clientX, ev)); };
    const up = () => {
      dragging.current = false;
      if (opts.pauseWhileDragging && wasPlaying.current) setPlaying(true);
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup',   up);
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup',   up);
  }, [playing, setPlaying, setPlayheadS, timeAt]);

  const onRulerDown    = useCallback((e: React.MouseEvent) =>
    beginScrub(e, { pauseWhileDragging: false }), [beginScrub]);

  const onPlayheadDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    beginScrub(e, { pauseWhileDragging: true });
  }, [beginScrub]);

  /* Scrubbing from the track rows. Ignored on a clip itself, so selecting or
     dragging clips later stays possible. */
  const onTracksDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement)?.closest?.('[data-modaya-clip]')) return;
    beginScrub(e, { pauseWhileDragging: true });
  }, [beginScrub]);

  const phPx = playheadS * zoom;

  /* The track rows — clips, frame tiles, waveform bars — are by far the
     heaviest part of the timeline (hundreds of nodes). They depend on the
     media, not on the playhead, so they must NOT be rebuilt on every frame of
     playback; that rebuild was the remaining source of stutter. */
  const trackRows = useMemo(() => (
    <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
      {tracks.map(tr=>{
        return (
          <div key={tr.id} style={{ height:tr.h+3, position:'relative',
            borderBottom:`1px solid ${C.b}`,
            background: tr.id==='text' ?'rgba(255,255,255,0.04)'
                      : tr.id==='video'?'rgba(55,65,81,0.08)'
                      : tr.id.startsWith('aud')?'rgba(5,150,105,0.04)'
                      : 'rgba(8,145,178,0.04)' }}>
            {Array.from({length:Math.ceil(totalS/60)},(_,i)=>(
              <div key={i} style={{ position:'absolute',top:0,bottom:0,
                left:i*60*zoom,width:1,background:'rgba(255,255,255,0.02)',pointerEvents:'none' }} />
            ))}

            {packClips(tr.clips, zoom, view, { padPx: PAD_PX }).map(pk=>{
              const { left, w, merged } = pk;
              const clip = { s: pk.s, e: pk.e, label: pk.label };
              const ci   = pk.key;
              return (
                <div key={ci} data-modaya-clip style={{ position:'absolute', left, top:3,
                  height:`calc(100% - 6px)`, width:w,
                  background:tr.bg, borderRadius:5,
                  border:`1px solid ${highlightIds && highlightIds.length > 0 && (tr.id==='video'||tr.id==='aud1') ? tr.color+'cc' : tr.color+'55'}`,
                  overflow:'hidden', cursor:'grab',
                  boxShadow: highlightIds && highlightIds.length > 0 && (tr.id==='video'||tr.id==='aud1') ? `0 0 10px ${tr.color}66` : 'none',
                  transition:'box-shadow 400ms ease, border-color 400ms ease' }}>

                  {merged === 1 && (tr as any).thumb && (
                    <div style={{ position:'absolute',inset:0,display:'flex',overflow:'hidden',borderRadius:4 }}>
                      {Array.from({length: Math.max(1, Math.min(TILE_CAP, Math.ceil(w / 80)))}, (_, i) => {
                        const frameIdx = frames.length > 0
                          ? Math.min(frames.length - 1, Math.floor((i / Math.ceil(w / 80)) * frames.length))
                          : -1;
                        const frame = frameIdx >= 0 ? frames[frameIdx] : '';
                        return (
                          <div key={i} style={{
                            flexShrink: 0, width: 80, height: '100%',
                            borderRight: '1px solid rgba(0,0,0,0.3)',
                            background: frame
                              ? `url(${frame}) center/cover no-repeat`
                              : 'linear-gradient(135deg,#0d1a2e,#1a2a40)',
                            position: 'relative',
                          }}>
                            {frame && <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.12)' }} />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {merged === 1 && (tr as any).wave && (
                    <div style={{ position:'absolute',inset:'3px 0',display:'flex',alignItems:'center',overflow:'hidden',gap:1 }}>
                      {resampleWaveform(waveform, clip.s, clip.e, totalS, Math.min(BAR_CAP, Math.floor(w/2))).map((h,i)=>(
                        <div key={i} style={{ flex:1,minWidth:1,height:`${Math.round(h*88)}%`,
                          background:'#34D399',borderRadius:1,opacity:0.72 }} />
                      ))}
                    </div>
                  )}

                  {w > 60 && clip.label && (
                    <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',
                      padding:'0 6px',gap:3,pointerEvents:'none',zIndex:2 }}>
                      <span style={{ ...ty.clip, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{clip.label}</span>
                    </div>
                  )}

                  {/* Nothing to grab on a clip a few pixels wide */}
                  {w >= 12 && (
                    <div style={{ position:'absolute',top:0,right:0,width:5,bottom:0,
                      cursor:'ew-resize',background:`${tr.color}55`,borderRadius:'0 4px 4px 0' }} />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  ), [tracks, zoom, frames, highlightIds, totalS, view]);

  /* ── Keep the playhead in view ──
     When the playhead moves past either edge of the visible window — during
     playback or after a jump — scroll the timeline so it stays on screen.
     Skipped while the user is dragging, so scrubbing never fights the scroll. */
  const lastFollow = useRef(0);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const follow = () => {
      const node = scrollRef.current;
      if (!node || dragging.current) return;

      // The label column is a sibling, so clientWidth is already the view width
      const viewW = node.clientWidth;
      const maxScroll = node.scrollWidth - viewW;
      if (maxScroll <= 1) return;                    // nothing to scroll

      const left   = node.scrollLeft;
      const margin = Math.min(80, viewW * 0.12);     // comfort gap at the edges
      const target =
        phPx < left + margin              ? phPx - margin          // off the left
      : phPx > left + viewW - margin      ? phPx - viewW / 3       // off the right
      : null;

      if (target === null) return;
      const clamped = Math.max(0, Math.min(maxScroll, target));
      if (Math.abs(clamped - left) < 2) return;
      // 'auto' during playback: smooth scrolling can't keep up with a moving
      // playhead and ends up lagging behind it.
      node.scrollTo({ left: clamped, behavior: playing ? 'auto' : 'smooth' });
      lastFollow.current = performance.now();
    };

    // Throttle the layout reads, but always run a trailing pass so a single
    // jump (click, skip, seek) is never swallowed by the throttle window.
    if (performance.now() - lastFollow.current >= 100) {
      follow();
    } else {
      if (followTimer.current) clearTimeout(followTimer.current);
      followTimer.current = setTimeout(follow, 100);
    }
    return () => { if (followTimer.current) clearTimeout(followTimer.current); };
  }, [phPx, playing]);

  return (
    <div style={{ height:'clamp(220px,30vh,480px)', background:C.surface, borderTop:`1px solid ${C.b}`,
      display:'flex', flexDirection:'column', flexShrink:0, userSelect:'none' }}>

      {/* ── Toolbar ── */}
      <div style={{ height:36, background:C.s2, borderBottom:`1px solid ${C.b}`,
        display:'flex', alignItems:'center', gap:3, padding:'0 10px', flexShrink:0 }}>
        <button onClick={onSplit} style={tB} title="Split clip at playhead"><Scissors size={12}/></button>
        <button onClick={onReset} style={tB} title="Reset timeline"><RotateCcw size={12}/></button>
        <button onClick={onUndo} style={tB} title="Undo"><Undo2 size={12}/></button>
        <button onClick={onRedo} style={tB} title="Redo"><Redo2 size={12}/></button>
        <div style={{ flex:1 }} />
        <div style={{ display:'flex',alignItems:'center',gap:5,background:C.s3,
          border:`1px solid ${C.b2}`,borderRadius:6,padding:'3px 10px' }}>
          <span style={{ ...ty.timeBig, minWidth:42 }}>{fmt(playheadS)}</span>
          <span style={{ ...ty.meta }}>/</span>
          <span style={{ ...ty.meta }}>{fmt(totalS)}</span>
        </div>
        <div style={{ flex:1 }} />
        <button onClick={()=>setZoom(z=>Math.max(0.5, z / 1.5))} style={tB} title="Zoom out"><Minus size={12}/></button>
        <span style={{ fontFamily:F, fontSize:10, color:C.dim, minWidth:32, textAlign:'center' as const, userSelect:'none' as const }}>
          {zoom < 1 ? `${Math.round(zoom*100)}%` : zoom < 10 ? `${zoom.toFixed(1)}×` : `${Math.round(zoom)}×`}
        </span>
        <button onClick={()=>setZoom(z=>Math.min(120, z * 1.5))} style={tB} title="Zoom in"><Plus size={12}/></button>
        <button onClick={()=>{
          if (scrollRef.current && totalS) {
            const w = scrollRef.current.clientWidth - LABEL_W;
            setZoom(Math.max(0.5, (w * 0.92) / totalS));
          }
        }} style={tB} title="Fit to window"><Maximize2 size={12}/></button>

        {analysing && (
          <div style={{ marginLeft:8, display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:11,height:11,borderRadius:'50%',
              border:`2px solid ${C.accent}`,borderTopColor:'transparent',
              animation:'spin-ai 1s linear infinite' }} />
            <span style={{ fontFamily:F, fontSize:10, color:C.muted }}>Analysing…</span>
          </div>
        )}
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>


        {/* Fixed label column */}
        {tracks.length > 0 && <div style={{ width:LABEL_W, flexShrink:0, background:C.s2,
          borderRight:`1px solid ${C.b}`, display:'flex', flexDirection:'column' }}>
          <div style={{ height:RULER_H, borderBottom:`1px solid ${C.b}`, flexShrink:0 }} />
          {tracks.map(tr=>(
            <div key={tr.id} style={{ height:tr.h+3, display:'flex', alignItems:'center',
              padding:'0 10px', gap:6, borderBottom:`1px solid ${C.b}`, background:C.s2 }}>
              <span style={{ fontSize:11, color:tr.color, flexShrink:0, lineHeight:1 }}>{tr.icon}</span>
              <span style={{ fontSize:10, fontWeight:700, color:'#4a4a4a',
                textTransform:'uppercase', letterSpacing:'0.07em',
                fontFamily:"'Inter',system-ui,-apple-system,sans-serif",
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tr.label}</span>
            </div>
          ))}
        </div>}

        {/* Scrollable track area */}
        {tracks.length > 0 && <div ref={scrollMounted} onScroll={onTimelineScroll} data-modaya-timeline style={{ flex:1, overflow:'auto', position:'relative', minWidth:0 }}>
          <div style={{ width:Math.max(totalPx+40,400), minWidth:'100%', position:'relative' }}>

            {/* ── Ruler (sticky) ── */}
            <div ref={rulerRef} onMouseDown={onRulerDown}
              style={{ height:RULER_H, position:'sticky', top:0, background:C.s2,
                borderBottom:`1px solid ${C.b}`, zIndex:20, cursor:'col-resize', width:'100%' }}>

              {tickMarks}

              {/* ── Ruler playhead triangle — draggable ── */}
              <div
                onMouseDown={onPlayheadDown}
                style={{
                  position: 'absolute', top: 0, left: phPx,
                  transform: 'translateX(-50%)',
                  zIndex: 35, cursor: 'col-resize',
                  /* Wide invisible hit-area so it's easy to grab */
                  padding: '2px 10px 0',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                }}>
                <div style={{ width:0, height:0,
                  borderLeft:'6px solid transparent',
                  borderRight:'6px solid transparent',
                  borderTop:`9px solid ${C.accent}`,
                  pointerEvents:'none',
                  filter:`drop-shadow(0 0 3px ${C.accent}aa)`,
                }} />
              </div>
            </div>

            {/* ── Track rows ── */}
            {/* Scrub from anywhere in the track area, not only the ruler */}
            <div onMouseDown={onTracksDown} style={{ cursor:'col-resize' }}>
              {trackRows}
            </div>

            {/* ── Playhead vertical line + draggable dot ── */}
            <div data-modaya-playhead style={{ position:'absolute', top:RULER_H, bottom:0,
              left: phPx,
              width:1, background:C.accent, zIndex:25,
              pointerEvents:'none',
              boxShadow:`0 0 6px ${C.accent}88` }}>
              {/* Dot — has its own pointer-events so it can be grabbed */}
              <div
                onMouseDown={onPlayheadDown}
                style={{
                  position:'absolute', top:0, left:-8,
                  width:17, height:17,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  cursor:'col-resize', pointerEvents:'all', zIndex:36,
                }}>
                <div style={{ width:9, height:9, borderRadius:'50%',
                  background: C.accent,
                  boxShadow:`0 0 0 2.5px ${C.bg}, 0 0 0 4px ${C.accent}88` }} />
              </div>
            </div>

          </div>
        </div>}
      </div>
    </div>
  );
}

const tB:React.CSSProperties = { width:26,height:26,display:'flex',alignItems:'center',justifyContent:'center',
  background:'transparent',border:'none',cursor:'pointer',color:C.muted,borderRadius:5,transition:'all 100ms' };

/* ──────────────── SHELL ──────────────── */
export function EditorShell({
  projectId = '', projectName, onAIAction,
  clips = [], durationS = DEFAULT_DURATION, aiHistory = [],
}: {
  projectId?:   string;
  projectName:  string;
  onAIAction:   (msg: string) => void;
  clips?:       EditorClip[];
  durationS?:   number;
  aiHistory?:   EditorAIMsg[];
}) {
  const baseTotalS = durationS > 0 ? durationS : DEFAULT_DURATION;

  /* Real media. It may arrive after this component mounts — the editor page
     rehydrates the file from IndexedDB on a refresh — so subscribe rather than
     reading the store once. */
  const [mediaEntry, setMediaEntry] = useState(() => projectId ? getMedia(projectId) : null);
  useEffect(() => {
    if (!projectId) return;
    setMediaEntry(getMedia(projectId));
    return subscribeMedia(changedId => {
      if (changedId === projectId) setMediaEntry(getMedia(projectId));
    });
  }, [projectId]);
  const videoUrl    = mediaEntry?.objectUrl ?? null;
  const videoAspect = mediaEntry?.aspectRatio ?? '16:9';

  useEffect(() => {
    if (!projectId || !mediaEntry?.objectUrl) return;
    if (getProjectWaveform(projectId)) return;
    void loadCachedWaveform(projectId).then(cached => {
      if (cached && cached.length) return;
      fetch(mediaEntry.objectUrl)
        .then(r => r.blob())
        .then(blob => extractWaveform(blob))
        .then(w => {
          if (w && w.length) setProjectWaveform(projectId, w);
        })
        .catch(() => {});
    });
  }, [projectId, mediaEntry?.objectUrl]);

  const [liveClips,    setLiveClips   ] = useState<EditorClip[]>(clips);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  /* Per-clip source/transform/effect overrides produced by the reference pass. */
  const [styleLayer,   setStyleLayer  ] = useState<StyleLayer>({});
  const [styledDur,    setStyledDur   ] = useState<number | null>(null);
  const [playing,      setPlaying     ] = useState(false);
  const [phS,          setPhS         ] = useState(0);
  const [tab,          setTab         ] = useState('Text');
  const [expOpen,      setExpOpen     ] = useState(false);

  // Undo / Redo stacks
  const historyRef = useRef<EditorClip[][]>([]);
  const futureRef  = useRef<EditorClip[][]>([]);

  const pushHistory = useCallback((current: EditorClip[]) => {
    historyRef.current.push([...current]);
    futureRef.current = [];
  }, []);

  const handleUndo = useCallback(() => {
    if (!historyRef.current.length) return;
    const prev = historyRef.current.pop()!;
    futureRef.current.push([...liveClips]);
    setLiveClips(prev);
  }, [liveClips]);

  const handleRedo = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current.pop()!;
    historyRef.current.push([...liveClips]);
    setLiveClips(next);
  }, [liveClips]);

  const handleSplitAtPlayhead = useCallback(() => {
    const at = phS;
    const target = liveClips.find(c => c.type === 'video' && at > c.startS + 0.2 && at < c.endS - 0.2);
    if (!target) return;
    pushHistory(liveClips);
    const first: EditorClip = { ...target, endS: Number(at.toFixed(2)) };
    const second: EditorClip = { ...target, id: `v-${Date.now()}`, startS: Number(at.toFixed(2)) };
    const next = liveClips.map(c => c.id === target.id ? first : c).concat(second).sort((a, b) => a.startS - b.startS);
    setLiveClips(next);
  }, [liveClips, phS, pushHistory]);

  const handleResetTimeline = useCallback(() => {
    pushHistory(liveClips);
    setLiveClips(clips);
    setStyleLayer({});
    setStyledDur(null);
  }, [clips, liveClips, pushHistory]);

  const totalS = styledDur ?? baseTotalS;
  /** Read by togglePlay, which is created before totalS exists. */
  const totalSRef = useRef(0);
  totalSRef.current = totalS;

  const handleStyleApplied = useCallback((plan: EditPlan) => {
    pushHistory(liveClips);
    setLiveClips(plan.clips.map(c => ({
      id: c.id, trackId: c.trackId, label: c.label,
      startS: c.startS, endS: c.endS,
      type: c.type as EditorClip['type'],
    })));
    setStyleLayer(Object.fromEntries(plan.clips.map(c => [
      c.id, { sourceIn: c.sourceIn, transform: c.transform, effects: c.effects },
    ])));
    setStyledDur(plan.durationS);
    setHighlightIds(plan.clips.slice(0, 4).map(c => c.id));
    setTimeout(() => setHighlightIds([]), 3000);
  }, [liveClips, pushHistory]);
  const tracks = useMemo(() => {
    const built = buildTracks(liveClips.length ? liveClips : clips, totalS);
    return built.length ? built : baseTracks(totalS, mediaEntry?.filename ?? 'Video');
  }, [liveClips, clips, totalS, mediaEntry?.filename]);
  const analysing = !(liveClips.length || clips.length);

  /* The programme the preview renders: clips mapped onto source ranges, so
     playback shows the edit (cuts skipped, overlays composited) rather than
     the raw file. */
  const sequence = useMemo(() => buildSequence(
    (liveClips.length ? liveClips : clips) as never[],
    {
      durationS: totalS,
      width:     mediaEntry?.width  ?? 1920,
      height:    mediaEntry?.height ?? 1080,
      sourceId:  projectId ?? 'main',
      style:     styleLayer,
    },
  ), [liveClips, clips, totalS, mediaEntry?.width, mediaEntry?.height, projectId, styleLayer]);

  // When parent re-fetches clips (e.g. after navigation), sync
  useEffect(() => { setLiveClips(clips); }, [clips]);

  const handleEditApplied = useCallback((affectedIds: string[], newClips: EditorClip[]) => {
    if (newClips.length > 0) {
      pushHistory(liveClips);
      setLiveClips(newClips);
    }
    setHighlightIds(affectedIds);
    // Clear highlight after 3s
    setTimeout(() => setHighlightIds([]), 3000);
  }, [liveClips, pushHistory]);

  /* Clipping engine: keep only the chosen range on the timeline, as its own
     short programme. "Undo" in the chat (or the editor undo) brings the full
     video back. The surviving video clip is re-scoped to the window. */
  const handleCutToClip = useCallback((clip: ClipSuggestion) => {
    pushHistory(liveClips);
    setLiveClips(prev => {
      const source = prev.length ? prev : clips;
      const next: EditorClip[] = source
        .filter(c => c.type === 'video' || c.type === 'audio')
        .map(c => ({
          ...c,
          startS: Math.max(c.startS, clip.startS),
          endS:   Math.min(c.endS, clip.endS),
        }))
        .filter(c => c.endS - c.startS > 0.05);
      return next;
    });
    setStyledDur(clip.endS - clip.startS);
    setPhS(0);
    setHighlightIds([]);
  }, [clips, liveClips, pushHistory]);

  /** Pressing play at the very end restarts, rather than sitting there stuck. */
  const togglePlay = useCallback(() => setPlaying(p => {
    if (!p) setPhS(cur => (cur >= totalSRef.current - 0.05 ? 0 : cur));
    return !p;
  }), []);
  /** A pause leaves the playhead exactly where it is. */
  const stopPlay   = useCallback(() => setPlaying(false), []);
  /** Reaching the end rewinds to the start, like every other player. */
  const endPlay    = useCallback(() => { setPlaying(false); setPhS(0); }, []);

  /* Transport from the keyboard, as every editor does it: space plays and
     pauses, the arrows step a frame at a time (a second with shift), home and
     end jump to the two ends. Never while someone is typing in the chat, and
     never behind the export dialog. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (expOpen || !keyIsForEditor(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case ' ': case 'Spacebar': case 'k':
          e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft':
          e.preventDefault();
          setPlaying(false);
          setPhS(t => stepTime(t, -1, { totalS: totalSRef.current, coarse: e.shiftKey }));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setPlaying(false);
          setPhS(t => stepTime(t, 1, { totalS: totalSRef.current, coarse: e.shiftKey }));
          break;
        case 'Home':
          e.preventDefault(); setPhS(0); break;
        case 'End':
          e.preventDefault(); setPlaying(false); setPhS(totalSRef.current); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expOpen, togglePlay]);
  const raf = useRef<number|null>(null);

  // Synthetic clock for the mockup only. With a real video loaded the <video>
  // element drives the playhead, so running this too made the two clocks drift
  // and forced corrective seeks mid-playback.
  useEffect(()=>{
    if (!playing || videoUrl) { if (raf.current) cancelAnimationFrame(raf.current); return; }
    let last = performance.now();
    const tick = (now:number) => {
      const dt = (now-last)/1000; last=now;
      setPhS(s=>{ const n=s+dt; if(n>=totalS){setPlaying(false);return 0;} return n; });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return ()=>{ if(raf.current) cancelAnimationFrame(raf.current); };
  },[playing, totalS, videoUrl]);

  return (
    <div style={{ height:'100vh', minHeight:'700px', display:'flex', flexDirection:'column',
      background:C.bg, overflow:'hidden', fontFamily: F }}>

      {/* ── Topbar — zone 1, delay 0ms ── */}
      <FadeUp delay={0} style={{ flexShrink:0 }}>
        <header style={{ height:46, display:'flex', alignItems:'center', position:'relative',
          borderBottom:`1px solid ${C.b}`, background:C.surface,
          padding:'0 12px', gap:8, zIndex:40 }}>

          {/* Left: Exit + Logo + tools */}
          <Link href="/dashboard" style={{ textDecoration:'none' }}>
            <button style={{ display:'flex',alignItems:'center',gap:5,padding:'5px 10px',
              background:C.s3,border:`1px solid ${C.b2}`,borderRadius:7,
              ...ty.btnSec, fontSize:12, color:'#777', cursor:'pointer',transition:'all 120ms' }}
              onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.b3;}}
              onMouseLeave={e=>{e.currentTarget.style.color='#777';e.currentTarget.style.borderColor=C.b2;}}
            ><ArrowLeft size={12}/> Exit</button>
          </Link>
          <Logo size={22} />
          <div className="desktop-only" style={{ width:1,height:16,background:C.b2 }} />
          <button className="desktop-only" style={{ ...tB,background:C.s3,color:C.text }} title="Select"><MousePointer size={13}/></button>
          <button className="desktop-only" onClick={handleSplitAtPlayhead} style={tB} title="Split at playhead"><Scissors size={13}/></button>
          <div className="desktop-only" style={{ width:1,height:16,background:C.b2,margin:'0 2px' }} />
          <button className="desktop-only" onClick={handleUndo} style={tB} title="Undo"><Undo2 size={13}/></button>
          <button className="desktop-only" onClick={handleRedo} style={tB} title="Redo"><Redo2 size={13}/></button>

          {/* Centre: filename — absolutely positioned at exact midpoint, hidden on mobile */}
          <div className="desktop-only" style={{ position:'absolute', left:0, right:0, top:0, bottom:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            pointerEvents:'none' }}>
            <span style={{ ...ty.proj, fontSize:13, color:C.muted, letterSpacing:'-0.01em',
              maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {projectName}
            </span>
          </div>

          {/* Right: avatars + Export */}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ display:'flex', alignItems:'center' }}>
              {[C.accent,'#ef4444'].map((col,i)=>(
                <div key={i} style={{ width:26,height:26,borderRadius:'50%',background:col,
                  border:`2px solid ${C.surface}`,marginLeft:i>0?-8:0,
                  display:'flex',alignItems:'center',justifyContent:'center' }}>
                  <span style={{ fontSize:9,fontWeight:700,color:'#fff' }}>{i===0?'B':'E'}</span>
                </div>
              ))}
            </div>
            <button onClick={()=>setExpOpen(true)} style={{ display:'flex',alignItems:'center',gap:6,
              padding:'7px 18px',background:C.accent,border:'none',borderRadius:9,
              ...ty.btnPrimary, color:'#fff', cursor:'pointer',
              boxShadow:`0 2px 10px ${C.accent}44`,transition:'all 150ms' }}
              onMouseEnter={e=>{e.currentTarget.style.background=C.accentH;}}
              onMouseLeave={e=>{e.currentTarget.style.background=C.accent;}}
            >Export</button>
          </div>
        </header>
      </FadeUp>

      {/* ── Main area — zone 2+, staggered ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* Left column: panels + video + timeline */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>

          {/* Body row — icon nav (120ms) + props panel (240ms) + video (360ms) */}
          <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
            <FadeUp delay={120} style={{ display:'flex', flexShrink:0 }}>
              <IconNav active={tab} setActive={setTab} />
            </FadeUp>
            <FadeUp delay={240} style={{ display:'flex', flexShrink:0 }} >
              <div className="editor-props-panel" style={{ display:'flex' }}>
                <PropertiesPanel
                  tab={tab}
                  clips={liveClips}
                  onUpdateClips={(newClips) => {
                    pushHistory(liveClips);
                    setLiveClips(newClips);
                  }}
                  styleLayer={styleLayer}
                  onUpdateStyleLayer={setStyleLayer}
                  playheadS={phS}
                  totalS={totalS}
                  mediaEntry={mediaEntry}
                  projectName={projectName}
                  onSeek={setPhS}
                  onPushHistory={pushHistory}
                  onSetTab={setTab}
                />
              </div>
            </FadeUp>
            <FadeUp delay={360} style={{ flex:1, minWidth:0, display:'flex' }}>
              <VideoPreview playheadS={phS} playing={playing} onToggle={togglePlay} onStop={stopPlay} onEnd={endPlay} onSeek={setPhS} totalS={totalS} videoUrl={videoUrl} aspectRatio={videoAspect} sequence={sequence} projectId={projectId} />
            </FadeUp>
          </div>

          {/* Timeline — zone 5, delay 480ms */}
          <FadeUp delay={480} style={{ flexShrink:0 }}>
            <div className="editor-timeline">
              <TimelinePanel
                playheadS={phS}
                setPlayheadS={setPhS}
                playing={playing}
                setPlaying={setPlaying}
                totalS={totalS}
                tracks={tracks}
                highlightIds={highlightIds}
                projectId={projectId}
                analysing={analysing}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onSplit={handleSplitAtPlayhead}
                onReset={handleResetTimeline}
              />
            </div>
          </FadeUp>
        </div>

        {/* AI panel — full height, input pinned to bottom */}
        <FadeUp delay={360} style={{ display:'flex', flexShrink:0, alignSelf:'stretch' }}>
          <div className="editor-ai-panel" style={{ display:'flex', height:'100%' }}>
            <AIChatPanel
              projectId={projectId}
              initialHistory={aiHistory}
              totalS={totalS}
              onEditApplied={handleEditApplied}
              onStyleApplied={handleStyleApplied}
              onCutToClip={handleCutToClip}
            />
          </div>
        </FadeUp>
      </div>

      <ExportModal
        open={expOpen}
        onClose={() => setExpOpen(false)}
        sequence={sequence}
        sourceUrl={videoUrl}
        sourceId={projectId || 'main'}
        projectName={projectName}
      />
      <DebugHud projectId={projectId} />
    </div>
  );
}
