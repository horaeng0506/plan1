'use client';

import {useSyncExternalStore} from 'react';
import {
  dismissToast,
  getToastsServerSnapshot,
  getToastsSnapshot,
  subscribeToasts,
  type Toast
} from '@/lib/toast';

// ui-critic Critical: info 가 border-line/text-txt 였던 색상 채널 누락 → border-info/text-info.
const SEVERITY_CLASS: Record<Toast['severity'], string> = {
  info: 'border-info bg-panel text-info',
  warn: 'border-warn bg-panel text-warn',
  error: 'border-danger bg-[rgba(224,108,117,0.10)] text-danger'
};

const SEVERITY_ROLE: Record<Toast['severity'], 'status' | 'alert'> = {
  info: 'status',
  warn: 'status',
  error: 'alert'
};

const SEVERITY_ARIA_LIVE: Record<Toast['severity'], 'polite' | 'assertive'> = {
  info: 'polite',
  warn: 'polite',
  error: 'assertive'
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
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex max-w-sm flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          role={SEVERITY_ROLE[t.severity]}
          aria-live={SEVERITY_ARIA_LIVE[t.severity]}
          className={`pointer-events-auto rounded-none border px-3 py-2 text-xs font-mono shadow-sm ${
            SEVERITY_CLASS[t.severity]
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="flex-1 break-words">{t.message}</span>
            {/* ui-critic Critical: hit area WCAG 24×24px 미달 → -m-1 p-2 로 negative margin
                + padding 로 시각 위치 유지하면서 24×24px 이상 hit area 확보. aria-label 추가. */}
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="-m-1 p-1 text-xs leading-none opacity-70 hover:opacity-100"
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
