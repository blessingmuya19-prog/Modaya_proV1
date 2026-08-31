'use client';
import { useState, useEffect, useCallback } from 'react';

export interface AuthUser {
  id:            string;
  email:         string;
  name:          string;
  plan:          string;
  storageUsedMb: number;
  createdAt:     string;
}

interface AuthState {
  user:    AuthUser | null;
  loading: boolean;
}

// Simple client-side API wrappers

export async function apiRegister(name: string, email: string, password: string) {
  const res = await fetch('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  return res.json();
}

export async function apiLogin(email: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function apiLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function apiMe(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  const data = await res.json();
  return data.user ?? null;
}

export function useAuth(): AuthState & { refetch: () => void } {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const refetch = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    const user = await apiMe();
    setState({ user, loading: false });
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { ...state, refetch };
}
