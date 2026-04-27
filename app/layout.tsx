import type {Metadata} from 'next';
import {NextIntlClientProvider} from 'next-intl';
import {getLocale, getMessages} from 'next-intl/server';
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
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
