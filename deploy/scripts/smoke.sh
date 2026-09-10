#!/usr/bin/env bash
# 배포 후보 환경의 비파괴 핵심 흐름 smoke test.
#
# 기본 실행(헬스 + 공개 OAuth 경로):
#   bash deploy/scripts/smoke.sh
# 인증 API까지 실행:
#   SMOKE_JWT='<서비스 JWT>' bash deploy/scripts/smoke.sh
# 인증 단계가 반드시 통과해야 하면:
#   SMOKE_REQUIRE_AUTH=true SMOKE_JWT='<서비스 JWT>' bash deploy/scripts/smoke.sh
# AI 장애 격리 확인(실행 중인 ai를 잠시 중단 후 반드시 복구):
#   SMOKE_FAULT_INJECTION=true SMOKE_JWT='<서비스 JWT>' bash deploy/scripts/smoke.sh --with-faults
#
# 이 스크립트는 데이터 변경·회원 생성·외부 OAuth 로그인을 하지 않는다.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:18080}"
WEB_URL="${SMOKE_WEB_URL:-http://127.0.0.1}"
TOKEN="${SMOKE_JWT:-}"
REQUIRE_AUTH="${SMOKE_REQUIRE_AUTH:-false}"
FAULT_INJECTION="${SMOKE_FAULT_INJECTION:-false}"
COMPOSE_FILE="${SMOKE_COMPOSE_FILE:-$REPO_ROOT/deploy/docker-compose.yml}"
ENV_FILE="${SMOKE_ENV_FILE:-$REPO_ROOT/deploy/.env}"
TIMEOUT="${SMOKE_TIMEOUT_SECONDS:-10}"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/b102-smoke.XXXXXX")"
fault_service=""
cleanup() {
  if [[ -n "$fault_service" ]]; then
    echo "[RECOVER] docker compose start $fault_service"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start "$fault_service" >/dev/null || \
      echo "[ERROR] $fault_service 복구 실패 — 수동으로 재기동하세요." >&2
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

passed=0; failed=0; skipped=0

usage() { sed -n '1,18p' "$0"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-faults) FAULT_INJECTION=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$REQUIRE_AUTH" == true || "$REQUIRE_AUTH" == false ]] || { echo "SMOKE_REQUIRE_AUTH 는 true/false 여야 합니다." >&2; exit 2; }
[[ "$FAULT_INJECTION" == true || "$FAULT_INJECTION" == false ]] || { echo "SMOKE_FAULT_INJECTION 는 true/false 여야 합니다." >&2; exit 2; }
command -v curl >/dev/null || { echo "curl 이 필요합니다." >&2; exit 2; }

check() {
  local name="$1" method="$2" url="$3" expected="$4" body="${5:-}"
  local id
  id="smoke-$(date +%s)-$((RANDOM % 100000))"
  local headers="$tmp_dir/headers-$passed-$failed" response="$tmp_dir/body-$passed-$failed" status actual_trace
  local -a args=(--silent --show-error --max-time "$TIMEOUT" --request "$method" "$url"
    --dump-header "$headers" --output "$response" --write-out '%{http_code}'
    --header "X-Request-ID: $id" --header 'Accept: application/json')
  if [[ -n "$TOKEN" ]]; then args+=(--header "Authorization: Bearer $TOKEN"); fi
  if [[ -n "$body" ]]; then args+=(--header 'Content-Type: application/json' --data "$body"); fi

  if ! status="$(curl "${args[@]}" 2>"$tmp_dir/curl-error")"; then
    failed=$((failed + 1))
    echo "[FAIL] $name endpoint=$url status=transport-error traceId=$id"
    sed -n '1p' "$tmp_dir/curl-error" | sed 's/^/       /'
    return
  fi
  actual_trace="$(awk 'BEGIN{IGNORECASE=1} /^x-request-id:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/[[:space:]]/, ""); print; exit}' "$headers")"
  actual_trace="${actual_trace:-$id}"
  if [[ ",$expected," == *",$status,"* ]]; then
    passed=$((passed + 1)); echo "[PASS] $name endpoint=$url status=$status traceId=$actual_trace"
  else
    failed=$((failed + 1))
    echo "[FAIL] $name endpoint=$url status=$status expected=$expected traceId=$actual_trace"
    if [[ -s "$response" ]]; then head -c 600 "$response" | tr '\n' ' '; echo; fi
  fi
}

skip() { skipped=$((skipped + 1)); echo "[SKIP] $1"; }

echo "B102 smoke base=$BASE_URL web=$WEB_URL"
check "web health" GET "$WEB_URL/nginx-health" "200"
check "backend liveness" GET "$BASE_URL/actuator/health/liveness" "200"
check "backend readiness" GET "$BASE_URL/actuator/health/readiness" "200"
check "unsupported OAuth provider contract" GET "$BASE_URL/api/v1/auth/oauth/unsupported/authorize" "400"

if [[ -z "$TOKEN" ]]; then
  if [[ "$REQUIRE_AUTH" == true ]]; then
    failed=$((failed + 1)); echo "[FAIL] authenticated checks SMOKE_JWT 가 필요합니다."
  else
    skip "인증 단계 — SMOKE_JWT 를 설정하면 users/search/recommendation을 실행합니다."
  fi
else
  check "authenticated user" GET "$BASE_URL/api/v1/users/me" "200"
  check "book search" GET "$BASE_URL/api/v1/books/search?q=%EC%86%8C%EB%85%84&page=0&size=1" "200"
  check "personalized recommendation" GET "$BASE_URL/api/v1/recommendations?size=5" "200"
fi

if [[ "$FAULT_INJECTION" == true ]]; then
  [[ -f "$COMPOSE_FILE" ]] || { echo "Compose 파일이 없습니다: $COMPOSE_FILE" >&2; exit 2; }
  command -v docker >/dev/null || { echo "docker 가 필요합니다." >&2; exit 2; }
  fault_service="ai"
  echo "[FAULT] ai 중단 후 검색·backend readiness를 확인합니다."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop "$fault_service" >/dev/null
  check "readiness while AI stopped" GET "$BASE_URL/actuator/health/readiness" "200"
  if [[ -n "$TOKEN" ]]; then
    check "search while AI stopped" GET "$BASE_URL/api/v1/books/search?q=%EC%86%8C%EB%85%84&page=0&size=1" "200"
  else
    skip "AI 장애 중 인증 검색 — SMOKE_JWT 가 없습니다."
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start ai >/dev/null
  fault_service=""
  echo "[RECOVER] ai 재기동 요청 완료"
fi

echo "summary passed=$passed failed=$failed skipped=$skipped"
if [[ "$failed" -gt 0 ]]; then exit 1; fi
