#!/usr/bin/env bash
# 토큰 파일이 놓인 뒤 실행. GitLab 프로젝트 ID 를 조회해 기록하고 init.groovy 를 설치·재시작·검증한다. 재실행 안전.
#   sudo bash deploy/jenkins/apply-config.sh
set -euo pipefail
[[ "$(id -u)" -eq 0 ]] || { echo "sudo 로 실행하세요" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S=/var/lib/jenkins/secrets/b102
GITLAB=https://lab.ssafy.com
PROJECT_PATH="s15-bigdata-recom-sub1/S15P21B102"

for f in admin-password webhook-secret gitlab-checkout-token gitlab-status-token; do
  [[ -s "$S/$f" ]] || { echo "없음 또는 비어 있음: $S/$f  (README 의 토큰 넣기 절차 참고)" >&2; exit 1; }
done
chown jenkins:jenkins "$S"/*; chmod 0600 "$S"/*

echo "== GitLab 토큰 검증 + 프로젝트 ID 조회 =="
enc="${PROJECT_PATH//\//%2F}"
json="$(curl -fsS --max-time 20 -H "PRIVATE-TOKEN: $(cat "$S/gitlab-status-token")" "$GITLAB/api/v4/projects/$enc")" \
  || { echo "status 토큰으로 프로젝트 조회 실패. 토큰 scope(api)·만료·경로 확인" >&2; exit 1; }
pid="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["id"])' "$json")"
printf '%s\n' "$pid" > "$S/gitlab-project-id"; chown jenkins:jenkins "$S/gitlab-project-id"; chmod 0600 "$S/gitlab-project-id"
echo "project id: $pid"
# checkout 토큰은 read_repository 만 있어 /projects 조회가 안 될 수 있다. git ls-remote 로 검증
GIT_TERMINAL_PROMPT=0 git ls-remote --heads "https://b102-jenkins-checkout:$(cat "$S/gitlab-checkout-token")@lab.ssafy.com/$PROJECT_PATH.git" dev >/dev/null \
  || { echo "checkout 토큰으로 git ls-remote 실패. scope(read_repository)·role(Reporter 이상) 확인" >&2; exit 1; }
echo "checkout 토큰 OK"

echo "== init.groovy 설치 + 재시작 =="
install -d -o jenkins -g jenkins -m 0750 /var/lib/jenkins/init.groovy.d
install -o jenkins -g jenkins -m 0640 "$HERE/configure-jenkins.groovy" /var/lib/jenkins/init.groovy.d/b102-configure.groovy
since="$(date -Is)"
systemctl restart jenkins.service
for _ in $(seq 1 90); do curl -fs -o /dev/null http://127.0.0.1:8080/login && break; sleep 2; done
sleep 3
if journalctl -u jenkins --since "$since" --no-pager | grep -q B102_JENKINS_CONFIGURATION_COMPLETE; then
  echo "groovy 완료"
else
  echo "groovy 완료 표시 없음. 로그:" >&2
  journalctl -u jenkins --since "$since" --no-pager | grep -iE "exception|error|b102|groovy" | tail -20 >&2
  exit 1
fi

echo "== 검증 =="
auth="admin:$(cat "$S/admin-password")"
# tree= 의 [ ] 는 curl URL globbing 에 걸린다 → --globoff
curl -fs --globoff -u "$auth" "http://127.0.0.1:8080/job/b102/api/json?tree=name,sources[source[serverName,projectPath]]" | python3 -m json.tool
curl -fs --globoff -u "$auth" "http://127.0.0.1:8080/computer/api/json?tree=totalExecutors" ; echo
echo "익명 접근(401/403 이어야): $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/json)"
echo
echo "다음 (GitLab UI, Settings > Webhooks):"
echo "  URL            https://j15b102.p.ssafy.io/gitlab-webhook/post"
echo "  Secret token   sudo cat $S/webhook-secret"
echo "  Trigger        Merge request events, Push events (branch filter: dev)"
echo "  SSL verify     켬"
echo "B102_JENKINS_APPLY_COMPLETE"
