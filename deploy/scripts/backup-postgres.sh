#!/usr/bin/env bash
# pg_dump 를 gzip 으로 ~/backups/postgres/ 에 저장. 7세대 보관.
#   0 3 * * * /home/ubuntu/S15P21B102/deploy/scripts/backup-postgres.sh >> /home/ubuntu/backup-postgres.log 2>&1
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# deploy/.env 에서 값 하나 읽기. source 는 공백 포함 값(ES_JAVA_OPTS)에서 깨지므로 쓰지 않는다.
envval() { grep -E "^$1=" "$REPO_ROOT/deploy/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
POSTGRES_PASSWORD="$(envval POSTGRES_PASSWORD)"; POSTGRES_USER="$(envval POSTGRES_USER)"; POSTGRES_DB="$(envval POSTGRES_DB)"; BACKUP_DIR="$(envval BACKUP_DIR)"
DEST="${BACKUP_DIR:-$HOME/backups/postgres}"; mkdir -p "$DEST"
file="$DEST/bookdb_$(date +%Y%m%d_%H%M).sql.gz"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" b102-postgres \
  pg_dump -U "${POSTGRES_USER:-book}" -d "${POSTGRES_DB:-bookdb}" --no-owner | gzip -6 > "$file.tmp"
mv "$file.tmp" "$file"
ls -1t "$DEST"/bookdb_*.sql.gz | tail -n +8 | xargs -r rm -f
echo "$(date -Is) $(du -h "$file" | cut -f1) $file"
