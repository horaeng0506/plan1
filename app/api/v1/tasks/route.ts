import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {and, desc, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1Tasks, plan1Categories, plan1TaskBuckets} from '@/lib/db/schema';
import {ensureNowBucketId} from '@/lib/task-bucket-seed';
import {normalizeCount} from '@/lib/task-count';
import {authenticateApiKey, buildSuccessHeaders, buildOptionsResponse} from '@/lib/api-auth';

const createTaskSchema = z.object({
  title: z.string().min(1).max(500).nullable().optional(),
  durationMin: z.number().int().min(0).max(10080).nullable().optional(),
  categoryId: z.string().min(1).max(100).nullable().optional()
});

interface TaskApiRow {
  id: string;
  title: string | null;
  durationMin: number | null;
  categoryId: string | null;
  createdAt: number;
}

function rowToApi(row: typeof plan1Tasks.$inferSelect): TaskApiRow {
  return {
    id: row.id,
    title: row.title,
    durationMin: row.durationMin,
    categoryId: row.categoryId,
    createdAt: row.createdAt.getTime()
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;
  const rows = await db
    .select()
    .from(plan1Tasks)
    .where(eq(plan1Tasks.userId, auth.apiKey.userId))
    .orderBy(desc(plan1Tasks.createdAt));
  return NextResponse.json(
    {data: rows.map(rowToApi), error: null},
    {status: 200, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {data: null, error: {code: 'invalid_json', message: 'Request body must be valid JSON'}},
      {status: 400, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
    );
  }
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'invalid_input',
          message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        }
      },
      {status: 400, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
    );
  }
  const input = parsed.data;
  if (input.categoryId !== null && input.categoryId !== undefined) {
    const ownerRows = await db
      .select({id: plan1Categories.id})
      .from(plan1Categories)
      .where(eq(plan1Categories.id, input.categoryId))
      .limit(1);
    const owner = ownerRows[0];
    if (!owner) {
      return NextResponse.json(
        {data: null, error: {code: 'category_not_found', message: 'Category not found or not owned'}},
        {status: 404, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
      );
    }
    const ownershipCheck = await db
      .select({userId: plan1Categories.userId})
      .from(plan1Categories)
      .where(eq(plan1Categories.id, input.categoryId))
      .limit(1);
    if (ownershipCheck[0]?.userId !== auth.apiKey.userId) {
      return NextResponse.json(
        {data: null, error: {code: 'category_not_found', message: 'Category not found or not owned'}},
        {status: 404, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
      );
    }
  }
  const id = `task-${randomUUID()}`;
  // PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 'now' default 버킷에 배치 + priority append (충돌 회피).
  const bucketId = await ensureNowBucketId(auth.apiKey.userId);
  // PLAN1-TASKS-BUCKET-KIND-20260602 — 'now' 버킷이 count 로 전환됐으면 count 정규화 (server action 정합).
  // 누락 시 count=null 동기 깨짐 → convertTaskToSchedule 에서 taskCountExhausted 로 변환 차단 (logic-critic Major).
  const kindRows = await db
    .select({kind: plan1TaskBuckets.kind})
    .from(plan1TaskBuckets)
    .where(and(eq(plan1TaskBuckets.id, bucketId), eq(plan1TaskBuckets.userId, auth.apiKey.userId)))
    .limit(1);
  const count = normalizeCount(kindRows[0]?.kind ?? 'one-time', undefined);
  const bucketRows = await db
    .select({id: plan1Tasks.id})
    .from(plan1Tasks)
    .where(and(eq(plan1Tasks.userId, auth.apiKey.userId), eq(plan1Tasks.bucketId, bucketId)));
  await db.insert(plan1Tasks).values({
    id,
    userId: auth.apiKey.userId,
    title: input.title ?? null,
    durationMin: input.durationMin ?? null,
    categoryId: input.categoryId ?? null,
    bucketId,
    priority: bucketRows.length + 1,
    count
  });
  const rows = await db
    .select()
    .from(plan1Tasks)
    .where(eq(plan1Tasks.id, id))
    .limit(1);
  const created = rows[0];
  if (!created) {
    return NextResponse.json(
      {data: null, error: {code: 'create_failed', message: 'Task creation succeeded but row not found'}},
      {status: 500, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
    );
  }
  return NextResponse.json(
    {data: rowToApi(created), error: null},
    {status: 201, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildOptionsResponse();
}