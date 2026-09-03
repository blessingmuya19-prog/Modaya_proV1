'use client';
import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar';

const steps = [
  { id: 'transcribe', label: 'Transcribing audio',       duration: 2200 },
  { id: 'speakers',   label: 'Detecting speakers',        duration: 1600 },
  { id: 'moments',    label: 'Finding important moments', duration: 2400 },
  { id: 'pacing',     label: 'Analyzing pacing',          duration: 1800 },
  { id: 'edit',       label: 'Building your edit',        duration: 3200 },
  { id: 'render',     label: 'Rendering',                 duration: 0 },
];

export function ProcessingScreen({ filename, onComplete }: { filename?: string; onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let stepIndex = 0; let progressValue = 0;

    const advanceStep = () => {
      if (stepIndex >= steps.length - 1) {
        setCurrentStep(steps.length - 1);
        setCompletedSteps(new Set(Array.from({ length: steps.length }, (_, i) => i)));
        setProgress(100);
        setTimeout(onComplete, 1200);
        return;
      }
      const current = steps[stepIndex];
      setCurrentStep(stepIndex);
      const targetProgress = ((stepIndex + 1) / steps.length) * 100;
      const progressStep = (targetProgress - progressValue) / (current.duration / 50);
      const progressInterval = setInterval(() => {
        progressValue += progressStep;
        setProgress(Math.min(progressValue, targetProgress));
        if (progressValue >= targetProgress) clearInterval(progressInterval);
      }, 50);
      setTimeout(() => {
        setCompletedSteps(prev => new Set([...prev, stepIndex]));
        stepIndex++;
        advanceStep();
      }, current.duration);
    };

    const timeout = setTimeout(advanceStep, 400);
    return () => clearTimeout(timeout);
  }, [onComplete]);

  return (
    <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FAFAFA', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
            <span style={{ fontSize: 10, color: '#FAFAFA', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace" }}>AI is working</span>
          </div>
          <h2 style={{ fontFamily: "'Satoshi','Inter',system-ui,-apple-system,sans-serif", fontWeight: 700, fontSize: 28, letterSpacing: '-0.04em', lineHeight: 1.1, color: '#FFFFFF', margin: '0 0 6px' }}>
            Understanding your video
          </h2>
          {filename && <p style={{ fontSize: 12.5, color: '#888', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace" }}>{filename}</p>}
        </div>

        <ProgressBar value={progress} style={{ marginBottom: 40 }} />

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {steps.map((step, i) => {
            const isDone = completedSteps.has(i);
            const isActive = currentStep === i && !isDone;
            const isPending = !isDone && !isActive;

            return (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0' }}>
                {/* Icon */}
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isDone ? '#FAFAFA' : 'transparent',
                  border: isDone ? 'none' : isActive ? '2px solid #FAFAFA' : '1px solid #242424',
                  transition: 'all 300ms ease',
                }}>
                  {isDone
                    ? <Check size={12} strokeWidth={3} style={{ color: '#050505', animation: 'scale-in 0.3s ease' }} />
                    : isActive
                      ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FAFAFA', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
                      : <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#242424' }} />
                  }
                </div>

                <span style={{
                  fontSize: 14, transition: 'color 200ms',
                  color: isDone ? '#666' : isActive ? '#FFFFFF' : '#444',
                  textDecoration: isDone ? 'line-through' : 'none',
                }}>
                  {step.label}
                </span>

                {isActive && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, color: '#FAFAFA', fontWeight: 600,
                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                    padding: '2px 8px', borderRadius: 9999,
                  }}>
                    In progress
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 11.5, color: '#666', textAlign: 'center', marginTop: 40, fontFamily: "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace", letterSpacing: '0.01em' }}>
          Average processing time: 90 seconds
        </p>
      </div>
    </div>
  );
}
