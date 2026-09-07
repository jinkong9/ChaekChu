#!/usr/bin/env bash
# Jenkins 플러그인을 버전 고정으로 설치한다 (plugin-installation-manager). 재실행 안전.
#   sudo bash deploy/jenkins/install-plugins.sh
set -euo pipefail
[[ "$(id -u)" -eq 0 ]] || { echo "sudo 로 실행하세요" >&2; exit 1; }

PIM_VERSION="${PIM_VERSION:-2.15.0}"
PIM_URL="https://github.com/jenkinsci/plugin-installation-manager-tool/releases/download/${PIM_VERSION}/jenkins-plugin-manager-${PIM_VERSION}.jar"
PIM_JAR="/tmp/jenkins-plugin-manager-${PIM_VERSION}.jar"

# 2026-09-07 기준. 코어 2.568.3 과 호환. 올릴 때는 plugins.jenkins.io 에서 requiredCore 확인.
PLUGINS=(
  "git:5.10.1"
  "gitlab-branch-source:743.ve0c8154a_8da_b_"
  "junit:1425.v9c7318dca_96d"
  "workflow-aggregator:608.v67378e9d3db_1"
)

jenkins_war="$(dpkg -L jenkins | awk '/jenkins\.war$/ {print; exit}')"
[[ -f "$jenkins_war" ]] || { echo "jenkins.war 를 찾을 수 없습니다" >&2; exit 1; }

stopped=false
cleanup() { rm -f "$PIM_JAR"; $stopped && systemctl start jenkins.service || true; }
trap cleanup EXIT

curl -fsSL "$PIM_URL" -o "$PIM_JAR"
printf '%s  %s\n' "$(curl -fsSL "${PIM_URL}.sha256")" "$PIM_JAR" | sha256sum --check --strict --quiet

systemctl stop jenkins.service; stopped=true
install -d -o jenkins -g jenkins /var/lib/jenkins/plugins
sudo -H -u jenkins java -jar "$PIM_JAR" \
  --war "$jenkins_war" \
  --plugin-download-directory /var/lib/jenkins/plugins \
  --plugins "${PLUGINS[@]}"
chown -R jenkins:jenkins /var/lib/jenkins/plugins
systemctl start jenkins.service; stopped=false
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:8080/login && break; sleep 2; done

for p in "${PLUGINS[@]}"; do
  name="${p%%:*}"
  [[ -f "/var/lib/jenkins/plugins/${name}.jpi" ]] || { echo "플러그인 미설치: $name" >&2; exit 1; }
done
echo "B102_JENKINS_PLUGINS_COMPLETE"
