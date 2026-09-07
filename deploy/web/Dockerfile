# web = 프론트엔드 정적 파일 + 리버스 프록시(nginx). 빌드 컨텍스트는 저장소 루트.
#   docker build -f deploy/web/Dockerfile -t b102-web .

# 1) 프론트엔드 빌드
FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_ENABLE_MSW=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_ENABLE_MSW=$VITE_ENABLE_MSW
RUN npm run build && rm -f dist/mockServiceWorker.js

# 2) nginx
FROM nginx:1.30-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/web/nginx/nginx.conf            /etc/nginx/nginx.conf
COPY deploy/web/nginx/snippets/             /etc/nginx/snippets/
COPY deploy/web/nginx/templates/            /opt/nginx-templates/
COPY deploy/web/nginx/entrypoint/10-select-template.sh /docker-entrypoint.d/10-select-template.sh
RUN chmod +x /docker-entrypoint.d/10-select-template.sh && mkdir -p /etc/nginx/templates /var/www/certbot
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
