/**
 * 공통 헤더 (Stage 8.F · 2026-04-28).
 *
 * 표시 항목 (cofounder 포털 통일 가이드):
 *   - 좌: `$ cofounder/plan1` Terminal 프롬프트 + portal 복귀 link
 *   - 우: 크레딧 placeholder · LocaleSwitcher · 인증 사용자/로그아웃
 *
 * 디자인 톤: plan1 Terminal (JetBrains Mono · 4채널 토큰).
 * 다른 프로젝트(portal·copymaker1)는 자체 디자인. 표시 항목 set 만 통일.
 *
 * 크레딧: 현재 placeholder (`—`). portal API fetch 는 후속 Stage
 * (cofounder-portal/freemium-economics.md 단가·잔액 정책 참조).
 *
 * 인증: server component 라 `requireUser` 대신 `getCurrentSessionUser` 사용
 * (미인증 시 null 받아 `guest` 표시).
 */

import {getTranslations} from 'next-intl/server';
import {getCurrentSessionUser} from '@/lib/auth-helpers';
import {LocaleSwitcher} from './LocaleSwitcher';

function getPortalUrl(): string {
  // PORTAL_ISSUER 는 next.config.mjs 빌드 가드로 항상 존재 보장.
  return process.env.PORTAL_ISSUER!;
}

export async function Header() {
  const t = await getTranslations('topbar');
  const user = await getCurrentSessionUser();
  const portalUrl = getPortalUrl();
  const portalProjectsUrl = `${portalUrl}/project`;
  // Better Auth 기본 sign-out 엔드포인트. portal 가 노출 안 하면 portal 메인으로 fallback.
  const logoutUrl = `${portalUrl}/api/auth/sign-out`;

  return (
    <header
      role="banner"
      className="border-b border-line bg-panel text-txt"
    >
      <div className="font-mono flex items-center justify-between gap-4 px-4 py-2 text-[12px]">
        {/* 좌: Terminal 프롬프트 + portal 복귀 link */}
        <div className="flex items-center gap-3 min-w-0">
          <a
            href={portalProjectsUrl}
            className="text-muted hover:text-info transition-colors whitespace-nowrap"
            title={t('back')}
          >
            <span aria-hidden>$ </span>cofounder/plan1
          </a>
        </div>

        {/* 우: 크레딧 · 언어 · 사용자/로그아웃 */}
        <div className="flex items-center gap-3">
          <span
            className="text-muted whitespace-nowrap"
            title={t('creditsLabel')}
            aria-label={t('creditsLabel')}
          >
            <span aria-hidden># </span>
            {t('creditsLabel')}: {t('creditsPlaceholder')}
          </span>

          <LocaleSwitcher />

          {user ? (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-muted" aria-hidden>
                #{' '}
              </span>
              <span className="text-txt truncate max-w-[140px]" title={user.email ?? user.id}>
                {user.name || user.email || user.id}
              </span>
              <a
                href={logoutUrl}
                className="text-muted hover:text-danger transition-colors"
              >
                [{t('logout')}]
              </a>
            </span>
          ) : (
            <span className="text-muted whitespace-nowrap">
              <span aria-hidden># </span>
              {t('guest')}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
