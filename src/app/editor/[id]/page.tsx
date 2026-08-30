'use client';
import React, { useState } from 'react';
import { EditorTopbar } from '@/components/editor/EditorTopbar';
import { AIEditPanel } from '@/components/editor/AIEditPanel';
import { VideoPlayer } from '@/components/editor/VideoPlayer';
import { Timeline } from '@/components/editor/Timeline';
import { useToast } from '@/components/ui/Toast';

const aiMessages: Record<string, string> = {
  tighten:  'Tightening edit — removing unnecessary pauses...',
  cleanup:  'Cleaning up — removing mistakes and repetitions...',
  faster:   'Increasing pacing...',
  moments:  'Finding the strongest moments...',
  reframe:  'Reframing for 9:16...',
  captions: 'Generating captions...',
  custom:   'Applying your custom edit...',
};

export default function EditorPage() {
  const { addToast } = useToast();
  const [aiProcessing, setAiProcessing] = useState(false);
  const [lastAction, setLastAction] = useState('tighten');

  const handleAIAction = (actionId: string) => {
    setAiProcessing(true);
    setLastAction(actionId);
    addToast(aiMessages[actionId] || 'Applying AI edit...', 'info');
    setTimeout(() => {
      setAiProcessing(false);
      addToast('AI edit applied. Review the changes in the timeline.', 'success');
    }, 2500);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#050505', overflow: 'hidden' }}>
      <EditorTopbar projectName="Podcast Episode 14" />

      {/* AI processing banner */}
      {aiProcessing && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '8px', background: 'rgba(79,140,255,0.04)', borderBottom: '1px solid rgba(79,140,255,0.15)',
          animation: 'fade-in 0.2s ease', flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4F8CFF', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
          <span style={{ fontSize: 12, color: '#4F8CFF', fontWeight: 600 }}>{aiMessages[lastAction]}</span>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <AIEditPanel onAction={handleAIAction} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <VideoPlayer />
          <Timeline />
        </div>
      </div>
    </div>
  );
}
