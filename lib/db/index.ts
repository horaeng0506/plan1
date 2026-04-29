/**
 * Drizzle Postgres client (Neon HTTP driver).
 *
 * Track 1.5 fix (2026-04-29): cross-continent latency 정공 — `drizzle-orm/neon-serverless`
 * Pool/WebSocket 에서 `drizzle-orm/neon-http` 로 driver 변경.
 * - HTTP driver 의 `db.batch([...])` 로 N sequential round-trip → 1 round-trip 압축
 * - Vercel iad1 (US East) ↔ Neon ap-southeast-1 (Singapore) cross-continent 환경에서
 *   query 당 250-900ms RTT 가 곱해지던 sync_ms (1.5-2s) 를 ~1 round-trip 으로 단축
 * - portal Better Auth 는 interactive transaction 필요 (issue #4747) → portal 만 neon-serverless 유지.
 *   plan1 (JWT verify 만 사용 · Better Auth 미사용) 은 neon-http 안전
 * - 결정 배경: `wiki/shared/db-region-driver-decision-20260429.md` § 4
 *
 * connection string 우선순위:
 *   1. process.env.DATABASE_URL  (Vercel Neon integration 자동 주입 · pooled URL)
 *   2. process.env.DATABASE_URL_UNPOOLED_DEV  (로컬 dev fallback)
 *
 * ⚠️ middleware (Edge runtime) 에서 import 금지. 현재 middleware.ts 는 db 미사용.
 * ⚠️ `db.transaction()` 호출 금지 — neon-http 미지원. 대신 `db.batch([...])` (atomic, rollback 보장)
 *
 * `db.batch` atomicity wire-level 검증 (env-critic 채택 · 2026-04-29):
 * - drizzle 의 `db.batch([queries])` → neon-http session.cjs:156 — `client.transaction(builtQueries, queryConfig)` 호출
 * - `client` = `@neondatabase/serverless` 의 `neon()` 인스턴스. `transaction()` API 가 단일 HTTPS request 안에 PG `BEGIN; ...; COMMIT;` 으로 wrap
 * - 같은 PG transaction · same MVCC snapshot · all-or-nothing rollback (any failure → 전체 rollback)
 * - 출처: drizzle-orm/neon-http/session.cjs:142-156 (실측), https://neon.com/docs/serverless/serverless-driver § "Multiple queries with transaction()", https://orm.drizzle.team/docs/batch-api
 * - 별개: drizzle 의 `db.transaction()` 직접 호출은 neon-http 가 throw — session.cjs:177 `"No transactions support in neon-http driver"` (interactive transaction 미지원, issue #4747)
 */

import {drizzle} from 'drizzle-orm/neon-http';
import {neon} from '@neondatabase/serverless';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED_DEV;

if (!connectionString) {
  throw new Error(
    'plan1 db: DATABASE_URL (Vercel Neon integration) or DATABASE_URL_UNPOOLED_DEV (local) not set'
  );
}

const sql = neon(connectionString);
export const db = drizzle({client: sql, schema});
export {schema};
