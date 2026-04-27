import {getRequestConfig} from 'next-intl/server';
import {cookies} from 'next/headers';
import {routing} from './routing';

export default getRequestConfig(async () => {
  const cookieStore = cookies();
  const requested = cookieStore.get('NEXT_LOCALE')?.value;
  const locale = (routing.locales as readonly string[]).includes(requested ?? '')
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
