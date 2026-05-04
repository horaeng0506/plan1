#!/usr/bin/env tsx
/**
 * scripts/qa/fix-schedule-tz-20260504.ts
 *
 * 사고: 2026-05-04 prod 사용자 KST 입력 hour=7 등 → 14:00 KST fall-back.
 * root cause: Vercel iad1 (UTC) + lib/domain/split.ts timezone-naive Date helper.
 * 정공 fix: 옵션 A (split.ts user TZ aware · plan1 PR #40 + portal #25)
 *
 * 본 script 의 역할:
 * - **read-only SELECT** — 의심 row 식별만. UPDATE 안 함
 * - 사용자가 직접 UI 에서 수정 (가장 정공 — 사용자 의도 보존)
 * - dev 또는 prod 환경 분기 (DATABASE_URL_UNPOOLED_<DEV|PROD>)
 * - idempotent 실행 OK (read-only)
 *
 * 사용:
 *   npm install -g tsx  # tsx 미설치 시
 *   tsx scripts/qa/fix-schedule-tz-20260504.ts dev
 *   tsx scripts/qa/fix-schedule-tz-20260504.ts prod
 *
 * 의심 row 기준:
 * - createdAt 또는 updatedAt 이 2026-05-04 사고 발생 시점 (KST · 약 06:00 ~ 11:00) 안
 * - startAt 의 KST hour 가 14 (= UTC 05:00 = 300 분)
 * - status != 'done' (삭제 또는 완료된 row 는 영향 없음)
 *
 * 출력:
 * - 의심 row 목록 (id · title · startAt KST · createdAt KST · status)
 * - 사용자 manual fix 안내 (`/project/plan1/` UI 에서 모달 열어 hour 직접 수정)
 *
 * 보안:
 * - DATABASE_URL_UNPOOLED_* 사용 (pooled URL 회피 — drizzle 권고)
 * - read-only · UPDATE/DELETE 없음
 * - 사용자 user_id filter (auth_user 경유) — 다른 user row 노출 안 함
 */

import {Client} from 'pg'

const ENV = process.argv[2]
if (ENV !== 'dev' && ENV !== 'prod') {
  console.error('Usage: tsx scripts/qa/fix-schedule-tz-20260504.ts <dev|prod>')
  process.exit(1)
}

const URL_VAR = ENV === 'dev' ? 'DATABASE_URL_UNPOOLED_DEV' : 'DATABASE_URL_UNPOOLED_PROD'
const url = process.env[URL_VAR]
if (!url) {
  console.error(`${URL_VAR} not set. source ~/wiki-root/secrets/global.env first.`)
  process.exit(1)
}

console.log(`──────────────────────────────────────────────────────`)
console.log(`  Schedule TZ fall-back 의심 row SELECT (${ENV})`)
console.log(`  Read-only · UPDATE 안 함`)
console.log(`──────────────────────────────────────────────────────`)
console.log()

const client = new Client({connectionString: url})
await client.connect()

try {
  // 사고 시간대 (KST 06:00 ~ 11:00 = UTC 21:00 전날 ~ 02:00 당일) + 14:00 KST start_at
  const result = await client.query(`
    SELECT
      id,
      title,
      start_at AT TIME ZONE 'Asia/Seoul' AS kst_start,
      created_at AT TIME ZONE 'Asia/Seoul' AS kst_created,
      duration_min,
      status,
      split_from
    FROM plan1.schedules
    WHERE
      EXTRACT(HOUR FROM start_at AT TIME ZONE 'Asia/Seoul') = 14
      AND created_at > '2026-05-04 00:00:00 Asia/Seoul'::timestamptz
      AND created_at < '2026-05-04 12:00:00 Asia/Seoul'::timestamptz
      AND status != 'done'
      AND split_from IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `)

  if (result.rows.length === 0) {
    console.log('의심 row 없음. fall-back 발생 안 했거나 사용자가 이미 수정함.')
  } else {
    console.log(`의심 row ${result.rows.length} 건:\n`)
    for (const r of result.rows) {
      console.log(
        `  id=${r.id}\n` +
          `    title='${r.title}'\n` +
          `    KST 시작=${r.kst_start.toISOString()}\n` +
          `    KST 생성=${r.kst_created.toISOString()}\n` +
          `    duration=${r.duration_min}분 status=${r.status} split_from=${r.split_from ?? 'null'}`
      )
      console.log()
    }
    console.log(
      `\n수정 안내: cofounder.co.kr/project/plan1/ UI 에서 각 schedule 카드 클릭 → ` +
        `편집 모달 → hour 시각 직접 수정 (옵션 A 적용 후 정상 작동)`
    )
  }
} finally {
  await client.end()
}
