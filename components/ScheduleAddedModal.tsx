'use client';

import {useEffect} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {pad2} from '@/lib/date-format';

/**
 * 등록 confirmation modal — 새 스케줄 추가 직후 2초 자동 fade out.
 * (PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #13 · Q-NEW7 a · Q-NEW13 a)
 *
 * 동작:
 *   - store.lastAddedSchedule 가 set 되면 modal 표시
 *   - 2초 후 자동 clearLastAddedSchedule 호출 → modal hidden
 *   - 등록된 schedule 정보 (title · 시각 · 카테고리) 표시
 *
 * a11y:
 *   - role="dialog" aria-live="polite" — SR announcement
 *   - focus 영향 X (background 영역 그대로)
 *   - 단순 fade out · keyboard 영향 없음
 */
export function ScheduleAddedModal() {
  const t = useTranslations();
  const lastAdded = useAppStore(s => s.lastAddedSchedule);
  const clearLastAddedSchedule = useAppStore(s => s.clearLastAddedSchedule);
  const categories = useAppStore(s => s.categories);

  useEffect(() => {
    if (!lastAdded) return;
    const timer = setTimeout(() => clearLastAddedSchedule(), 2000);
    return () => clearTimeout(timer);
  }, [lastAdded, clearLastAddedSchedule]);

  if (!lastAdded) return null;

  const startDate = new Date(lastAdded.startAt);
  const endDate = new Date(lastAdded.startAt + lastAdded.durationMin * 60_000);
  const cat = categories.find(c => c.id === lastAdded.categoryId);

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-[rgba(7,8,10,0.4)] pointer-events-none"
      role="dialog"
      aria-live="polite"
      aria-modal="false"
    >
      {/* inner box 도 pointer-events-none — click intercept 차단 (mutation E2E cleanup step 통과 의무) */}
      <div className="rounded-none border border-success bg-panel px-6 py-4 shadow-lg pointer-events-none">
        <h3 className="mb-2 text-sm font-semibold text-success font-mono text-center">
          {t('confirmation.scheduleAdded')}
        </h3>
        <div className="space-y-1 text-xs font-mono text-txt">
          <div className="flex items-center gap-2">
            {cat && (
              <span
                className="inline-block h-2 w-2 rounded-none"
                style={{backgroundColor: cat.color}}
              />
            )}
            <span className="font-medium">{lastAdded.title}</span>
          </div>
          <div className="text-muted">
            {pad2(startDate.getHours())}:{pad2(startDate.getMinutes())}
            {' → '}
            {pad2(endDate.getHours())}:{pad2(endDate.getMinutes())}
            {' · '}
            {lastAdded.durationMin} min
          </div>
        </div>
      </div>
    </div>
  );
}
