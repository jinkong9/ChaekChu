#!/usr/bin/env bash
# pg_dump 를 gzip 으로 ~/backups/postgres/ 에 저장. 7세대 보관.
#   0 3 * * * /home/ubuntu/S15P21B102/deploy/scripts/backup-postgres.sh >> /home/ubuntu/backup-postgres.log 2>&1
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; source "$REPO_ROOT/deploy/.env"; set +a
DEST="${BACKUP_DIR:-$HOME/backups/postgres}"; mkdir -p "$DEST"
file="$DEST/bookdb_$(date +%Y%m%d_%H%M).sql.gz"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" b102-postgres \
  pg_dump -U "${POSTGRES_USER:-book}" -d "${POSTGRES_DB:-bookdb}" --no-owner | gzip -6 > "$file.tmp"
mv "$file.tmp" "$file"
ls -1t "$DEST"/bookdb_*.sql.gz | tail -n +8 | xargs -r rm -f
echo "$(date -Is) $(du -h "$file" | cut -f1) $file"
