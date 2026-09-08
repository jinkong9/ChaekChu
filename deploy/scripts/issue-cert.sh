#!/usr/bin/env bash
# Let's Encrypt 최초 발급. web 컨테이너가 TLS_ENABLED=false 로 80 에서 떠 있어야 한다(ACME webroot).
#   bash deploy/scripts/issue-cert.sh
# 성공하면 deploy/.env 의 TLS_ENABLED 를 true 로 바꾸고 web 을 재기동한다.
set -euo pipefail
# shellcheck source=deploy/scripts/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env_file
DOMAIN="$(envval DOMAIN)"; LETSENCRYPT_EMAIL="$(envval LETSENCRYPT_EMAIL)"
: "${DOMAIN:?}" "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL 필요}"

docker run --rm \
  -v b102_letsencrypt:/etc/letsencrypt \
  -v b102_certbot-www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --non-interactive ${CERTBOT_EXTRA:-}

echo "발급 완료. 다음:"
echo "  sudo sed -i 's/^TLS_ENABLED=.*/TLS_ENABLED=true/' $ENV_FILE"
echo "  docker compose -f deploy/docker-compose.yml up -d web"
