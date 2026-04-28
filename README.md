# plan1

웹 기반 스케줄 관리 SaaS — 주간 캘린더 + 일간 타임라인 + 12H 아날로그 시계 + cascade 자동 밀림 타이머를 한 화면에 묶었다.

> **상태**: `private` (Stage 8 Pre-Launch Gate 진행 중). public 승격 후 cofounder.co.kr 카드 활성.
> **본체 URL**: `https://plan1-puce.vercel.app/` (직접 접근 시 Vercel SSO 게이트)
> **공개 진입**: `https://cofounder.co.kr/project/plan1/` (cofounder-router → portal SSO 검증 → plan1)

다른 컴퓨터에서 작업 이어받기 / 진행 상황 + 미완 Stage / secrets 동기화 절차는 [`wiki/projects/plan1/handoff-2026-04-28-studio.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/handoff-2026-04-28-studio.md) 한 장에 정리돼 있다.

---

## 아키텍처 (인증 chain)

```
사용자 브라우저
  → cofounder.co.kr/project/plan1/  (Cloudflare Workers — cofounder-router)
    → x-vercel-protection-bypass header (Vercel SSO 우회)
    → cofounder-portal (Better Auth 세션 검증 + JWT 발급)
    → plan1 본체 Vercel  (lib/verify-session.ts 가 portal JWKS 로 JWT 검증)
      → server actions (Drizzle/Neon · plan1 schema 격리)
```

- **portal SSO**: 사용자 식별은 portal Better Auth 가 단독 담당. plan1 은 stateless JWT 검증만.
- **cross-schema FK**: Neon 단일 인스턴스 안에서 `plan1.schedules.user_id → public.user.id (cascade)`. user 테이블 컬럼은 portal 만 관리, plan1 은 id 만 참조.
- **plan1 에서 `drizzle-kit push` 절대 금지** (자세한 이유: `lib/db/schema.ts` 헤더 주석).

---

## 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Next.js 14.2.35 (App Router) | basePath `/project/plan1` |
| 런타임 | Node.js 20.x (Vercel) | 현재 Vercel 설정 24.x — 다운그레이드 대기 ([handoff § 9.6](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/handoff-2026-04-28-studio.md#96-plan1-인프라-후속-잔여-portal-incident-와-동일-패턴--모두-대장-ui-액션)) |
| UI | React 18 + Tailwind v3.4 + JetBrains Mono | Terminal 톤, 4채널 토큰 (`bg/panel/line/muted/txt/ink/semantic`) |
| 캘린더 | FullCalendar v6 (dayGrid + timeGrid + interaction) | drag/resize 비활성 — 시간 변경은 모달 단일 경로 |
| 시계 | 순수 SVG + d3-shape (arc) | 12시간 표기 + 시침/분침 + AM/PM opacity (0.55/0.85) |
| 상태 | Zustand v5 (persist 미사용) | server state 직접 fetch · DB 단일 source-of-truth |
| DB | Neon Postgres + Drizzle ORM | `pgSchema('plan1')` 4테이블 (categories·schedules·working_hours·settings) |
| 인증 | jose JWT 검증 (portal JWKS) | issuer = `PORTAL_ISSUER` |
| i18n | next-intl v4 | 11 언어 (en·ko·es·pt·fr·de·ja·zh-CN·ru·ar·hi) |
| 테스트 | vitest 4 | `lib/domain/cascade.test.ts` · `lib/domain/split.test.ts` · `lib/domain/split.idempotency.test.ts` |
| 호스팅 | Vercel | project `prj_rKmWor4vTZu7XwrW9uO8ASYOTHFy` |

---

## 프로젝트 구조

```
plan1/
├── app/                     # Next.js App Router
│   ├── actions/             # server actions (categories · schedules · settings · working-hours)
│   ├── api/health/          # /api/health endpoint (Stage 8 5축)
│   ├── globals.css          # Terminal 4채널 CSS 변수
│   ├── layout.tsx
│   └── page.tsx
├── components/              # React client 컴포넌트
│   ├── PlanApp.tsx          # 4영역 통합 + store.init() 진입점
│   ├── WeeklyCalendar.tsx   # 1/2/3주 토글
│   ├── DailyTimeline.tsx
│   ├── AnalogClock.tsx      # 12H + 피자 조각
│   ├── ActiveTimer.tsx      # countup · timer1 freeze · pin 선택
│   ├── NewScheduleModal.tsx
│   ├── CategoryManager.tsx
│   ├── WorkingHoursEditor.tsx
│   ├── ToastContainer.tsx
│   └── ModalSkeleton.tsx
├── lib/
│   ├── db/                  # Drizzle schema (portal 복제) + Neon client
│   ├── domain/              # 순수 도메인 (cascade · split + vitest)
│   ├── auth-helpers.ts
│   ├── verify-session.ts    # portal JWKS JWT 검증
│   ├── server-action.ts     # ServerActionError + runAction HOF
│   ├── store.ts             # Zustand + server actions wrapper
│   ├── log.ts               # 환경별 logger
│   └── ...
├── i18n/
│   ├── routing.ts
│   └── request.ts
├── messages/                # 11 언어 카탈로그
├── middleware.ts            # rate limit 20/min (POST + server action) + next-intl
├── next.config.mjs          # PORTAL_ISSUER 빌드 가드 + allowedOrigins
└── package.json
```

---

## 로컬 개발 셋업

### 사전 조건
- Node.js 20.x (`.nvmrc` 동등 — Vercel production 과 일치)
- npm
- portal 도 같은 Neon 인스턴스에 접속 가능해야 한다 (DB schema 는 portal 가 push, plan1 은 read/write 만)
- `~/wiki-root/secrets/global.env` 가 심링크 또는 복사로 dev 머신에 존재해야 한다 ([secrets 정책](https://github.com/horaeng0506/wiki-root/blob/main/.claude/rules/secrets-policy.md))

### 설치 + 실행
```bash
git clone https://github.com/horaeng0506/plan1
cd plan1
git checkout project/plan1-saas-migration   # SaaS 본 코드 (main 머지는 Stage 8 통과 후)
npm install
ln -s ~/wiki-root/secrets/global.env .env.local
npm run dev                                  # http://localhost:3000/project/plan1
```

### 빌드
```bash
npm run build                                # First Load 111 KB 부근
npm run start
```

### 테스트 / lint
```bash
npm test                                     # vitest run (도메인 cascade · split)
npm run lint                                 # next/core-web-vitals · 0 warnings 기대
```

---

## 환경 변수 (5키 × 3환경)

`.env.local` 또는 Vercel Settings → Environment Variables. **production / preview / development** 모두 등록.

| 키 | 용도 | 출처 |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection (server actions 일반 쿼리) | Neon 콘솔 |
| `DATABASE_URL_UNPOOLED` | Neon direct connection (장기 트랜잭션 · 미사용 시 fallback) | Neon 콘솔 |
| `PORTAL_ISSUER` | JWT issuer URL (`https://cofounder.co.kr` / `http://localhost:3456`) | 단순 URL |
| `BETTER_AUTH_SECRET` | Better Auth 서명 키 (portal 와 **동일 값** 필수 — JWT 호환) | portal 와 공유 |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | (현재 미직접 사용 · portal 가 처리) | Google Cloud Console |

> `next.config.mjs` 가 빌드 시점에 `PORTAL_ISSUER` 부재면 즉시 throw — Vercel 빌드 단계에서 잡힘 (production 첫 5분 outage 차단).

---

## i18n

- 11 언어 마스터: `messages/en.json` (영어가 source of truth)
- 자동 번역: `.github/workflows/i18n-translate.yml` (Claude Sonnet 4.5 batch · `i18n-ai-translate` 도구)
- 언어 전환: `next-intl` cookie `NEXT_LOCALE` (portal Auth 쿠키와 origin 공유)

```bash
npm run i18n:translate:all                  # 9 언어 + zh 일괄 (수동 트리거)
npm run i18n:diff                           # 마지막 번역 이후 변경 키만 증분
```

> **알려진 제약**: ICU plural 구문이 `i18n-ai-translate` 와 충돌 가능 (placeholder delimiter `{` `}`). Stage 5 critic 이월로 추적 중.

---

## 배포 / Production Spec

| 항목 | 값 |
|---|---|
| Vercel project name | `plan1` |
| Vercel project id | `prj_rKmWor4vTZu7XwrW9uO8ASYOTHFy` |
| Vercel team | `team_015qbq0WxuAqXMUTIWwjnIKB` |
| 본체 alias | `https://plan1-puce.vercel.app` |
| 공개 진입 | `https://cofounder.co.kr/project/plan1/` |
| router 매핑 | `cofounder-router/src/index.js` `PROJECT_ROUTES` + `PRIVATE_PROJECTS` |
| 기본 브랜치 | `main` (Stage 8 통과 후 SaaS 본 코드 머지) |
| 작업 브랜치 | `project/plan1-saas-migration` (현재 활성) |
| Node 런타임 | Vercel 24.x (목표 20.x · 다운그레이드 대기 — 대장 UI 액션) |
| GitHub auto-deploy | 미연결 (대장 UI 액션 — Vercel for Git App 에 `horaeng0506/plan1` 추가) |
| Protection Bypass | 미발급 (대장 UI 액션 — router 통합 시 `x-vercel-protection-bypass` 헤더용) |

> **DB 마이그레이션은 portal 에서만 push.** plan1 dev 환경에서 `drizzle-kit push` 시도 금지 (portal user 테이블 wipe 위험). 자세한 이유: `lib/db/schema.ts` 헤더 + `.claude/rules/dev-process.md § DB schema 변경 가드`.

---

## Stage 진행 (요약)

세부 표는 [`wiki/projects/plan1/overview.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/overview.md) Stage 표.

| Phase | Stage | 상태 |
|---|---|---|
| A | 0a · 0b | ✓ |
| B | 1 (Vite→Next.js) · 2 (DB schema) · 3a~3f (도메인+server actions+store+UI) | ✓ |
| C | 4a · 4b · 4c · 4d-A/B/C/critic-fix · 4e | ✓ |
| C | 4d-D portal SSO E2E | ⏳ 대장 액션 |
| C | 5 (i18n-extract) · 5.1 part 1+2 (server action error i18n) | ✓ |
| C | 6 (자동 번역) | ✓ |
| C | 6.1 (Playwright KO/DE/AR/JA/ZH-CN) · 6.5 (UX 강화) | ⏳ |
| D | 7.1~7.4 (Vercel 배포 + 라우터 + 포털 카드) | ✓ |
| D | 8 Pre-Launch Gate (1축 lint ✓ · 4축 보안 HIGH 2 + MEDIUM 4 ✓ · 5축 health ✓) | ⏳ 2·3·6축 잔여 |
| F | N+30 KPI 리뷰 | — |

### 알려진 잔여 (Stage 8)
- **2축 npm audit**: `next 14.2.35` → `next 16.2.4` 메이저 업그레이드 필요 (high 4 — DoS·HTTP smuggling 등). 대장 결정 대기.
- **3축 Performance**: First Load 111 KB (PRD 가이드 100 KB · Stage 14 lazy split 보류).
- **6축 Documentation**: 이 README ✓ (남은 항목: `wiki/shared/project-migration-playbook.md` 신설 — Stage 8 통과 시).

---

## 코드 패턴 / 표준

이 프로젝트가 만든 / 따르는 공통 패턴:

- [`wiki/shared/nextjs-server-action-error-pattern.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/shared/nextjs-server-action-error-pattern.md) — Next.js 14 prod redact 회피 server action error i18n 표준 (Stage 5.1 part 2 산출물). copymaker1·향후 SaaS 도 따라야 함.
- IDOR 가드: 외래 ID receive 시 `assertCategoryOwnership` 헬퍼 (Stage 8 4축 HIGH fix).
- rate limit: middleware 가 `/api/** POST` + `Next-Action` POST 모두 20/min (security-auditor MEDIUM fix).

---

## 관련 문서 (wiki-root)

| 문서 | 용도 |
|---|---|
| [`wiki/projects/plan1/overview.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/overview.md) | Stage 표 + 복구 체크포인트 |
| [`wiki/projects/plan1/handoff-2026-04-28-studio.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/handoff-2026-04-28-studio.md) | 다른 머신 인계 (secrets 동기화 + 진행 우선순위) |
| [`wiki/projects/plan1/PRD.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/PRD.md) | 제품 요구사항 |
| [`wiki/projects/plan1/DESIGN.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/DESIGN.md) | Terminal 톤 + 4채널 토큰 |
| [`wiki/projects/plan1/incident-portal-vercel-2026-04-27.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/projects/plan1/incident-portal-vercel-2026-04-27.md) | portal Vercel 인프라 incident (RESOLVED) |
| [`wiki/shared/secrets-sync-runbook.md`](https://github.com/horaeng0506/wiki-root/blob/main/wiki/shared/secrets-sync-runbook.md) | 머신 간 secrets 동기화 절차 |

---

## 라이선스 / 소유

비공개 SaaS. cofounder.co.kr 포털의 일부.
