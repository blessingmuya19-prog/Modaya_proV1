'use client';
import React, { useState } from 'react';
import { Plus, Minus } from 'lucide-react';

const faqs = [
  { q: 'Does Modaya generate AI video?', a: 'No. Modaya edits your existing footage. It does not generate synthetic video, images, or AI avatars. Every frame in your export came from your original recording.' },
  { q: 'What file formats are supported?', a: 'MP4, MOV, and WebM are fully supported. Files can be uploaded from your computer or linked from cloud storage.' },
  { q: 'How does the AI know what to cut?', a: 'Modaya transcribes your audio, detects speakers, analyzes pacing, identifies filler words and long pauses, and uses your editing prompt as creative direction. Every AI decision is shown to you with a reason.' },
  { q: 'Can I adjust what the AI did?', a: "Yes. The editor shows every AI cut with its reasoning. You can accept, reject, or refine any cut. You can also use the AI panel to apply additional edits or describe changes in natural language." },
  { q: 'How long does processing take?', a: "Most videos under 30 minutes process in under 2 minutes. Longer footage takes a few minutes more. You'll see real-time progress during analysis." },
  { q: 'What export options are available?', a: 'Export in 1080p or 4K, MP4 format, in any aspect ratio: 16:9, 9:16, or 1:1. Pro plans include higher quality settings.' },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="section-pad" style={{ background: 'rgba(5,5,5,0.93)', backdropFilter: 'blur(2px)', paddingLeft: 24, paddingRight: 24 }}>
      <div className="faq-grid">
        <div style={{ marginBottom: 48 }}>
          <p style={{ fontSize: 11, color: '#737D8D', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 16 }}>FAQ</p>
          <h2 style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 'clamp(24px,4vw,40px)', letterSpacing: '-0.04em', lineHeight: 1.1, color: '#FFFFFF', margin: 0 }}>
            Common questions.
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {faqs.map((faq, i) => (
            <div key={i} style={{
              border: `1px solid ${open === i ? '#1a1a1a' : '#141414'}`,
              borderRadius: 16,
              background: open === i ? '#111111' : '#0A0A0A',
              overflow: 'hidden',
              transition: 'all 150ms ease',
            }}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 16,
                  padding: 20, background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF' }}>{faq.q}</span>
                {open === i
                  ? <Minus size={16} style={{ color: '#737D8D', flexShrink: 0 }} />
                  : <Plus  size={16} style={{ color: '#737D8D', flexShrink: 0 }} />
                }
              </button>
              {open === i && (
                <div style={{ padding: '0 20px 20px', animation: 'slide-up 0.2s ease' }}>
                  <p style={{ fontSize: 14, color: '#A1A1A1', lineHeight: 1.7, margin: 0 }}>{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
