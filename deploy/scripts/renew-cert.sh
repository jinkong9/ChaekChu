#!/usr/bin/env bash
# 인증서 갱신 (cron: 매일 새벽). 갱신됐을 때만 nginx reload. certbot 실패는 그대로 실패로 끝낸다.
#   0 4 * * * /home/ubuntu/S15P21B102/deploy/scripts/renew-cert.sh >> /home/ubuntu/certbot.log 2>&1
set -euo pipefail
log="$(mktemp)"; trap 'rm -f "$log"' EXIT
if ! docker run --rm -v b102_letsencrypt:/etc/letsencrypt -v b102_certbot-www:/var/www/certbot      certbot/certbot renew --webroot -w /var/www/certbot --quiet >"$log" 2>&1; then
  echo "$(date -Is) RENEW FAILED"; cat "$log"; exit 1
fi
if grep -qi "renewed" "$log"; then
  docker exec b102-web nginx -s reload
  echo "$(date -Is) renewed + nginx reloaded"
else
  echo "$(date -Is) no renewal due"
fi
