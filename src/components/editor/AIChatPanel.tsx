'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Send, Scissors, Zap, Star, AlignLeft, RotateCcw, X } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  status?: 'done' | 'processing';
  action?: string;
}

const QUICK = [
  { icon: Scissors, label: 'Tighten it',     prompt: 'Tighten the edit — remove all unnecessary pauses and dead air.' },
  { icon: Zap,      label: 'Make it faster',  prompt: 'Increase the overall pacing, make it feel more energetic.' },
  { icon: Star,     label: 'Best moments',    prompt: 'Find the strongest 90 seconds and cut everything else.' },
  { icon: AlignLeft,label: 'Add captions',    prompt: 'Add accurate captions to the full video.' },
];

const AI_REPLIES: Record<string, string> = {
  default: "Done. I removed 14 pauses and 3 filler sections — cut 48 seconds total. The pacing feels a lot tighter now. Want me to adjust anything?",
  tighten: "Done. Removed 14 dead-air sections totalling 48 seconds. The edit runs 3:32 → 2:44. Want me to go further?",
  faster:  "Applied. Compressed silence between sentences and sped up natural gaps. Estimated 22% faster overall. Happy with the feel?",
  moments: "Found 3 standout moments at 0:28, 1:14 and 2:05. I've trimmed everything else — final cut is 1:47. Want to restore any section?",
  captions:"Captions added. 94% accuracy on transcript. A few spots flagged for review — they're marked in yellow on the timeline.",
};

function getReply(prompt: string): string {
  if (prompt.toLowerCase().includes('tighten') || prompt.toLowerCase().includes('pause')) return AI_REPLIES.tighten;
  if (prompt.toLowerCase().includes('fast') || prompt.toLowerCase().includes('pac')) return AI_REPLIES.faster;
  if (prompt.toLowerCase().includes('best') || prompt.toLowerCase().includes('moment')) return AI_REPLIES.moments;
  if (prompt.toLowerCase().includes('caption')) return AI_REPLIES.captions;
  return AI_REPLIES.default;
}

export function AIChatPanel({ onAction }: { onAction: (id: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'ai',
      text: "I've analysed your footage. It's 5:47 long — I can see 4 sections that could be cut. What would you like me to do?",
      status: 'done',
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    onAction('custom');

    setTimeout(() => {
      setIsTyping(false);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: getReply(text),
        status: 'done',
      };
      setMessages(prev => [...prev, aiMsg]);
    }, 1800);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <div style={{
      width: 280, flexShrink: 0,
      background: '#070707', borderLeft: '1px solid #111',
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #111', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#FAFAFA', boxShadow: '0 0 6px rgba(255,255,255,0.6)' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#A1A1A1', letterSpacing: '-0.01em' }}>AI Assistant</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 9999, padding: '2px 8px' }}>
          <span style={{ fontSize: 10, color: '#FAFAFA', fontWeight: 600 }}>v3</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'ai' && (
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 5, flexShrink: 0 }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#FAFAFA' }}>AI</span>
              </div>
            )}
            <div style={{
              maxWidth: '90%', padding: '10px 13px', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '4px 12px 12px 12px',
              background: msg.role === 'user' ? '#FAFAFA' : '#0e0e0e',
              border: msg.role === 'user' ? 'none' : '1px solid #1a1a1a',
              fontSize: 13, color: msg.role === 'user' ? '#fff' : '#A1A1A1',
              lineHeight: 1.65,
            }}>
              {msg.text}
            </div>
            {msg.role === 'ai' && msg.status === 'done' && (
              <button style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#2a2a2a', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#555'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#2a2a2a'; }}
                onClick={() => {
                  setMessages(prev => prev.filter(m => m.id !== msg.id));
                  onAction('tighten');
                }}
              >
                <RotateCcw size={9} /> Undo this edit
              </button>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: '#FAFAFA' }}>AI</span>
            </div>
            <div style={{ padding: '10px 14px', background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: '4px 12px 12px 12px', display: 'flex', alignItems: 'center', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#333', animation: `pulse-dot 1.2s ease-in-out ${i * 200}ms infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #0e0e0e', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {QUICK.map((q, i) => (
          <button key={i} onClick={() => send(q.prompt)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '5px 9px', fontSize: 11, color: '#444',
            background: 'transparent', border: '1px solid #141414',
            borderRadius: 9999, cursor: 'pointer', transition: 'all 150ms',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#A1A1A1'; e.currentTarget.style.borderColor = '#2a2a2a'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = '#141414'; }}
          >
            <q.icon size={10} /> {q.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ padding: '8px 12px 14px', borderTop: '1px solid #0e0e0e', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          background: '#0a0a0a', border: '1px solid #1a1a1a',
          borderRadius: 12, padding: '8px 10px 8px 14px',
          transition: 'border-color 150ms',
        }}
          onFocusCapture={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; }}
          onBlurCapture={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1a1a1a'; }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Tell AI what to do..."
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 13, color: '#FFFFFF', fontFamily: "'Inter',system-ui,-apple-system,sans-serif",
              resize: 'none', lineHeight: 1.5, maxHeight: 80, overflowY: 'auto',
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || isTyping}
            style={{
              width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: input.trim() && !isTyping ? '#FAFAFA' : '#141414',
              border: 'none', cursor: input.trim() && !isTyping ? 'pointer' : 'not-allowed',
              flexShrink: 0, transition: 'all 150ms',
            }}
          >
            <Send size={12} color={input.trim() && !isTyping ? '#fff' : '#333'} />
          </button>
        </div>
        <p style={{ fontSize: 10, color: '#222', margin: '6px 0 0', textAlign: 'center' }}>Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
