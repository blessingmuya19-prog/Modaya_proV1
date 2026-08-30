'use client';
import { useEffect } from 'react';

export function ScrollToTop() {
  useEffect(() => {
    // Disable browser scroll restoration and always start at top
    if (typeof window !== 'undefined') {
      window.history.scrollRestoration = 'manual';
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, []);
  return null;
}
