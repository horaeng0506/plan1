import {defineRouting} from 'next-intl/routing';

// Phase 2.5 대상 11 언어. portal/copymaker1 통일.
// 대상 선정 근거: wiki/projects/cofounder-portal/PRD.md § F2 · cofounder-portal.md § 4 Phase 2.5
export const routing = defineRouting({
  locales: ['en', 'es', 'pt', 'fr', 'de', 'ja', 'zh-CN', 'ru', 'ar', 'hi', 'ko'],
  defaultLocale: 'en',
  localePrefix: 'never'
});
