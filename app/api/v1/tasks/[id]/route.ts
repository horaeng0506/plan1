import {NextResponse} from 'next/server';
import {and, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1Tasks} from '@/lib/db/schema';
import {authenticateApiKey, buildSuccessHeaders, buildOptionsResponse} from '@/lib/api-auth';

export async function DELETE(
  request: Request,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) return auth.response;
  const {id} = await context.params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json(
      {data: null, error: {code: 'invalid_id', message: 'Path parameter id required'}},
      {status: 400, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
    );
  }
  const existing = await db
    .select({id: plan1Tasks.id})
    .from(plan1Tasks)
    .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, auth.apiKey.userId)))
    .limit(1);
  if (!existing[0]) {
    return NextResponse.json(
      {data: null, error: {code: 'task_not_found', message: 'Task not found or not owned'}},
      {status: 404, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
    );
  }
  await db
    .delete(plan1Tasks)
    .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, auth.apiKey.userId)));
  return NextResponse.json(
    {data: {id, deleted: true}, error: null},
    {status: 200, headers: buildSuccessHeaders(auth.remaining, auth.resetUnix)}
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildOptionsResponse();
}