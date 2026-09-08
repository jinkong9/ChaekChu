#!/usr/bin/env bash
# CI 스크립트 공통. 각 run-*-ci.sh 가 source 한다.
# 원칙: Jenkins 호스트에는 Node·Java·Python 을 깔지 않는다. 전부 고정 버전 docker 이미지 안에서 실행한다.
# shellcheck disable=SC2034  # 여기서 정의한 변수는 source 하는 run-*-ci.sh 가 쓴다
set -euo pipefail

ci_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CI_REPO_ROOT="$(cd "$ci_script_dir/../.." && pwd)"
CI_UID="$(id -u)"
CI_GID="$(id -g)"
# Jenkins 는 전역 env B102_CI_CACHE_ROOT=/var/lib/jenkins/.cache/b102 를 준다. 로컬 실행이면 저장소 안 .cache
CI_CACHE_ROOT="${B102_CI_CACHE_ROOT:-$CI_REPO_ROOT/.cache}"
readonly CI_REPO_ROOT CI_UID CI_GID CI_CACHE_ROOT

ci_require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "필수 명령을 찾을 수 없습니다: $1" >&2; exit 1; }
}

ci_prepare_docker() {
  ci_require_command docker
  docker info >/dev/null 2>&1 || { echo "docker daemon 에 접근할 수 없습니다 (jenkins 유저가 docker 그룹인지 확인)" >&2; exit 1; }
}

# 운영 컨테이너와 같은 서버에서 돈다. 빌드 컨테이너가 상한 밖에서 메모리를 먹으므로 시작 전 여유를 확인한다.
ci_check_memory() {
  local need_mb="${1:-3000}" avail_mb
  avail_mb="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 99999)"
  if (( avail_mb < need_mb )); then
    echo "가용 메모리 ${avail_mb}MB < 필요 ${need_mb}MB. 운영 컨테이너를 보호하기 위해 CI 를 중단합니다." >&2
    exit 1
  fi
  if docker ps --format '{{.Names}}' | grep -qx 'b102-qdrant' && [[ "${B102_ALLOW_BUILD_WITH_QDRANT:-false}" != "true" ]]; then
    echo "운영 Qdrant 가 켜져 있습니다. 메모리 과밀을 피하려 CI 를 중단합니다 (B102_ALLOW_BUILD_WITH_QDRANT=true 로 강제 가능)." >&2
    exit 1
  fi
}

ci_section() { printf '\n== %s ==\n' "$*"; }
