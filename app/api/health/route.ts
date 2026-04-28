/**
 * Health check endpoint (Stage 8 Pre-Launch Gate · Infrastructure 축).
 *
 * 용도:
 * - Vercel platform health check (자동)
 * - cofounder-router 의 plan1 reverse proxy 가용성 검증
 * - 외부 monitoring (uptime · alerting) 진입점
 *
 * 정책: 인증 없이 200 응답. 빌드·라우팅·런타임 정상 여부만 빠르게 확인.
 * DB 연결 검증은 별도 `/api/health/db` 로 분리 권장 (DB down 시 health check 도 fail
 * 하면 Vercel 이 deployment 를 죽일 수 있음 — health check 는 가능한 lightweight).
 */

import {NextResponse} from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'plan1',
    timestamp: new Date().toISOString()
  });
}
