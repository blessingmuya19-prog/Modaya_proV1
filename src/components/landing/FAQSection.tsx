'use client';
import React, { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import { ACCENT, ACCENT_SOFT, ACCENT_BRD, INK, FONT_D, Section } from './kit';

const faqs = [
  {
    q: 'Does Modaya generate AI video?',
    a: 'No — that\u2019s the point. Modaya edits the footage you upload. It never invents frames, voices, avatars or scenes. Every frame in the export came from your recording.',
  },
  {
    q: 'What file formats are supported?',
    a: 'Anything the browser can decode — MP4, MOV and WebM work everywhere. Footage is held locally plus a durable server copy when storage is configured. Reference videos can also be fetched from a direct link (platform watch pages are declined rather than scraped).',
  },
  {
    q: 'How does the AI know what to cut?',
    a: 'It measures your footage first: loudness, beat onsets, silences, per-second interest, shot changes and motion. Then it applies your instruction (or the reference style profile) to those measurements. Each decision is shown on the edit map with the reason.',
  },
  {
    q: 'Can I adjust what the AI did?',
    a: 'Yes — in plain words. "Cut it harder", "keep that section", "move the captions up", "undo that". Every change is a new version you can restore, and nothing gets overwritten.',
  },
  {
    q: 'Does it need an AI key?',
    a: 'For free-form instructions, yes — Groq, Gemini, OpenRouter, Cloudflare or local Ollama. Without one, Modaya still cuts dead air, finds highlights, adds captions and answers the set vocabulary — and says plainly that it\u2019s running without a model.',
  },
  {
    q: 'What export options exist?',
    a: 'MP4 (H.264) or WebM, 1080p / 720p / 480p, selectable frame rate and bitrate, in the aspect ratio of the edit. Export records exactly what the preview shows — zooms, transitions, captions and grade included. Timeline files (EDL/FCPXML) are planned, not shipped.',
  },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section grid={false} pad={false}>
      <div style={{ padding: 'clamp(64px, 8vw, 110px) clamp(18px, 4vw, 40px)', maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(0, 2fr)', gap: 48 }}>
        <div>
          <p style={{ fontSize: 11, color: ACCENT, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }}>FAQ</p>
          <h2 style={{ fontFamily: FONT_D, fontWeight: 800, fontSize: 'clamp(26px, 4vw, 42px)', letterSpacing: '-0.04em', lineHeight: 1.08, color: INK.txt, margin: 0 }}>
            Honest<br />answers.
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {faqs.map((faq, i) => (
            <div key={i} style={{
              border: `1px solid ${open === i ? ACCENT_BRD : INK.line}`,
              borderRadius: 16, background: open === i ? INK.card2 : INK.card,
              overflow: 'hidden', transition: 'all 150ms ease',
            }}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 20, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ fontSize: 14, fontWeight: 500, color: INK.txt }}>{faq.q}</span>
                {open === i
                  ? <Minus size={16} style={{ color: ACCENT, flexShrink: 0 }} />
                  : <Plus size={16} style={{ color: INK.mut, flexShrink: 0 }} />
                }
              </button>
              {open === i && (
                <div style={{ padding: '0 20px 20px', animation: 'slide-up 0.2s ease' }}>
                  <p style={{ fontSize: 13.5, color: INK.sec, lineHeight: 1.75, margin: 0 }}>{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
