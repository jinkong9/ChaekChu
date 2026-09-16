#!/usr/bin/env bash
# 배포. 사람이 서버에서 실행하거나 Jenkins 가 dev CI 성공 뒤 workspace 에서 실행한다. 둘은 같은 env·락·상태를 공유한다.
#   bash deploy/scripts/deploy.sh                 # origin/dev 최신을 받아 배포 (서버 작업 트리)
#   bash deploy/scripts/deploy.sh --no-pull       # 현재 체크아웃 그대로 (Jenkins 는 항상 이 모드)
#   bash deploy/scripts/deploy.sh --skip-backup   # 배포 전 pg_dump 생략 (DB 없이 시험할 때만)
#   bash deploy/scripts/deploy.sh --force-backup  # 마이그레이션이 없어도 배포 전 pg_dump 를 뜬다
#   PROFILES="--profile recsys" bash deploy/scripts/deploy.sh
#
# 순서: env·락 → (pull) → 릴리스 SHA·마이그레이션 지문 → (지문이 바뀐 배포만) 배포 전 pg_dump → build → up --wait
#       → 내부 readiness + nginx http + (TLS) 공개 도메인 https → 상태 기록 → prune
# 실패 시(기동 실패든 배포 후 헬스 실패든 같은 경로): 새 릴리스의 마이그레이션 지문이 직전 성공 릴리스와 같으면 코드만 직전 SHA 로 자동 복구한다.
#          지문이 다르면(=이번 배포에 migration 이 있었으면) 자동 복구하지 않는다. Flyway 는 전진 전용이라 DB 는 사람이 dump 를 보고 판단한다.
#          상태 파일(current-release)은 헬스까지 통과한 뒤에만 갱신한다. 실패는 last-failed-release 에 남긴다.
set -euo pipefail
# shellcheck source=deploy/scripts/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

BRANCH="${BRANCH:-dev}"
PULL=true; BACKUP=true; FORCE_BACKUP=false
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=false ;;
    --skip-backup) BACKUP=false ;;
    --force-backup) FORCE_BACKUP=true ;;
    *) echo "알 수 없는 인자: $arg" >&2; exit 1 ;;
  esac
done
read -r -a profile_args <<< "${PROFILES:-}"
COMPOSE=(docker compose -f "$REPO_ROOT/deploy/docker-compose.yml" --env-file "$ENV_FILE" "${profile_args[@]}")
MIGRATION_DIR="$REPO_ROOT/backend/src/main/resources/db/migration"

require_env_file
acquire_deploy_lock
mkdir -p "$STATE_DIR" 2>/dev/null || true
[[ -w "$STATE_DIR" ]] || { echo "상태 디렉터리에 쓸 수 없습니다: $STATE_DIR" >&2; exit 1; }

if $PULL; then
  section "pull origin/$BRANCH"
  git -C "$REPO_ROOT" fetch -q origin "$BRANCH"
  git -C "$REPO_ROOT" checkout -q "$BRANCH"
  git -C "$REPO_ROOT" reset -q --hard "origin/$BRANCH"
fi

RELEASE="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"; export RELEASE
ref="$(git -C "$REPO_ROOT" branch --show-current)"; ref="${ref:-detached}"
migration_fingerprint="$(
  if [[ -d "$MIGRATION_DIR" ]]; then
    (cd "$MIGRATION_DIR" && find . -type f -name '*.sql' -print0 | sort -z | xargs -0 -r sha256sum) | sha256sum | cut -c1-16
  else echo "none"; fi
)"
prev_release=""; prev_fingerprint=""
if [[ -f "$STATE_DIR/current-release" ]]; then
  prev_release="$(cut -d' ' -f1 "$STATE_DIR/current-release")"
  prev_fingerprint="$(cut -d' ' -f2 "$STATE_DIR/current-release")"
fi
section "release $RELEASE ($ref)  env=$ENV_FILE  lock=$LOCK_FILE"
echo "migration fingerprint: $migration_fingerprint (직전 성공 릴리스: ${prev_release:-없음} / ${prev_fingerprint:-없음})"
if [[ -n "$prev_fingerprint" && "$prev_fingerprint" != "$migration_fingerprint" ]]; then
  echo "이번 배포에 DB 마이그레이션 변경이 포함됨 → 실패 시 자동 롤백하지 않음"
fi

