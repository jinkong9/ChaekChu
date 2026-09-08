#!/usr/bin/env bash
# CD 준비 (최초 1회, 재실행 안전). sudo 로 실행한다.
#   sudo bash deploy/scripts/setup-cd.sh
# 하는 일:
#   - 그룹 b102 (ubuntu, jenkins) — 수동 배포와 Jenkins 배포가 같은 파일을 읽고 잠글 수 있게
#   - /etc/b102/deploy.env   운영 비밀값. 저장소 안 deploy/.env 를 여기로 옮긴다 (root:b102 640)
#   - /etc/b102/deploy.lock  공용 배포 락 (root:b102 660)
#   - /var/lib/b102          릴리스 상태 (current-release, previous-release) (root:b102 2770)
#   - /etc/b102/git/credentials  서버 작업 트리가 GitLab 을 HTTPS 로 pull 할 때 쓰는 읽기 토큰 (Jenkins checkout 토큰 재사용)
#   - CD gate 는 만들지 않는다. 자동 배포를 켤 때 `sudo touch /etc/b102/cd-enabled`
set -euo pipefail
[[ "$(id -u)" -eq 0 ]] || { echo "sudo 로 실행하세요" >&2; exit 1; }

ETC=/etc/b102; STATE=/var/lib/b102
REPO="${REPO:-/home/ubuntu/S15P21B102}"
JENKINS_TOKEN=/var/lib/jenkins/secrets/b102/gitlab-checkout-token
GIT_USER=b102-jenkins-checkout
GIT_HOST=lab.ssafy.com
GIT_PATH=s15-bigdata-recom-sub1/S15P21B102.git

echo "== 1/5 그룹 b102 =="
getent group b102 >/dev/null || groupadd --system b102
jenkins_needs_restart=false
id -nG jenkins 2>/dev/null | grep -qw b102 || jenkins_needs_restart=true
for u in ubuntu jenkins; do id "$u" >/dev/null 2>&1 && usermod -aG b102 "$u"; done
getent group b102

echo "== 2/5 /etc/b102 =="
install -d -o root -g b102 -m 0750 "$ETC"
if [[ ! -f "$ETC/deploy.env" ]]; then
  if [[ -f "$REPO/deploy/.env" ]]; then
    install -o root -g b102 -m 0640 "$REPO/deploy/.env" "$ETC/deploy.env"
    mv "$REPO/deploy/.env" "$REPO/deploy/.env.moved-to-etc-b102"
    echo "deploy/.env → $ETC/deploy.env 로 이동 (원본은 .env.moved-to-etc-b102 로 이름 변경, 확인 후 삭제)"
  else
    echo "deploy/.env 가 없어 $ETC/deploy.env 를 만들지 못했습니다. deploy/.env.example 을 참고해 직접 만드세요." >&2
  fi
else
  chown root:b102 "$ETC/deploy.env"; chmod 0640 "$ETC/deploy.env"; echo "deploy.env 있음"
fi
[[ -e "$ETC/deploy.lock" ]] || : > "$ETC/deploy.lock"
chown root:b102 "$ETC/deploy.lock"; chmod 0660 "$ETC/deploy.lock"

echo "== 3/5 상태 디렉터리 =="
install -d -o root -g b102 -m 2770 "$STATE"
# 기존 배포가 있으면 현재 릴리스를 기록해 둔다 (deploy.sh 가 롤백 기준으로 쓴다)
if [[ ! -f "$STATE/current-release" ]] && docker ps --format '{{.Image}}' | grep -qE '^b102-backend:'; then
  cur="$(docker ps --format '{{.Image}}' | grep -E '^b102-backend:' | head -1 | cut -d: -f2)"
  fp="$(cd "$REPO/backend/src/main/resources/db/migration" 2>/dev/null && find . -type f -name '*.sql' -print0 | sort -z | xargs -0 -r sha256sum | sha256sum | cut -c1-16 || echo none)"
  echo "$cur $fp $(date -Is) setup-cd" > "$STATE/current-release"; chown root:b102 "$STATE/current-release"; chmod 0660 "$STATE/current-release"
  echo "current-release 초기화: $cur $fp"
fi

echo "== 4/5 GitLab HTTPS pull 인증 (서버 작업 트리용) =="
if [[ -s "$JENKINS_TOKEN" ]]; then
  # git credential-store 는 파일 옆에 .lock 을 만들므로 그룹이 쓸 수 있는 하위 디렉터리에 둔다
  install -d -o root -g b102 -m 2770 "$ETC/git"
  rm -f "$ETC/git-credentials"
  ( umask 027; printf 'https://%s:%s@%s\n' "$GIT_USER" "$(tr -d '\n' < "$JENKINS_TOKEN")" "$GIT_HOST" > "$ETC/git/credentials" )
  chown root:b102 "$ETC/git/credentials"; chmod 0640 "$ETC/git/credentials"
  if [[ -d "$REPO/.git" ]]; then
    sudo -u ubuntu git -C "$REPO" remote set-url origin "https://$GIT_HOST/$GIT_PATH"
    sudo -u ubuntu git -C "$REPO" config credential.helper "store --file=$ETC/git/credentials"
    if sudo -u ubuntu env GIT_TERMINAL_PROMPT=0 git -C "$REPO" ls-remote --heads origin dev >/dev/null 2>&1; then
      echo "git ls-remote OK — deploy.sh 가 --no-pull 없이 동작한다"
    else
      echo "git ls-remote 실패. 토큰 만료·권한 확인" >&2
    fi
  fi
else
  echo "Jenkins checkout 토큰이 없어 git credentials 를 만들지 않음 ($JENKINS_TOKEN)"
fi

echo "== 5/5 Jenkins 재시작 (그룹 반영, 처음 한 번만) =="
if $jenkins_needs_restart && systemctl is-active --quiet jenkins; then
  systemctl restart jenkins
  for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:8080/login && break; sleep 2; done
  echo "jenkins $(systemctl is-active jenkins); groups: $(id -nG jenkins)"
else
  echo "재시작 불필요 (jenkins groups: $(id -nG jenkins 2>/dev/null))"
fi

echo
ls -la "$ETC" "$ETC/git" "$STATE"
echo "CD gate 는 꺼져 있다. 자동 배포를 켤 때:  sudo touch $ETC/cd-enabled   /  끌 때:  sudo rm $ETC/cd-enabled"
echo "B102_SETUP_CD_COMPLETE"
