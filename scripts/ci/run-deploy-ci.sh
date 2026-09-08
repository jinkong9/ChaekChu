#!/usr/bin/env bash
# 배포·CI 구성 검증: 셸 문법 + ShellCheck, compose 렌더링(운영·로컬·백엔드 CI), python 컴파일. 실제 이미지 빌드는 하지 않는다.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
ci_prepare_docker

readonly SHELLCHECK_IMAGE="${CI_SHELLCHECK_IMAGE:-koalaman/shellcheck-alpine:v0.10.0}"
cd "$CI_REPO_ROOT"

ci_section "deploy: bash -n"
mapfile -t shell_files < <(git ls-files -- '*.sh' | sort)
for f in "${shell_files[@]}"; do bash -n "$f"; done
echo "${#shell_files[@]} scripts"

ci_section "deploy: shellcheck ($SHELLCHECK_IMAGE)"
docker run --rm \
  --volume "$CI_REPO_ROOT:$CI_REPO_ROOT:ro" --workdir "$CI_REPO_ROOT" \
  "$SHELLCHECK_IMAGE" \
  shellcheck --severity=warning --external-sources --exclude=SC1091 "${shell_files[@]}"

ci_section "deploy: compose 렌더링"
DOMAIN=ci.example POSTGRES_PASSWORD=ci ELASTIC_PASSWORD=ci QDRANT_API_KEY=ci \
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example --profile recsys config --quiet
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local.example --profile recsys config --quiet
docker compose -f backend/docker-compose.yml -f scripts/ci/compose.backend-ci.yml config --quiet
echo "3 compose stacks OK"

ci_section "deploy: python 구문 검사 (scripts/ci)"
# py_compile 은 .pyc 를 쓰려 해서 읽기 전용 마운트에서 실패한다. ast 로 파싱만 한다.
docker run --rm --user "$CI_UID:$CI_GID" --env HOME=/tmp \
  --volume "$CI_REPO_ROOT:$CI_REPO_ROOT:ro" --workdir "$CI_REPO_ROOT" \
  python:3.12-slim python -c 'import ast, sys
for f in sys.argv[1:]:
    ast.parse(open(f, encoding="utf-8").read(), f)
print(f"{len(sys.argv) - 1} files parsed")' scripts/ci/changed_components.py scripts/ci/tests/test_changed_components.py
echo "deploy CI OK"
