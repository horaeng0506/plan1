'use client';

import {useSyncExternalStore} from 'react';
import {
  dismissToast,
  getToastsServerSnapshot,
  getToastsSnapshot,
  subscribeToasts,
  type Toast
} from '@/lib/toast';

const SEVERITY_CLASS: Record<Toast['severity'], string> = {
  info: 'border-line bg-panel text-txt',
  warn: 'border-warn bg-panel text-warn',
  error: 'border-danger bg-[rgba(224,108,117,0.10)] text-danger'
};

export function ToastContainer() {
  // SSR snapshot = EMPTY (frozen) → hydration mismatch 안전.
  const toasts = useSyncExternalStore(
    subscribeToasts,
    getToastsSnapshot,
    getToastsServerSnapshot
  );

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[60] flex max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-none border px-3 py-2 text-xs font-mono shadow-sm ${
            SEVERITY_CLASS[t.severity]
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="flex-1 break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="text-xs opacity-70 hover:opacity-100"
              aria-label="dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
