#!/usr/bin/env bash
# 백엔드 CI: CI 전용 PG+ES(nori) 를 임시 compose 프로젝트로 띄우고 eclipse-temurin:21 컨테이너에서 gradle test.
# 끝나면 임시 컨테이너·볼륨을 항상 제거한다.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
ci_prepare_docker
ci_check_memory 3500

readonly JAVA_IMAGE="${CI_JAVA_IMAGE:-eclipse-temurin:21-jdk-noble}"
readonly BE_HOME="$CI_CACHE_ROOT/home-backend"
readonly GRADLE_HOME="$CI_CACHE_ROOT/gradle"
readonly CI_PROJECT="b102-ci"
readonly CI_NETWORK="${CI_PROJECT}_default"
mkdir -p "$BE_HOME" "$GRADLE_HOME" "$CI_REPO_ROOT/backend/build"

COMPOSE=(docker compose -p "$CI_PROJECT"
  -f "$CI_REPO_ROOT/backend/docker-compose.yml"
  -f "$CI_REPO_ROOT/scripts/ci/compose.backend-ci.yml")

cleanup() {
  ci_section "backend: CI 인프라 정리"
  "${COMPOSE[@]}" down -v --remove-orphans --timeout 20 >/dev/null 2>&1 || true
}
trap cleanup EXIT

ci_section "backend: 이전 빌드 잔여물 제거"
"${COMPOSE[@]}" down -v --remove-orphans --timeout 5 >/dev/null 2>&1 || true

ci_section "backend: CI 용 PostgreSQL + Elasticsearch(nori) 기동"
"${COMPOSE[@]}" up -d --wait --wait-timeout 240 postgres elasticsearch
"${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Status}}'

ci_section "backend: gradle test ($JAVA_IMAGE)"
docker run --rm \
  --user "$CI_UID:$CI_GID" \
  --network "$CI_NETWORK" \
  --memory 2g --memory-swap 2g \
  --env CI=true --env TZ=UTC \
  --env "HOME=$BE_HOME" \
  --env "GRADLE_USER_HOME=$GRADLE_HOME" \
  --env "GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx1g -Dorg.gradle.daemon=false" \
  --env DB_URL=jdbc:postgresql://postgres:5432/bookdb \
  --env DB_USERNAME=book --env DB_PASSWORD=book \
  --env ES_URIS=http://elasticsearch:9200 \
  --env LOG_LEVEL_APP=INFO \
  --volume "$CI_REPO_ROOT:$CI_REPO_ROOT" \
  --volume "$GRADLE_HOME:$GRADLE_HOME" \
  --workdir "$CI_REPO_ROOT/backend" \
  "$JAVA_IMAGE" \
  bash -euo pipefail -c 'chmod +x gradlew && ./gradlew test --no-daemon --stacktrace --console=plain'
echo "backend CI OK"
