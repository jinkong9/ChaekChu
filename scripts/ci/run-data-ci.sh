#!/usr/bin/env bash
# 데이터 CI: database/*/tests 의 표준 라이브러리 unittest 를 python:3.12 컨테이너에서 실행. ai/ 는 대상 아님.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
ci_prepare_docker

readonly PY_IMAGE="${CI_PY_IMAGE:-python:3.12-slim}"
mapfile -t suites < <(find "$CI_REPO_ROOT/database" -mindepth 2 -maxdepth 2 -type d -name tests | sort)
(( ${#suites[@]} > 0 )) || { echo "database/*/tests 가 없습니다" >&2; exit 1; }

failed=0
for tests_dir in "${suites[@]}"; do
  component_dir="$(dirname "$tests_dir")"
  ci_section "data: ${component_dir#"$CI_REPO_ROOT"/} ($PY_IMAGE)"
  if ! docker run --rm \
      --user "$CI_UID:$CI_GID" \
      --memory 1g \
      --env HOME=/tmp --env PYTHONDONTWRITEBYTECODE=1 --env PYTHONIOENCODING=utf-8 --env LANG=C.UTF-8 --env TZ=Asia/Seoul \
      --volume "$CI_REPO_ROOT:$CI_REPO_ROOT" \
      --workdir "$component_dir" \
      "$PY_IMAGE" \
      python -m unittest discover -s tests -p 'test_*.py' -v; then
    failed=1
  fi
done
(( failed == 0 )) || { echo "data CI 실패" >&2; exit 1; }
echo "data CI OK (${#suites[@]} suites)"
