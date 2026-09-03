'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const F = "'Inter',system-ui,-apple-system,sans-serif";
const DURATION = 4000;

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: string; message: string; type: ToastType; }
interface ToastContextType { addToast: (message: string, type?: ToastType) => void; }

const ToastContext = createContext<ToastContextType>({ addToast: () => {} });
export function useToast() { return useContext(ToastContext); }

const ICON = {
  success: <CheckCircle size={15} style={{ color: '#4ade80', flexShrink: 0 }} />,
  error:   <AlertCircle size={15} style={{ color: '#f87171', flexShrink: 0 }} />,
  info:    <Info        size={15} style={{ color: '#FAFAFA', flexShrink: 0 }} />,
};
const ACCENT = { success: '#4ade80', error: '#f87171', info: '#FAFAFA' };

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Auto-dismiss after DURATION
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(onDismiss, 280);
    }, DURATION);
    return () => clearTimeout(timerRef.current);
  }, [onDismiss]);

  const dismiss = () => {
    clearTimeout(timerRef.current);
    setExiting(true);
    setTimeout(onDismiss, 280);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: '#111',
      border: `1px solid #1e1e1e`,
      borderLeft: `3px solid ${ACCENT[toast.type]}`,
      borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
      minWidth: 280, maxWidth: 380,
      overflow: 'hidden',
      animation: exiting
        ? 'toast-out 280ms cubic-bezier(0.55,0,1,0.45) forwards'
        : 'toast-in 320ms cubic-bezier(0.22,1,0.36,1)',
      fontFamily: F,
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px 11px 14px' }}>
        <div style={{ paddingTop: 1 }}>{ICON[toast.type]}</div>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#F5F7FA', flex: 1, lineHeight: 1.45, letterSpacing: '-0.01em' }}>
          {toast.message}
        </span>
        <button
          onClick={dismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4D5664',
            display: 'flex', padding: '1px 0 0', flexShrink: 0, transition: 'color 120ms' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#737D8D'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#4D5664'; }}
        ><X size={13} /></button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: '#1a1a1a', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', inset: 0, background: ACCENT[toast.type], opacity: 0.5,
          transformOrigin: 'left',
          animation: `toast-progress ${DURATION}ms linear forwards`,
        }} />
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(p => [...p, { id, message, type }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(p => p.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column-reverse', gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(24px) scale(0.96); }
          to   { opacity: 1; transform: translateX(0)    scale(1); }
        }
        @keyframes toast-out {
          from { opacity: 1; transform: translateX(0)    scale(1);    max-height: 80px; }
          to   { opacity: 0; transform: translateX(16px) scale(0.94); max-height: 0;   }
        }
        @keyframes toast-progress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
