#!/bin/sh
# nginx 공식 이미지의 20-envsubst 가 /etc/nginx/templates/*.template 을 렌더링한다.
# TLS_ENABLED 에 따라 HTTP 전용 / HTTPS 템플릿 중 하나만 넣어준다.
set -eu
if [ "${TLS_ENABLED:-false}" = "true" ]; then
  src=/opt/nginx-templates/tls.conf.template
else
  src=/opt/nginx-templates/http.conf.template
fi
cp "$src" /etc/nginx/templates/default.conf.template
echo "nginx template: $src (TLS_ENABLED=${TLS_ENABLED:-false}, DOMAIN=${DOMAIN:-unset})"
