'use client';

/**
 * 카테고리 이름 표시 i18n 헬퍼 (Stage 5).
 *
 * 'cat-default' 시드 카테고리는 store/DB 에 영어 'default' 저장하고 표시 시점에
 * useCategoryDisplay() 가 locale 별 자연어로 매핑. 사용자가 직접 만든 카테고리는
 * 입력 그대로 표시 (locale 무관).
 */

import {useTranslations} from 'next-intl';
import type {Category} from './domain/types';

export function useCategoryDisplay(): (c: Category) => string {
  const t = useTranslations();
  return (c: Category): string => {
    if (c.id === 'cat-default') return t('category.defaultName');
    return c.name;
  };
}
