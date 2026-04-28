import {getRequestConfig} from 'next-intl/server';
import {cookies} from 'next/headers';
import {routing} from './routing';

export default getRequestConfig(async () => {
  // Next.js 15+ async request APIs (Stage 8.A · 2026-04-28)
  const cookieStore = await cookies();
  const requested = cookieStore.get('NEXT_LOCALE')?.value;
  const locale = (routing.locales as readonly string[]).includes(requested ?? '')
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
