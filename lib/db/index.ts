/**
 * Drizzle Postgres client (Neon).
 *
 * Vercel serverless 환경 호환을 위해 @neondatabase/serverless (WebSocket/fetch 기반)
 * + drizzle-orm/neon-serverless 사용. portal lib/db/index.ts 와 동일 패턴.
 *
 * connection string 우선순위:
 *   1. process.env.DATABASE_URL  (Vercel Neon integration 자동 주입 — plan1 Vercel 프로젝트에 install 필요)
 *   2. process.env.DATABASE_URL_UNPOOLED_DEV  (로컬 dev fallback — secrets/global.env)
 *
 * ⚠️ 배포 전 점검: plan1 Vercel 프로젝트 Settings → Integrations → Neon "Add Connection"
 *    수동 install 필수 (env-critic Major #2). portal 의 Neon integration 자동 전파 안 됨.
 *
 * ⚠️ middleware (Edge runtime) 에서 import 금지. 현재 middleware.ts 는 db 미사용.
 */

import {drizzle} from 'drizzle-orm/neon-serverless';
import {Pool} from '@neondatabase/serverless';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED_DEV;

if (!connectionString) {
  throw new Error(
    'plan1 db: DATABASE_URL (Vercel Neon integration) or DATABASE_URL_UNPOOLED_DEV (local) not set'
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __plan1NeonPool: Pool | undefined;
}

const pool = globalThis.__plan1NeonPool ?? new Pool({connectionString});

if (process.env.NODE_ENV !== 'production') {
  globalThis.__plan1NeonPool = pool;
}

export const db = drizzle(pool, {schema});
export {schema};
