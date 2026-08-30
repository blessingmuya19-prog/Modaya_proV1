'use client';
import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

interface Toast { id: string; message: string; type: 'success' | 'error' | 'info'; }
interface ToastContextType { addToast: (message: string, type?: 'success' | 'error' | 'info') => void; }

const ToastContext = createContext<ToastContextType>({ addToast: () => {} });
export function useToast() { return useContext(ToastContext); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  const icons = {
    success: <CheckCircle size={16} style={{ color: '#4ade80' }} />,
    error:   <AlertCircle size={16} style={{ color: '#f87171' }} />,
    info:    <Info        size={16} style={{ color: '#A1A1A1' }} />,
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            background: '#181818',
            border: '1px solid #242424',
            borderRadius: 10,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            minWidth: 260, maxWidth: 380,
            animation: 'slide-up 0.3s cubic-bezier(0.22,1,0.36,1)',
          }}>
            {icons[t.type]}
            <span style={{ fontSize: 13, color: '#FFFFFF', flex: 1 }}>{t.message}</span>
            <button
              onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', display: 'flex', padding: 0 }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
