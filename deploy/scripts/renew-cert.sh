#!/usr/bin/env bash
# 인증서 갱신 (cron: 매일 새벽). 갱신됐을 때만 nginx reload.
#   0 4 * * * /home/ubuntu/S15P21B102/deploy/scripts/renew-cert.sh >> /home/ubuntu/certbot.log 2>&1
set -euo pipefail
out="$(docker run --rm -v b102_letsencrypt:/etc/letsencrypt -v b102_certbot-www:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet 2>&1 || true)"
echo "$(date -Is) $out"
if echo "$out" | grep -qi "renewed"; then docker exec b102-web nginx -s reload; fi
