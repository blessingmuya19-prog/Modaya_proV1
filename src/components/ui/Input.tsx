'use client';
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export function Input({ label, error, icon, style, ...props }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label style={{ fontSize: 13, color: '#A1A1A1', fontWeight: 500 }}>{label}</label>
      )}
      <div style={{ position: 'relative' }}>
        {icon && (
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#666' }}>
            {icon}
          </span>
        )}
        <input
          style={{
            width: '100%',
            background: '#111111',
            border: `1px solid ${error ? '#7f1d1d' : '#242424'}`,
            borderRadius: 10,
            padding: icon ? '10px 16px 10px 40px' : '10px 16px',
            fontSize: 14,
            color: '#FFFFFF',
            outline: 'none',
            transition: 'border-color 150ms ease',
            ...style,
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#333'; }}
          onBlur={e => { e.currentTarget.style.borderColor = error ? '#7f1d1d' : '#242424'; }}
          placeholder={props.placeholder}
          {...props}
        />
      </div>
      {error && <p style={{ fontSize: 12, color: '#f87171' }}>{error}</p>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, style, ...props }: TextareaProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label style={{ fontSize: 13, color: '#A1A1A1', fontWeight: 500 }}>{label}</label>}
      <textarea
        style={{
          width: '100%',
          background: '#111111',
          border: `1px solid ${error ? '#7f1d1d' : '#242424'}`,
          borderRadius: 10,
          padding: '12px 16px',
          fontSize: 14,
          color: '#FFFFFF',
          outline: 'none',
          resize: 'none',
          transition: 'border-color 150ms ease',
          fontFamily: 'inherit',
          ...style,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = '#333'; }}
        onBlur={e => { e.currentTarget.style.borderColor = error ? '#7f1d1d' : '#242424'; }}
        {...props}
      />
      {error && <p style={{ fontSize: 12, color: '#f87171' }}>{error}</p>}
    </div>
  );
}
