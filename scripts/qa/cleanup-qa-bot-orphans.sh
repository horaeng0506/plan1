#!/usr/bin/env bash
# qa-bot 계정의 plan1.schedules · plan1.categories orphan rows cleanup wrapper.
# dev/prod 환경 분리 + dry-run/apply 모드 + prod 입력 게이트.
#
# 사용:
#   bash scripts/qa/cleanup-qa-bot-orphans.sh dev dry-run    # default · 안전
#   bash scripts/qa/cleanup-qa-bot-orphans.sh dev apply
#   bash scripts/qa/cleanup-qa-bot-orphans.sh prod dry-run
#   bash scripts/qa/cleanup-qa-bot-orphans.sh prod apply     # 'PROD-CLEANUP' 입력 필요
#
# 동작:
#   - secrets/global.env 에서 DATABASE_URL_UNPOOLED_<ENV>·QA_TEST_USER_EMAIL 주입
#   - Neon branch host 출력
#   - apply mode: prod 시 'PROD-CLEANUP' 정확 입력 받아야 진행
#   - tsx 로 scripts/qa/cleanup-qa-bot-orphans.ts 실행 (idempotent)
#
# 근거: wiki/shared/qa-meta-policy.md § 12.2 · 거짓말 회복 2026-05-02

set -euo pipefail

ENV="${1:-}"
MODE="${2:-dry-run}"

case "$ENV" in
  dev|prod) ;;
  *) echo "Usage: $0 <dev|prod> <dry-run|apply>" >&2; exit 1 ;;
esac

case "$MODE" in
  dry-run|apply) ;;
  *) echo "Usage: $0 <dev|prod> <dry-run|apply>" >&2; exit 1 ;;
esac

SECRETS="$HOME/wiki-root/secrets/global.env"
[ -f "$SECRETS" ] || { echo "secrets not found: $SECRETS" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$SECRETS"
set +a

if [ "$ENV" = "dev" ]; then
  TARGET_VAR="DATABASE_URL_UNPOOLED_DEV"
else
  TARGET_VAR="DATABASE_URL_UNPOOLED_PROD"
fi

URL="${!TARGET_VAR:-}"
[ -n "$URL" ] || { echo "$TARGET_VAR not set in $SECRETS" >&2; exit 1; }

HOST=$(echo "$URL" | grep -oE 'ep-[a-z0-9-]+' | head -1)

echo
echo "──────────────────────────────────────────────────────"
echo "  qa-bot orphan cleanup — env: $ENV · mode: $MODE"
echo "  Neon branch         : $HOST"
echo "  Target email        : ${QA_TEST_USER_EMAIL:-qa-bot@cofounder.co.kr}"
echo "  scope               : plan1.schedules + plan1.categories WHERE user_id = qa-bot"
echo "──────────────────────────────────────────────────────"
echo

if [ "$MODE" = "apply" ] && [ "$ENV" = "prod" ]; then
  echo "⚠️  PRODUCTION DELETE. 같은 Neon project · Production branch 입니다."
  echo "    qa-bot 계정만 영향 (사용자 영향 0)."
  echo
  read -r -p "진행하려면 정확히 'PROD-CLEANUP' 를 입력: " confirm
  if [ "$confirm" != "PROD-CLEANUP" ]; then
    echo "취소됨." >&2
    exit 1
  fi
fi

DATABASE_URL_UNPOOLED="$URL" CLEANUP_MODE="$MODE" exec npx tsx scripts/qa/cleanup-qa-bot-orphans.ts
