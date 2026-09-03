'use client';
import React from 'react';
import { Mic, Play, User, Sliders, Sparkles } from 'lucide-react';
import { Check } from 'lucide-react';

const editTypes = [
  { id: 'shortform',    icon: Sliders,   title: 'Short-form clip', subtitle: 'TikTok, Reels, Shorts' },
  { id: 'youtube',      icon: Play,      title: 'YouTube video',   subtitle: 'Long-form polished edit' },
  { id: 'podcast',      icon: Mic,       title: 'Podcast',         subtitle: 'Multi-speaker conversation' },
  { id: 'talkinghead',  icon: User,      title: 'Talking head',    subtitle: 'Clean creator edit' },
  { id: 'custom',       icon: Sparkles,  title: 'Custom',          subtitle: 'Tell Modaya what to do' },
];

export function EditTypeSelector({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {editTypes.map(type => {
        const Icon = type.icon;
        const isSelected = selected === type.id;
        return (
          <button
            key={type.id}
            onClick={() => onSelect(type.id)}
            style={{
              position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 10, padding: 16, borderRadius: 16, border: 'none', textAlign: 'left', cursor: 'pointer',
              background: isSelected ? 'rgba(255,255,255,0.05)' : '#111111',
              border2: isSelected ? '1px solid rgba(255,255,255,0.4)' : '1px solid #242424',
              outline: isSelected ? '1px solid rgba(255,255,255,0.4)' : '1px solid #242424',
              boxShadow: isSelected ? '0 0 10px rgba(255,255,255,0.15)' : 'none',
              transform: 'translateY(0)',
              transition: 'all 150ms ease',
            } as React.CSSProperties}
            onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.outline = '1px solid #333'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
            onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.outline = '1px solid #242424'; e.currentTarget.style.transform = ''; } }}
          >
            {isSelected && (
              <div style={{
                position: 'absolute', top: 10, right: 10,
                width: 16, height: 16, borderRadius: '50%', background: '#FAFAFA',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'scale-in 0.2s cubic-bezier(0.22,1,0.36,1)',
              }}>
                <Check size={9} strokeWidth={3} style={{ color: '#050505' }} />
              </div>
            )}

            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isSelected ? 'rgba(255,255,255,0.15)' : '#181818',
              border: isSelected ? 'none' : '1px solid #242424',
            }}>
              <Icon size={16} style={{ color: isSelected ? '#FAFAFA' : '#A1A1A1' }} />
            </div>

            <div>
              <p style={{ fontFamily: "'Uni Neue','Manrope',system-ui,-apple-system,sans-serif", fontWeight: 650, fontSize: 13, color: isSelected ? '#FFFFFF' : '#A1A1A1', margin: '0 0 2px' }}>
                {type.title}
              </p>
              <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{type.subtitle}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
