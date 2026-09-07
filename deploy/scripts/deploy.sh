#!/usr/bin/env bash
# 서버에서 실행. 저장소 최신을 받아 이미지를 빌드하고 compose 를 갱신한다.
#   bash deploy/scripts/deploy.sh            # dev 최신
#   bash deploy/scripts/deploy.sh --no-pull  # 현재 체크아웃 그대로
#   PROFILES="--profile recsys" bash deploy/scripts/deploy.sh   # qdrant 포함
# 나중에 Jenkins 가 이 스크립트를 그대로 호출한다.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "$REPO_ROOT/deploy/docker-compose.yml" ${PROFILES:-})
BRANCH="${BRANCH:-dev}"
PULL=true
[[ "${1:-}" == "--no-pull" ]] && PULL=false

[[ -f "$REPO_ROOT/deploy/.env" ]] || { echo "deploy/.env 가 없습니다. deploy/.env.example 을 복사해 채우세요." >&2; exit 1; }
[[ "$(stat -c %a "$REPO_ROOT/deploy/.env")" == "600" ]] || echo "경고: deploy/.env 권한이 600 이 아닙니다"

if $PULL; then
  git -C "$REPO_ROOT" fetch -q origin "$BRANCH"
  git -C "$REPO_ROOT" checkout -q "$BRANCH"
  git -C "$REPO_ROOT" reset -q --hard "origin/$BRANCH"
fi
RELEASE="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
export RELEASE
echo "== release $RELEASE ($(git -C "$REPO_ROOT" branch --show-current)) =="

exec 9>"$REPO_ROOT/deploy/.deploy.lock"; flock -n 9 || { echo "다른 배포가 진행 중" >&2; exit 1; }

echo "== build =="
"${COMPOSE[@]}" build --pull=false web backend elasticsearch

echo "== up =="
"${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 300

echo "== health =="
curl -fsS http://127.0.0.1:18080/actuator/health/readiness; echo
curl -fsS -o /dev/null -w "web http %{http_code}\n" http://127.0.0.1/nginx-health

echo "== prune =="
docker image prune -f >/dev/null
"${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'
echo "B102_DEPLOYED=$RELEASE"
