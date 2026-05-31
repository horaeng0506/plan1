'use client';

/**
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 할일 버킷 이름 표시 i18n 헬퍼.
 *
 * default 버킷(defaultKind='now'|'later', name='')은 표시 시점에 i18n 으로 매핑
 *   → task.bucketNow / task.bucketLater (11개 언어 보존).
 * 사용자가 이름을 편집하면 server action 이 defaultKind=null + name=입력값 으로 전환
 *   → 이후 DB name 그대로 표시 (locale 무관).
 */

import {useTranslations} from 'next-intl';
import type {TaskBucketInfo} from './domain/types';

export function useTaskBucketDisplay(): (b: TaskBucketInfo) => string {
  const t = useTranslations();
  return (b: TaskBucketInfo): string => {
    if (b.defaultKind === 'now' && b.name === '') return t('task.bucketNow');
    if (b.defaultKind === 'later' && b.name === '') return t('task.bucketLater');
    return b.name;
  };
}
