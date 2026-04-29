'use client';

/**
 * 카테고리 이름 표시 i18n 헬퍼 (Stage 5).
 *
 * DB 시드 default 카테고리는 영어 'default' name 으로 저장 → 표시 시점에 locale 별
 * 자연어로 매핑. 사용자가 직접 만든 카테고리는 입력 그대로 표시 (locale 무관).
 *
 * Track 1 fix (2026-04-29): id 기반 매칭(`'cat-default'`) → name 기반('default') 전환.
 * categories.ts listCategories 가 user별 unique id (`cat-${randomUUID()}`) 로 시드하므로
 * id 매칭 불가. (user_id, name) UNIQUE INDEX 가 'default' name 중복을 막아 정확.
 */

import {useTranslations} from 'next-intl';
import type {Category} from './domain/types';

export function useCategoryDisplay(): (c: Category) => string {
  const t = useTranslations();
  return (c: Category): string => {
    if (c.name === 'default') return t('category.defaultName');
    return c.name;
  };
}
