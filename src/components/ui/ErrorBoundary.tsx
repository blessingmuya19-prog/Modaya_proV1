'use client';
import React, { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          minHeight: '100vh',
          background: '#09090B',
          color: '#FAFAFA',
          fontFamily: "'Inter',system-ui,-apple-system,sans-serif",
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
        }}>
          <div style={{
            maxWidth: 460,
            background: '#18181B',
            border: '1px solid #27272A',
            borderRadius: 16,
            padding: 32,
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#EF4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: 20,
              fontWeight: 700,
            }}>
              !
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Something went wrong</h2>
            <p style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.5, margin: '0 0 20px' }}>
              {this.state.error?.message || 'A rendering error occurred while displaying this view.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  this.props.onReset?.();
                }}
                style={{
                  background: '#FAFAFA',
                  color: '#09090B',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                style={{
                  background: 'transparent',
                  color: '#A1A1AA',
                  border: '1px solid #27272A',
                  borderRadius: 8,
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Go to Projects
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
