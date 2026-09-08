#!/usr/bin/env bash
# pg_dump 를 gzip 으로 저장한다. 크론(일일)과 deploy.sh(배포 전) 가 같이 쓴다.
#   backup-postgres.sh                              # bookdb_<시각>.sql.gz, 7세대
#   backup-postgres.sh --prefix pre_<sha> --keep 5  # 배포 전 스냅샷, 접두어별 세대 관리
#   0 18 * * * /home/ubuntu/S15P21B102/deploy/scripts/backup-postgres.sh >> /home/ubuntu/backup-postgres.log 2>&1
set -euo pipefail
# shellcheck source=deploy/scripts/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PREFIX="bookdb"; KEEP=7
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 1 ;;
  esac
done
[[ "$PREFIX" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "잘못된 prefix: $PREFIX" >&2; exit 1; }

require_env_file
POSTGRES_PASSWORD="$(envval POSTGRES_PASSWORD)"; POSTGRES_USER="$(envval POSTGRES_USER)"; POSTGRES_DB="$(envval POSTGRES_DB)"
DEST="$(envval BACKUP_DIR)"; DEST="${DEST:-/var/lib/b102/backups}"    # /home/ubuntu 아래는 jenkins 가 진입 불가
mkdir -p "$DEST"
[[ -w "$DEST" ]] || { echo "백업 디렉터리에 쓸 수 없습니다: $DEST" >&2; exit 1; }

file="$DEST/${PREFIX}_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" b102-postgres \
  pg_dump -U "${POSTGRES_USER:-book}" -d "${POSTGRES_DB:-bookdb}" --no-owner | gzip -6 > "$file.tmp"
mv "$file.tmp" "$file"
chmod 640 "$file" 2>/dev/null || true
# 같은 접두어 계열만 세대 정리. pre_<sha>_ 는 "pre_" 계열로 묶어 KEEP 개 유지
family="${PREFIX%%_*}"
ls -1t "$DEST"/"${family}"_*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "$(date -Is) $(du -h "$file" | cut -f1) $file"
