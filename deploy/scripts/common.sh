#!/usr/bin/env bash
# 배포 스크립트 공통. deploy.sh · backup-postgres.sh · issue-cert.sh · renew-cert.sh 가 source 한다.
# shellcheck disable=SC2034  # 여기서 정의한 변수는 source 하는 쪽이 쓴다
#
# 경로 규칙 (setup-cd.sh 가 만든 /etc/b102 가 있으면 그것을, 없으면 저장소 안 파일을 쓴다):
#   ENV_FILE   운영 비밀값   /etc/b102/deploy.env   (root:b102 640)   ← 없으면 $REPO_ROOT/deploy/.env
#   LOCK_FILE  배포 락       /etc/b102/deploy.lock  (root:b102 660)   ← 없으면 $REPO_ROOT/deploy/.deploy.lock
#   STATE_DIR  릴리스 상태   /var/lib/b102          (root:b102 2770)  ← 없으면 $REPO_ROOT/deploy/.state
# 수동 배포(ubuntu, ~/S15P21B102)와 Jenkins 배포(jenkins, workspace)가 같은 env·락·상태를 공유하게 하는 것이 목적이다.
set -euo pipefail

_common_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$_common_dir/../.." && pwd)"
B102_ETC="${B102_ETC:-/etc/b102}"

if [[ -z "${ENV_FILE:-}" ]]; then
  if [[ -f "$B102_ETC/deploy.env" ]]; then ENV_FILE="$B102_ETC/deploy.env"; else ENV_FILE="$REPO_ROOT/deploy/.env"; fi
fi
if [[ -z "${LOCK_FILE:-}" ]]; then
  if [[ -d "$B102_ETC" ]]; then LOCK_FILE="$B102_ETC/deploy.lock"; else LOCK_FILE="$REPO_ROOT/deploy/.deploy.lock"; fi
fi
if [[ -z "${STATE_DIR:-}" ]]; then
  if [[ -d /var/lib/b102 ]]; then STATE_DIR=/var/lib/b102; else STATE_DIR="$REPO_ROOT/deploy/.state"; fi
fi

# env 파일에서 값 하나 읽기. source 는 공백 포함 값(ES_JAVA_OPTS)에서 깨지므로 쓰지 않는다.
envval() {
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-     | sed -E -e 's/[[:space:]]+#.*$//' -e 's/^[[:space:]]+//' -e 's/[[:space:]]+$//'     | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# env 파일 존재·권한 검사. 600(개인) 또는 640/660(그룹 b102)만 허용. 다른 사용자에게 읽히면 중단.
require_env_file() {
  [[ -f "$ENV_FILE" ]] || { echo "env 파일이 없습니다: $ENV_FILE (deploy/.env.example 참고)" >&2; exit 1; }
  local mode; mode="$(stat -c %a "$ENV_FILE")"
  case "$mode" in 600|640|660) ;; *) echo "env 파일 권한이 $mode 입니다. 600 또는 640 이어야 합니다: $ENV_FILE" >&2; exit 1;; esac
  [[ -r "$ENV_FILE" ]] || { echo "env 파일을 읽을 수 없습니다: $ENV_FILE ($(id -un) 이 b102 그룹인지 확인)" >&2; exit 1; }
}

# 배포 락. fd 9 를 열어 flock. 파일이 없으면 만든다(그룹 660). 읽기 fd 로도 flock 이 되므로 root 소유 660 파일도 그룹이면 잠글 수 있다.
acquire_deploy_lock() {
  if [[ ! -e "$LOCK_FILE" ]]; then
    ( umask 007; : > "$LOCK_FILE" ) 2>/dev/null || { echo "락 파일을 만들 수 없습니다: $LOCK_FILE" >&2; exit 1; }
  fi
  exec 9<>"$LOCK_FILE" 2>/dev/null || exec 9<"$LOCK_FILE"
  flock -n 9 || { echo "다른 배포가 진행 중입니다 (락: $LOCK_FILE)" >&2; exit 1; }
}

section() { printf '\n== %s ==\n' "$*"; }
