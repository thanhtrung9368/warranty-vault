'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      // SW can confuse HMR in dev — only register in prod build
      return;
    }
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => void 0);
  }, []);
  return null;
}
