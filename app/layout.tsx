import type {Metadata} from 'next';
import {NextIntlClientProvider} from 'next-intl';
import {getLocale, getMessages} from 'next-intl/server';
import {Header} from '@/components/Header';
import {JwtCookieRefresher} from '@/components/JwtCookieRefresher';
import './globals.css';

export const metadata: Metadata = {
  title: 'plan1 · cofounder',
  description: 'Personal schedule manager · cascade · split · timer · 11 languages'
};

const RTL_LOCALES = new Set(['ar']);

export default async function RootLayout({
  children
}: Readonly<{children: React.ReactNode}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
  return (
    <html lang={locale} dir={dir}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {/* PLAN1-JWT-REFRESHER-20260508: cofounder_jwt 1h 만료 영역 fix.
              portal home 만 mount 하던 JwtCookieRefresher 를 sub-project (plan1) 에도 박음.
              매 page navigate 시 portal refresh-jwt 호출 → Better Auth session 살아있으면
              cofounder_jwt 자동 갱신 → middleware self-heal redirect chain 차단 (사용자 깜빡임). */}
          <JwtCookieRefresher />
          <Header />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
