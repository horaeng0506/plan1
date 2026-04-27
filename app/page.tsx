import {getTranslations} from 'next-intl/server';

export default async function Home() {
  const t = await getTranslations();
  return (
    <main className="min-h-screen bg-bg text-txt">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <header className="font-mono text-xs text-muted">
          plan · today · {new Date().toISOString().slice(0, 10)}
        </header>
        <h1 className="text-xl font-mono text-ink">{t('app.title')} · {t('app.tagline')}</h1>
        <p className="font-mono text-sm text-muted">
          Stage 1 골격 · Stage 3 에서 4영역 (week / today / clock / timer) 컴포넌트 이식 예정
        </p>
        <section className="border border-line p-4">
          <h2 className="text-sm font-mono mb-2 text-ink">{t('header.today')}</h2>
          <p className="font-mono text-xs text-muted">today timeline · placeholder · Stage 3</p>
        </section>
        <section className="border border-line p-4">
          <h2 className="text-sm font-mono mb-2 text-ink">{t('header.week')}</h2>
          <p className="font-mono text-xs text-muted">FullCalendar weekly · placeholder · Stage 3</p>
        </section>
        <section className="border border-line p-4">
          <h2 className="text-sm font-mono mb-2 text-ink">{t('header.clock')}</h2>
          <p className="font-mono text-xs text-muted">analog clock · placeholder · Stage 3</p>
        </section>
        <section className="border border-line p-4">
          <h2 className="text-sm font-mono mb-2 text-ink">{t('header.timer')}</h2>
          <p className="font-mono text-xs text-muted">timer (countup / timer1 / countdown) · placeholder · Stage 3</p>
        </section>
      </div>
    </main>
  );
}
