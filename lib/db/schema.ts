/**
 * plan1 자체 Drizzle schema — portal lib/db/schema.ts 의 plan1 부분 + user minimal 복제.
 *
 * Source-of-truth: cofounder-portal/lib/db/schema.ts
 * 동기화 정책: portal schema 변경 시 plan1 schema.ts 도 같이 업데이트 (lint/PR 시 일치 확인)
 *
 * ⚠️ ABSOLUTELY NO drizzle-kit push FROM plan1 ⚠️
 *   - plan1 에 `drizzle.config.ts` **절대 생성 금지** (logic-critic Major #1)
 *   - 발견 시 즉시 삭제. plan1 의 minimal `user` 정의가 portal Better Auth user 를
 *     name·email·image 등 컬럼 DROP 하려 시도 → portal 전체 wipe 사고 위험
 *   - schema 변경은 portal 에서만 (`npm run db:push:dev` / `db:push:prod` + 가드)
 *   - plan1 의 schema 는 type 안전성·query 빌딩 용도로만
 *
 * ⚠️ user 테이블 query 금지 ⚠️
 *   - `db.query.user` / `db.select().from(user)` 사용 금지 (logic-critic Major #2)
 *   - portal 가 컬럼 추가해도 plan1 schema 가 모르므로 silent miss 발생 가능
 *   - 사용자 정보는 server actions 의 `session.user` 에서 가져올 것 (verify-session.ts)
 *   - user export 는 cross-schema FK 참조 전용
 *
 * 보안 원칙 (모든 plan1.* 테이블):
 *   - user_id NOT NULL FK→public.user.id, onDelete cascade — 멀티 테넌트 격리 enforce
 *   - server actions 가 user_id = session.user.id 강제 (Stage 3c 책임)
 *   - 텍스트 컬럼은 사용자 입력 평문 — Drizzle 파라미터화로 SQL injection 차단
 */

import {
  pgTable,
  pgSchema,
  text,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  index,
  type AnyPgColumn
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────
// public.user — minimal reference (FK target).
// portal Better Auth 가 실제 모든 컬럼 관리. plan1 는 id 만 참조.
// ─────────────────────────────────────────────────────────────────────────

export const user = pgTable('user', {
  id: text('id').primaryKey()
});

// ─────────────────────────────────────────────────────────────────────────
// plan1 schema (격리 namespace)
// ─────────────────────────────────────────────────────────────────────────

export const plan1Schema = pgSchema('plan1');

export const plan1Categories = plan1Schema.table(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .$defaultFn(() => new Date())
      .notNull()
  },
  table => ({
    userNameUniqueIdx: uniqueIndex('plan1_categories_user_name_idx').on(table.userId, table.name)
  })
);

export const plan1Schedules = plan1Schema.table(
  'schedules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    title: text('title').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => plan1Categories.id, {onDelete: 'cascade'}),
    startAt: timestamp('start_at', {withTimezone: true}).notNull(),
    durationMin: integer('duration_min').notNull(),
    actualDurationMin: integer('actual_duration_min'),
    timerType: text('timer_type').$type<'countup' | 'timer1' | 'countdown'>().notNull(),
    status: text('status').$type<'pending' | 'active' | 'done'>().notNull(),
    splitFrom: text('split_from').references((): AnyPgColumn => plan1Schedules.id, {
      onDelete: 'cascade'
    }),
    chainedToPrev: boolean('chained_to_prev').$defaultFn(() => false).notNull(),
    completedAt: timestamp('completed_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true})
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .$defaultFn(() => new Date())
      .notNull()
  },
  table => ({
    userStartIdx: index('plan1_schedules_user_start_idx').on(table.userId, table.startAt)
  })
);

// PLAN1-WH-FOCUS-20260504 — plan1WorkingHours 테이블 폐기 (업무시간 기능 제거).
// 14:00 fall-back root cause 가 split.ts 의 wh 의존이라 wh 자체를 폐기.