# 내부 readiness → nginx http → (TLS 켜져 있으면) 공개 도메인 https. 하나라도 실패하면 1.
check_health() {
  curl -fsS --max-time 10 http://127.0.0.1:18080/actuator/health/readiness | grep -q '"UP"' || { echo "backend readiness 실패" >&2; return 1; }
  echo "backend readiness UP"
  curl -fsS --max-time 10 -o /dev/null -w "web http %{http_code}\n" http://127.0.0.1/nginx-health || { echo "web http 헬스 실패" >&2; return 1; }
  if [[ "$(envval TLS_ENABLED)" == "true" ]]; then
    local domain; domain="$(envval DOMAIN)"
    curl -fsS --max-time 10 -o /dev/null -w "web https %{http_code} (${domain})\n" --resolve "${domain}:443:127.0.0.1" "https://${domain}/nginx-health" \
      || { echo "web https 헬스 실패 (${domain})" >&2; return 1; }
  fi
}

# 기동·헬스 실패 공통 처리. 지문이 직전 성공 릴리스와 같고 그 이미지가 남아 있으면 코드만 되돌린다.
# 복구 시도 자체가 실패하면 상태 파일은 건드리지 않고(무엇이 돌고 있는지 확신할 수 없다) last-failed-release 만 남긴다.
rollback_or_explain() {
  local why="$1"
  echo "배포 실패 ($why): $RELEASE" >&2
  "${COMPOSE[@]}" ps >&2 || true
  echo "$RELEASE $migration_fingerprint $(date -Is) $(id -un) $why" > "$STATE_DIR/last-failed-release" 2>/dev/null || true
  if [[ -n "$prev_release" && "$prev_release" != "$RELEASE" && "$prev_fingerprint" == "$migration_fingerprint" ]] \
     && docker image inspect "b102-backend:$prev_release" "b102-web:$prev_release" >/dev/null 2>&1; then
    echo "마이그레이션 지문이 같아 직전 릴리스 $prev_release 로 코드 자동 복구" >&2
    if RELEASE="$prev_release" "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 300 >&2 && check_health >&2; then
      echo "직전 릴리스 $prev_release 복구 완료 (current-release 는 그대로 $prev_release)" >&2
    else
      echo "자동 복구도 실패. 수동 조치 필요. 현재 무엇이 돌고 있는지 docker compose ps 로 확인" >&2
    fi
  else
    local backup_dir; backup_dir="$(envval BACKUP_DIR)"; backup_dir="${backup_dir:-/var/lib/b102/backups}"
    echo "자동 복구 안 함 (마이그레이션 변경 포함 또는 직전 이미지 없음). 배포 전 백업: ${backup_dir}/pre_${RELEASE}_*.sql.gz (마이그레이션 포함 배포에만 있음), 일일 백업: ${backup_dir}/bookdb_*.sql.gz" >&2
  fi
}

# 배포 전 pg_dump 는 이번 배포에 DB 마이그레이션이 들어 있을 때(지문 변경)와 직전 릴리스 기록이 없을 때만 뜬다(09-16).
# 코드만 바뀐 배포는 실패해도 코드 롤백으로 끝나고 DB 는 건드리지 않으므로 덤프가 쓰일 일이 없다 — 5GB DB 덤프가 배포마다 2.5~3분을 먹었다.
# 일일 백업(bookdb_*, 크론)은 그대로다. 억지로 뜨려면 --force-backup.
if $BACKUP; then
  section "배포 전 pg_dump"
  if ! docker ps --format '{{.Names}}' | grep -qx b102-postgres; then
    echo "postgres 컨테이너가 없어 건너뜀 (첫 배포)"
  elif ! $FORCE_BACKUP && [[ -n "$prev_fingerprint" && "$prev_fingerprint" == "$migration_fingerprint" ]]; then
    echo "마이그레이션 지문이 직전 성공 릴리스와 같아 건너뜀 (코드만 바뀐 배포). 억지로 뜨려면 --force-backup. 일일 백업은 크론이 계속 남긴다"
  else
    ENV_FILE="$ENV_FILE" bash "$REPO_ROOT/deploy/scripts/backup-postgres.sh" --prefix "pre_${RELEASE}" --keep 5
  fi
fi

section "build"
"${COMPOSE[@]}" build --pull=false web backend elasticsearch

section "up"
if ! "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 300; then
  rollback_or_explain "compose up --wait 실패"
  exit 1
fi

section "health"
if ! check_health; then
  rollback_or_explain "배포 후 헬스체크 실패"
  exit 1
fi

section "state"
[[ -n "$prev_release" && "$prev_release" != "$RELEASE" ]] && echo "$prev_release $prev_fingerprint" > "$STATE_DIR/previous-release"
echo "$RELEASE $migration_fingerprint $(date -Is) $(id -un)" > "$STATE_DIR/current-release"
rm -f "$STATE_DIR/last-failed-release" 2>/dev/null || true
echo "current: $(cat "$STATE_DIR/current-release")"

section "prune"
docker image prune -f >/dev/null
"${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'
echo "B102_DEPLOYED=$RELEASE"
