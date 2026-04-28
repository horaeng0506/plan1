'use client';

import {useLocale, useTranslations} from 'next-intl';
import {useRouter} from 'next/navigation';
import {useTransition} from 'react';

// 11개 언어 native 표시명. portal 패턴과 다른 점:
// 사용자의 현재 locale 무관하게 각 언어를 그 언어의 native form 으로 표시 (Wikipedia 패턴).
// 자동 번역 워크플로우가 messages/*.json 의 locale 라벨을 건드리지 않게 하는 장점.
const LOCALE_NATIVE: Record<string, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  'zh-CN': '中文',
  ru: 'Русский',
  ar: 'العربية',
  hi: 'हिन्दी',
  ko: '한국어'
};

const LOCALES = Object.keys(LOCALE_NATIVE);

export function LocaleSwitcher() {
  const t = useTranslations('topbar');
  const currentLocale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function setLocale(nextLocale: string) {
    // portal 와 origin 공유 (cofounder.co.kr) 라 Path=/ 면 portal·plan1 양쪽 적용.
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <select
      aria-label={t('languageLabel')}
      value={currentLocale}
      onChange={e => setLocale(e.target.value)}
      disabled={isPending}
      className="font-mono text-[11px] text-muted bg-transparent border border-line rounded px-2 py-1 hover:text-txt focus:outline-none focus:ring-1 focus:ring-info disabled:opacity-50"
    >
      {LOCALES.map(loc => (
        <option key={loc} value={loc} className="bg-bg text-txt">
          {LOCALE_NATIVE[loc]}
        </option>
      ))}
    </select>
  );
}
