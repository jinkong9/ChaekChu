#!/usr/bin/env bash
# Jenkins 를 EC2 호스트에 apt 로 설치한다 (systemd). 최초 1회, 재실행 안전.
#   sudo bash deploy/jenkins/provision-jenkins.sh
# 전제: deploy/scripts/setup-ec2.sh 로 Docker 가 이미 설치되어 있다.
# 하는 일: Jenkins LTS 고정 설치, OpenJDK 21, jenkins 유저를 docker 그룹에, 0.0.0.0:8080 바인딩,
#          힙 768m + systemd MemoryMax 1.5G, ufw 는 docker 대역(172.16.0.0/12)만 8080 허용,
#          비밀 디렉터리와 관리자 초기 비밀번호·웹훅 시크릿 생성 (jenkins:jenkins 600).
set -euo pipefail

JENKINS_VERSION="${JENKINS_VERSION:-2.568.3}"        # LTS. 2.555+ 는 Java 21/25 필요
SECRETS_DIR=/var/lib/jenkins/secrets/b102
CACHE_DIR=/var/lib/jenkins/.cache/b102

if [[ "$(id -u)" -ne 0 ]]; then echo "sudo 로 실행하세요" >&2; exit 1; fi
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || { echo "지원 OS 아님: ${PRETTY_NAME:-unknown}" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker 가 없습니다. deploy/scripts/setup-ec2.sh 먼저." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== 1/6 apt 저장소 =="
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/jenkins-keyring.asc ]]; then
  curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key -o /etc/apt/keyrings/jenkins-keyring.asc
fi
echo 'deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/' \
  > /etc/apt/sources.list.d/jenkins.list
apt-get update -qq

echo "== 2/6 Java 21 + Jenkins ${JENKINS_VERSION} (버전 고정) =="
apt-get install -y -qq --no-install-recommends openjdk-21-jre-headless fontconfig curl
# pkg.jenkins.io 는 다운로드를 지역 미러로 리다이렉트하는데 미러가 죽어 있는 경우가 있다(2026-09-07 mirror.ossplanet.net).
# apt 가 실패하면 원본(archives.jenkins.io)에서 .deb 을 직접 받아 apt 인덱스(서명됨)의 SHA256 과 대조한 뒤 설치한다.
install_jenkins_deb() {
  local deb="/tmp/jenkins_${JENKINS_VERSION}_all.deb" expected actual
  expected="$(apt-cache show "jenkins=$JENKINS_VERSION" | awk '/^SHA256:/ {print $2; exit}')"
  [[ -n "$expected" ]] || { echo "apt 인덱스에서 jenkins=$JENKINS_VERSION 을 찾을 수 없습니다" >&2; return 1; }
  curl -fL --retry 3 --max-time 600 -o "$deb" "https://archives.jenkins.io/debian-stable/jenkins_${JENKINS_VERSION}_all.deb"
  actual="$(sha256sum "$deb" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { echo "SHA256 불일치: $actual != $expected" >&2; rm -f "$deb"; return 1; }
  apt-get install -y -qq --allow-downgrades "$deb"
  rm -f "$deb"
}
apt-mark unhold jenkins >/dev/null 2>&1 || true
installed="$(dpkg-query -W -f='${Version}' jenkins 2>/dev/null || true)"
if [[ "$installed" != "$JENKINS_VERSION" ]]; then
  [[ -z "$installed" ]] || echo "Jenkins $installed 설치됨 → $JENKINS_VERSION 으로 변경"
  apt-get install -y -qq --allow-downgrades "jenkins=$JENKINS_VERSION"     || { echo "apt 미러 실패 → archives.jenkins.io 에서 직접 설치"; install_jenkins_deb; }
fi
apt-mark hold jenkins >/dev/null

echo "== 3/6 서비스 설정 =="
usermod -aG docker jenkins
install -d /etc/systemd/system/jenkins.service.d
cat > /etc/systemd/system/jenkins.service.d/override.conf <<'EOF'
[Service]
# nginx 가 컨테이너라 127.0.0.1 로는 못 닿는다. 0.0.0.0 에 열고 외부 차단은 ufw + AWS 보안 그룹(8080 미개방)에 맡긴다.
Environment="JENKINS_OPTS=--httpListenAddress=0.0.0.0"
Environment="JAVA_OPTS=-Djava.awt.headless=true -Xms256m -Xmx768m -XX:+UseG1GC -Duser.timezone=Asia/Seoul"
# 16GiB 서버를 compose(8.6g)·수집기(3g) 와 나눠 쓴다. 빌드 컨테이너는 이 상한 밖(docker) 에서 돈다.
MemoryMax=1536M
MemoryHigh=1280M
Restart=on-failure
RestartSec=10
EOF
install -d -o jenkins -g jenkins -m 0700 "$SECRETS_DIR"
install -d -o jenkins -g jenkins -m 0750 "$CACHE_DIR"
umask 077
[[ -f "$SECRETS_DIR/admin-password" ]] || openssl rand -base64 24 | tr -d '/+=' | cut -c1-24 > "$SECRETS_DIR/admin-password"
[[ -f "$SECRETS_DIR/webhook-secret" ]]  || openssl rand -hex 32 > "$SECRETS_DIR/webhook-secret"
umask 022
chown jenkins:jenkins "$SECRETS_DIR"/*; chmod 0600 "$SECRETS_DIR"/*

echo "== 4/6 ufw: docker 대역만 8080 =="
if command -v ufw >/dev/null; then
  ufw allow from 172.16.0.0/12 to any port 8080 proto tcp comment 'jenkins webhook from docker' >/dev/null
  ufw status | grep -E "8080" || true
fi

echo "== 5/6 기동 =="
systemctl daemon-reload
systemctl enable jenkins.service >/dev/null
systemctl restart jenkins.service
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:8080/login && break; sleep 2; done
systemctl is-active --quiet jenkins.service || { journalctl -u jenkins -n 30 --no-pager; exit 1; }

echo "== 6/6 확인 =="
sudo -u jenkins docker info >/dev/null && echo "jenkins 유저 docker 접근 OK"
ss -ltnH 'sport = :8080' | awk '{print "listen", $4}'
systemctl show jenkins -p MemoryMax -p MemoryCurrent | tr '\n' ' '; echo
dpkg-query -W -f='jenkins ${Version} (hold)\n' jenkins
echo "관리자 비밀번호: sudo cat $SECRETS_DIR/admin-password   (admin 계정. configure 후 유효)"
echo "B102_JENKINS_PROVISION_COMPLETE"