export const plan1Settings = plan1Schema.table('settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, {onDelete: 'cascade'}),
  theme: text('theme').$type<'light' | 'dark' | 'system'>().notNull(),
  weekViewSpan: integer('week_view_span').$type<1 | 2 | 3>().notNull(),
  weeklyPanelHidden: boolean('weekly_panel_hidden').$defaultFn(() => false).notNull(),
  // PLAN1-WH-FOCUS-20260504 — defaultWorkingHoursStartMin/EndMin 폐기.
  // 집중 보기 모드 (focusViewMin) — 분 단위. null = 전체 보기 (default).
  focusViewMin: integer('focus_view_min'),
  // PLAN1-ZOOM-PX-PER-HOUR-20260509 — DailyTimeline 시간 간격 (1시간 height px).
  // 2026-05-09 (대장) — UI +/- 버튼 폐기 + default 50 → 90. 사용자 변경 영역 X (column 보존만).
  zoomPxPerHour: integer('zoom_px_per_hour').default(90).notNull(),
  pinnedActiveId: text('pinned_active_id').references((): AnyPgColumn => plan1Schedules.id, {
    onDelete: 'set null'
  }),
  createdAt: timestamp('created_at', {withTimezone: true})
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true})
    .$defaultFn(() => new Date())
    .notNull()
});

// PLAN1-TASKS-FEATURE-20260509 — task 영역 (할일 → 스케줄 변환 chain).
// 사양 단일 원천: cofounder-portal/lib/db/schema.ts plan1Tasks (Stage 5.1 정합).
// task → schedule 변환은 server action 안 db.batch atomic chain (logic-critic C3 정합).
export const plan1Tasks = plan1Schema.table(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    title: text('title'),
    durationMin: integer('duration_min'),
    categoryId: text('category_id').references(() => plan1Categories.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .$defaultFn(() => new Date())
      .notNull()
  },
  table => ({
    userIdx: index('plan1_tasks_user_idx').on(table.userId)
  })
);

// PLAN1-TASKS-FEATURE-20260509 — 외부 AI agent REST API 영역 API key.
// 사양 단일 원천: cofounder-portal/lib/db/schema.ts plan1ApiKeys.
// 형식: `plan1_api_<40-char-base62>` (Stripe 패턴) · hash: HMAC-SHA256.
// rate limit: token bucket (Q24 b · sliding window X · cleanup chain 불요).
export const plan1ApiKeys = plan1Schema.table(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true})
      .$defaultFn(() => new Date())
      .notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}),
    lastUsedAt: timestamp('last_used_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    rateLimitTokens: integer('rate_limit_tokens').default(60).notNull(),
    rateLimitLastRefillAt: timestamp('rate_limit_last_refill_at', {
      withTimezone: true
    })
      .$defaultFn(() => new Date())
      .notNull()
  },
  table => ({
    keyHashIdx: uniqueIndex('plan1_api_keys_key_hash_idx').on(table.keyHash),
    userActiveIdx: index('plan1_api_keys_user_active_idx').on(
      table.userId,
      table.revokedAt
    ),
    userPrefixIdx: uniqueIndex('plan1_api_keys_user_prefix_idx').on(
      table.userId,
      table.keyPrefix
    )
  })
);

// 편의 type export (server actions·components 에서 사용)
export type Schedule = typeof plan1Schedules.$inferSelect;
export type ScheduleInsert = typeof plan1Schedules.$inferInsert;
export type Category = typeof plan1Categories.$inferSelect;
export type CategoryInsert = typeof plan1Categories.$inferInsert;
export type Settings = typeof plan1Settings.$inferSelect;
export type SettingsInsert = typeof plan1Settings.$inferInsert;
export type Task = typeof plan1Tasks.$inferSelect;
export type TaskInsert = typeof plan1Tasks.$inferInsert;
export type ApiKey = typeof plan1ApiKeys.$inferSelect;
export type ApiKeyInsert = typeof plan1ApiKeys.$inferInsert;
