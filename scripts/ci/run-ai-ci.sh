#!/usr/bin/env bash
# AI CI: Python 컨테이너에서 패키지·테스트를 검증하고 Jenkins가 결과 XML을 보관한다.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
ci_prepare_docker
ci_check_memory 1500

readonly PY_IMAGE="${CI_AI_IMAGE:-python:3.12-slim}"
readonly PIP_CACHE="$CI_CACHE_ROOT/pip"
readonly AI_BUILD="$CI_REPO_ROOT/ai/build"
mkdir -p "$PIP_CACHE" "$AI_BUILD/test-results"

ci_section "AI: package install and pytest ($PY_IMAGE)"
docker run --rm --user "$CI_UID:$CI_GID" --memory 1g --memory-swap 1g --env HOME=/tmp --env PIP_CACHE_DIR="$PIP_CACHE" --env PYTHONDONTWRITEBYTECODE=1 --volume "$CI_REPO_ROOT:$CI_REPO_ROOT" --volume "$PIP_CACHE:$PIP_CACHE" --workdir "$CI_REPO_ROOT/ai" "$PY_IMAGE" bash -euo pipefail -c 'python -m pip install --disable-pip-version-check ".[dev]" && python -m pytest -p no:cacheprovider --junitxml=build/test-results/pytest.xml'
echo "AI CI OK"
