#!/usr/bin/env bash
# 프론트엔드 CI: node:24 컨테이너에서 npm ci → lint → build. 호스트에 Node 불필요.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
ci_prepare_docker
ci_check_memory 2500

readonly NODE_IMAGE="${CI_NODE_IMAGE:-node:24-bookworm-slim}"
readonly FE_HOME="$CI_CACHE_ROOT/home-frontend"
readonly NPM_CACHE="$CI_CACHE_ROOT/npm"
mkdir -p "$FE_HOME" "$NPM_CACHE"

ci_section "frontend: npm ci / lint / build ($NODE_IMAGE)"
docker run --rm \
  --user "$CI_UID:$CI_GID" \
  --memory 2g --memory-swap 2g \
  --env CI=true --env TZ=Asia/Seoul \
  --env "HOME=$FE_HOME" \
  --env "npm_config_cache=$NPM_CACHE" \
  --env VITE_API_BASE_URL=/api/v1 --env VITE_ENABLE_MSW=false \
  --volume "$CI_REPO_ROOT:$CI_REPO_ROOT" \
  --volume "$NPM_CACHE:$NPM_CACHE" \
  --workdir "$CI_REPO_ROOT/frontend" \
  "$NODE_IMAGE" \
  bash -euo pipefail -c 'npm ci --no-audit --no-fund && npm run lint && npm run build && test -f dist/index.html'
echo "frontend CI OK"
