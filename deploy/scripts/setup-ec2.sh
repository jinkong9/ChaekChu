#!/usr/bin/env bash
# EC2 최초 1회. Ubuntu 24.04 기준. sudo 로 실행한다.
#   sudo bash deploy/scripts/setup-ec2.sh
# 하는 일: Docker 공식 apt 저장소 설치, 데몬 로그 상한, 스왑 2G, ufw 80/443, ubuntu 를 docker 그룹에.
# 이미 되어 있는 항목은 건너뛴다(재실행 안전).
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then echo "sudo 로 실행하세요" >&2; exit 1; fi
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "지원 OS 아님: ${PRETTY_NAME:-unknown}" >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
TARGET_USER="${SUDO_USER:-ubuntu}"

echo "== 1/5 Docker =="
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf '%s\n' 'Types: deb' 'URIs: https://download.docker.com/linux/ubuntu' \
    "Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}" 'Components: stable' \
    "Architectures: $(dpkg --print-architecture)" 'Signed-By: /etc/apt/keyrings/docker.asc' \
    > /etc/apt/sources.list.d/docker.sources
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "docker 있음: $(docker --version)"
fi

echo "== 2/5 데몬 설정 (로그 상한·live-restore) =="
install -d /etc/docker
python3 - <<'PY'
import json, pathlib
p = pathlib.Path("/etc/docker/daemon.json")
cfg = json.loads(p.read_text()) if p.exists() else {}
cfg.setdefault("log-driver", "json-file")
cfg.setdefault("log-opts", {}).update({"max-size": "10m", "max-file": "3"})
cfg["live-restore"] = True          # dockerd 재시작 시 컨테이너 유지
p.write_text(json.dumps(cfg, indent=2) + "\n")
print(json.dumps(cfg, indent=2))
PY
systemctl enable --now docker containerd
systemctl reload docker || systemctl restart docker
usermod -aG docker "$TARGET_USER"

echo "== 3/5 스왑 2G =="
if ! swapon --show | grep -q '^/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.d/99-b102.conf 2>/dev/null || echo 'vm.swappiness=10' >> /etc/sysctl.d/99-b102.conf
else
  echo "스왑 있음"
fi
# Elasticsearch 요구값
sysctl -w vm.max_map_count=262144 >/dev/null
grep -q '^vm.max_map_count' /etc/sysctl.d/99-b102.conf 2>/dev/null || echo 'vm.max_map_count=262144' >> /etc/sysctl.d/99-b102.conf

echo "== 4/5 ufw 80/443 =="
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw status | grep -E '^(80|443)/tcp' || true
fi
echo "AWS 보안 그룹에서도 80/443 인바운드를 열어야 한다 (콘솔에서 수동)."

echo "== 5/5 확인 =="
docker --version; docker compose version
free -h | sed -n '1,3p'
echo "B102_SETUP_COMPLETE — $TARGET_USER 는 재로그인 후 sudo 없이 docker 사용 가능"
