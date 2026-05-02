/**
 * qa-bot 계정의 plan1.schedules · plan1.categories orphan rows cleanup (1회성).
 *
 * 배경:
 *   - mutation E2E PR #20 1·2·3차 fail 시점 cleanup step 도달 X → qa-bot prod DB schedule 5+ 누적
 *   - 새 PR 의 spec cleanup 정상 — history 잔존만 미처리
 *   - 사용자 영향 0 (qa-bot 계정만 · 다른 사용자 불가시)
 *
 * 안전:
 *   - dry-run default · apply 시 명시적 'PROD-CLEANUP' 게이트 (wrapper)
 *   - plan1 schema.ts 의 user 테이블 query 금지 정책 → raw SQL 직접 SELECT id FROM "user" WHERE email
 *   - drizzle-orm/neon-http db.batch([...]) atomic transaction (BEGIN; ...; COMMIT;)
 *   - cascade: plan1_schedules.category_id FK ON DELETE CASCADE → categories DELETE 만으로 schedules 자동 정리
 *     단 FK direction 가 schedules → categories 라 categories 먼저 DELETE 하면 schedules cascade
 *     반대로 schedules 먼저 DELETE 후 categories 도 OK
 *
 * 실행:
 *   bash scripts/qa/cleanup-qa-bot-orphans.sh dev dry-run
 *   bash scripts/qa/cleanup-qa-bot-orphans.sh dev apply
 *   bash scripts/qa/cleanup-qa-bot-orphans.sh prod dry-run
 *   bash scripts/qa/cleanup-qa-bot-orphans.sh prod apply   # 'PROD-CLEANUP' 입력 필요
 *
 * idempotent: 다시 실행해도 0건 처리 후 정상 종료.
 */

import {drizzle} from 'drizzle-orm/neon-http';
import {neon} from '@neondatabase/serverless';
import {eq} from 'drizzle-orm';
import {plan1Schedules, plan1Categories} from '../../lib/db/schema';

const QA_BOT_EMAIL_DEFAULT = 'qa-bot@cofounder.co.kr';

async function main() {
  const mode = (process.env.CLEANUP_MODE ?? 'dry-run') as 'dry-run' | 'apply';
  const email = process.env.QA_TEST_USER_EMAIL ?? QA_BOT_EMAIL_DEFAULT;
  const connectionString = process.env.DATABASE_URL_UNPOOLED;

  if (!connectionString) {
    throw new Error('DATABASE_URL_UNPOOLED not set (wrapper must inject env-specific URL)');
  }
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new Error(`CLEANUP_MODE must be 'dry-run' or 'apply', got: ${mode}`);
  }

  const client = neon(connectionString);
  const db = drizzle({client});

  console.log(`\n[cleanup-qa-bot-orphans] mode: ${mode} · email: ${email}`);

  // plan1 schema.ts 의 user 테이블 query 금지 정책 (server actions 영역) — 단 cleanup 은 1회성·email→id 만 필요
  // → neon raw client 로 직접 SELECT (drizzle ORM 우회)
  const userRows =
    (await client`SELECT id FROM "user" WHERE email = ${email} LIMIT 1`) as Array<{id: string}>;

  if (userRows.length === 0) {
    console.log(`[cleanup-qa-bot-orphans] user not found (email=${email}). 종료.`);
    return;
  }

  const userId = userRows[0].id;
  console.log(`[cleanup-qa-bot-orphans] user_id: ${userId}`);

  const schedulesBefore = await db
    .select({
      id: plan1Schedules.id,
      title: plan1Schedules.title,
      createdAt: plan1Schedules.createdAt
    })
    .from(plan1Schedules)
    .where(eq(plan1Schedules.userId, userId));

  const categoriesBefore = await db
    .select({
      id: plan1Categories.id,
      name: plan1Categories.name,
      createdAt: plan1Categories.createdAt
    })
    .from(plan1Categories)
    .where(eq(plan1Categories.userId, userId));

  console.log(
    `\n[cleanup-qa-bot-orphans] BEFORE: schedules=${schedulesBefore.length} · categories=${categoriesBefore.length}`
  );

  if (schedulesBefore.length > 0) {
    console.log('\n--- schedules (BEFORE) ---');
    schedulesBefore.forEach(r =>
      console.log(`  ${r.id} · ${r.title} · ${r.createdAt.toISOString()}`)
    );
  }
  if (categoriesBefore.length > 0) {
    console.log('\n--- categories (BEFORE) ---');
    categoriesBefore.forEach(r =>
      console.log(`  ${r.id} · ${r.name} · ${r.createdAt.toISOString()}`)
    );
  }

  if (schedulesBefore.length === 0 && categoriesBefore.length === 0) {
    console.log('\n[cleanup-qa-bot-orphans] orphan 0건. idempotent 종료.');
    return;
  }

  if (mode === 'dry-run') {
    console.log(
      `\n[cleanup-qa-bot-orphans] DRY-RUN — 실제 삭제 X. apply 모드로 재실행하면 위 row 삭제.`
    );
    return;
  }

  console.log('\n[cleanup-qa-bot-orphans] APPLY — db.batch atomic DELETE 실행...');

  await db.batch([
    db.delete(plan1Schedules).where(eq(plan1Schedules.userId, userId)),
    db.delete(plan1Categories).where(eq(plan1Categories.userId, userId))
  ]);

  const schedulesAfter = await db
    .select({id: plan1Schedules.id})
    .from(plan1Schedules)
    .where(eq(plan1Schedules.userId, userId));
  const categoriesAfter = await db
    .select({id: plan1Categories.id})
    .from(plan1Categories)
    .where(eq(plan1Categories.userId, userId));

  console.log(
    `\n[cleanup-qa-bot-orphans] AFTER: schedules=${schedulesAfter.length} · categories=${categoriesAfter.length}`
  );

  if (schedulesAfter.length === 0 && categoriesAfter.length === 0) {
    console.log('[cleanup-qa-bot-orphans] APPLY 성공 — 모든 orphan 정리 완료.');
  } else {
    throw new Error(
      `cleanup 후에도 잔존: schedules=${schedulesAfter.length} · categories=${categoriesAfter.length}`
    );
  }
}

main().catch(err => {
  console.error('[cleanup-qa-bot-orphans] ERROR:', err);
  process.exit(1);
});
