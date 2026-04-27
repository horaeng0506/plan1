/**
 * Escape 키로 모달 닫기 hook (Stage 4d-C a11y).
 *
 * window keydown 리스너 등록 + Esc 감지 시 onClose. mount/unmount cleanup.
 * `enabled=false` 로 임시 비활성 가능 (busy 상태 등).
 */

import {useEffect} from 'react';

export function useEscapeKey(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, enabled]);
}
