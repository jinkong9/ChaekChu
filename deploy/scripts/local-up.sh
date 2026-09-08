#!/usr/bin/env bash
# 로컬에서 전체 스택(web·backend·postgres·elasticsearch) 을 띄운다. Git Bash / macOS / Linux.
#   bash deploy/scripts/local-up.sh            # 빌드 + 기동
#   bash deploy/scripts/local-up.sh down       # 중지 (데이터 유지)
#   bash deploy/scripts/local-up.sh down -v    # 중지 + 데이터 삭제
#   bash deploy/scripts/local-up.sh logs -f backend
#   PROFILES="--profile recsys" bash deploy/scripts/local-up.sh   # qdrant 포함
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/deploy/.env.local"
[[ -f "$ENV_FILE" ]] || { cp "$REPO_ROOT/deploy/.env.local.example" "$ENV_FILE"; echo "deploy/.env.local 을 견본에서 생성했습니다."; }

read -r -a profile_args <<< "${PROFILES:-}"
C=(docker compose -f "$REPO_ROOT/deploy/docker-compose.yml" -f "$REPO_ROOT/deploy/docker-compose.local.yml" --env-file "$ENV_FILE" "${profile_args[@]}")
if [[ $# -eq 0 ]]; then
  "${C[@]}" up -d --build --wait --wait-timeout 300
  echo
  echo "  웹        http://localhost:8088"
  echo "  Swagger   http://localhost:8088/swagger-ui/index.html"
  echo "  backend   http://localhost:18080/actuator/health"
  echo "  postgres  localhost:15432  (book / \$POSTGRES_PASSWORD / bookdb)"
  echo "  ES        localhost:19200  (elastic / \$ELASTIC_PASSWORD)"
  "${C[@]}" ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
else
  "${C[@]}" "$@"
fi
