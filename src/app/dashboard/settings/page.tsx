'use client';
import React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#111111', border: '1px solid #242424', borderRadius: 16, padding: 20, marginBottom: 16 }}>
      <h3 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 650, fontSize: 15, letterSpacing: '-0.02em', color: '#FFFFFF', margin: '0 0 16px' }}>{title}</h3>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div style={{ padding: '32px', maxWidth: 560 }}>
      <h1 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 28, letterSpacing: '-0.04em', color: '#FFFFFF', margin: '0 0 4px' }}>Settings</h1>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 32px' }}>Manage your account and preferences.</p>

      <SectionCard title="Profile">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input label="Display name" defaultValue="My Account" />
          <Input label="Email" defaultValue="user@example.com" type="email" />
          <button style={{
            alignSelf: 'flex-start', padding: '8px 16px', fontSize: 12, fontWeight: 600,
            background: '#181818', color: '#FFFFFF', border: '1px solid #242424',
            borderRadius: 8, cursor: 'pointer', transition: 'all 150ms',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#242424'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#181818'; }}
          >
            Save changes
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Plan">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: '#A1A1A1' }}>Current plan</span>
          <Badge variant="accent">Creator</Badge>
        </div>
        <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>20 videos/month · 1080p export · 60 min footage</p>
        <button style={{
          padding: '9px 18px', fontSize: 13, fontWeight: 600,
          background: '#4F8CFF', color: '#050505', border: 'none',
          borderRadius: 8, cursor: 'pointer', transition: 'all 150ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#6EA3FF'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#4F8CFF'; }}
        >
          Upgrade to Pro
        </button>
      </SectionCard>

      <SectionCard title="Default export settings">
        {[['Resolution', '1080p'], ['Format', 'MP4'], ['Aspect ratio', '16:9']].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: '#A1A1A1' }}>{k}</span>
            <span style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </SectionCard>
    </div>
  );
}
