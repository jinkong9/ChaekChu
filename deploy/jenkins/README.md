# Jenkins — EC2 호스트 systemd, GitLab 웹훅 트리거

GitLab Runner 를 못 쓰는 SSAFY GitLab 환경에서 Jenkins 가 MR·`dev` 를 검증·배포한다.
2단계(이 디렉터리)는 **웹훅이 Jenkins 에 닿고 멀티브랜치 잡이 깨어나는 것**까지다. Jenkinsfile 내용은 3단계.

```
GitLab MR / dev push
 → https://j15b102.p.ssafy.io/gitlab-webhook/post   (web 컨테이너 nginx, POST 만)
 → host.docker.internal:8080                        (호스트 Jenkins, 0.0.0.0 바인딩)
 → 멀티브랜치 잡 b102 (dev, MR-*)                    → GitLab 커밋 상태 기록
```

## 전제 (읽고 동의한 뒤 진행)

- **jenkins 유저는 docker 그룹이다. docker 그룹은 사실상 root 권한이다.** MR 에 Jenkinsfile 을 올릴 수 있는 사람은 서버에서 무엇이든 실행할 수 있다. 저장소가 비공개고, fork MR 은 발견하지 않고(origin 만), 팀원 전원이 이미 pem 으로 서버에 들어올 수 있으므로 **팀원을 서버 관리자급으로 신뢰한다**는 전제로 진행한다. 이 전제가 깨지면(외부 기여자 등) 빌드 에이전트를 분리해야 한다.
- Jenkins UI 는 외부에 열지 않는다. `ssh -N -L 8080:127.0.0.1:8080 b102` 후 `http://localhost:8080`. 계정 `admin`, 비번은 `sudo cat /var/lib/jenkins/secrets/b102/admin-password`.
- 웹훅은 GitLab UI 에서 **수동 등록**한다. Jenkins 는 훅을 만들지 않는다(`manageWebHooks=false`). 자동으로 켜면 훅이 중복 생긴다.
- Jenkins 기본 URL 은 `http://localhost:8080/`(터널 기준), 웹훅 수신 주소(`hooksRootUrl`)만 공개 도메인이다. 그래서 GitLab 파이프라인 상태의 "빌드 보기" 링크는 터널을 연 사람만 열 수 있다.
- executor 1개. 운영 컨테이너와 CPU·메모리·docker 소켓을 공유하므로 동시 빌드 없음.

## 버전 (2026-09-07 고정)

| | 버전 | 비고 |
| --- | --- | --- |
| Jenkins LTS | 2.568.3 | apt hold. 2.555+ 는 Java 21/25 필요 |
| Java | OpenJDK 21 JRE headless | |
| git | 5.10.1 | |
| gitlab-branch-source | 743.ve0c8154a_8da_b_ | requiredCore 2.504.3 |
| junit | 1425.v9c7318dca_96d | requiredCore 2.541.3 |
| workflow-aggregator | 608.v67378e9d3db_1 | |
| plugin-installation-manager | 2.15.0 | 설치 도구 |

올릴 때는 `install-plugins.sh` 의 배열과 `provision-jenkins.sh` 의 `JENKINS_VERSION` 만 바꾼다.

## 메모리

| | 상한 |
| --- | --- |
| compose 기본 | 8.6g |
| Jenkins (힙 768m, `MemoryMax`) | 1.5g |
| 수집기 systemd | 3g |
| 합계 | 13.1g / 16g |

이건 **평상시 상한 합**이다. CI 가 띄우는 빌드 컨테이너(gradle·npm·BuildKit)는 Jenkins `MemoryMax` 밖에서 돈다. 3단계에서 빌드 컨테이너에 `--memory` 를 걸고, Qdrant 를 켠 상태에서는 빌드하지 않는 규칙을 둔다.

## 설치 순서

```bash
# 0. 저장소 최신을 서버에 (GitLab 토큰 전까지는 bundle)
#    로컬: git bundle create b102.bundle dev feature/jenkins-base && scp b102.bundle b102:~/
#    서버: cd ~/S15P21B102 && git fetch ~/b102.bundle feature/jenkins-base && git reset --hard FETCH_HEAD

# 1. Jenkins 설치 (Docker 는 setup-ec2.sh 로 이미 있어야 함)
ssh b102 'sudo bash ~/S15P21B102/deploy/jenkins/provision-jenkins.sh'
ssh b102 'sudo bash ~/S15P21B102/deploy/jenkins/install-plugins.sh'

# 2. GitLab 에서 Project Access Token 2개 생성 (Settings > Access Tokens). 생성 즉시 서버에 넣는다. 채팅·메모에 남기지 않는다.
#    b102-jenkins-checkout : role Reporter,  scope read_repository
#    b102-jenkins-status   : role Developer, scope api                (커밋 상태 기록)
ssh -t b102 'read -rsp "checkout token: " t; echo; printf %s "$t" | sudo install -o jenkins -g jenkins -m 600 /dev/stdin /var/lib/jenkins/secrets/b102/gitlab-checkout-token'
ssh -t b102 'read -rsp "status token: " t;   echo; printf %s "$t" | sudo install -o jenkins -g jenkins -m 600 /dev/stdin /var/lib/jenkins/secrets/b102/gitlab-status-token'

# 3. 설정 적용 (토큰 검증 → 프로젝트 ID 조회 → init.groovy 설치 → 재시작 → 잡 확인)
ssh b102 'sudo bash ~/S15P21B102/deploy/jenkins/apply-config.sh'

# 4. nginx 웹훅 프록시 반영 (web 재배포)
ssh b102 'bash ~/S15P21B102/deploy/scripts/deploy.sh --no-pull'

# 5. GitLab 웹훅 등록 (Settings > Webhooks)
#    URL           https://j15b102.p.ssafy.io/gitlab-webhook/post
#    Secret token  ssh b102 'sudo cat /var/lib/jenkins/secrets/b102/webhook-secret'
#    Trigger       Merge request events / Push events (Wildcard pattern: dev)
#    SSL verify    켬
#    → 저장 후 Test > Push events. 서버에서 확인:
ssh b102 'sudo journalctl -u jenkins -n 50 --no-pager | grep -i gitlab'
ssh b102 'docker logs b102-web 2>&1 | grep gitlab-webhook | tail -3'   # 200 이어야. 403 이면 secret 불일치
```

## 파일

| 파일 | 역할 |
| --- | --- |
| `provision-jenkins.sh` | apt 저장소, Java 21, Jenkins 2.568.3 hold, docker 그룹, systemd override(0.0.0.0, 힙, MemoryMax), ufw 8080 docker 대역, 비밀 디렉터리·초기값 생성 |
| `install-plugins.sh` | 플러그인 4개 버전 고정 설치 |
| `configure-jenkins.groovy` | `init.groovy.d`. 기동마다 실행되는 멱등 설정: 로컬 계정 realm(admin), 크리덴셜 3개, GitLab 서버, 멀티브랜치 잡 `b102`(dev, MR-*), executor 1, 기본 URL |
| `apply-config.sh` | 토큰 검증, 프로젝트 ID 조회, groovy 설치·재시작·검증 |

비밀 파일은 전부 `/var/lib/jenkins/secrets/b102/` 에 `jenkins:jenkins 600`. groovy 가 jenkins 유저로 읽어야 하므로 root 전용으로 두면 안 된다.

## 4단계 전에 정한 것 (구현은 4단계)

- 배포 주체는 **jenkins 유저**. Jenkins workspace 의 검증된 SHA 로 이미지를 빌드하고 `deploy.sh --no-pull` 을 호출한다. 서버 작업 트리의 `git fetch` 와 별도 Git 인증은 필요 없다.
- 운영 비밀값은 `~/S15P21B102/deploy/.env` 에서 `/etc/b102/deploy.env` 로 옮긴다. `root:b102 640`, 그룹 `b102` 에 `jenkins`·`ubuntu`. `deploy.sh` 는 `ENV_FILE` 로 위치를 받는다.
- `ubuntu` 의 `~/S15P21B102` 는 Jenkins 장애 시 수동 fallback 으로만 남긴다.

## 문제 해결

| 증상 | 확인 |
| --- | --- |
| 웹훅 Test 가 502 | `docker exec b102-web getent hosts host.docker.internal` 로 게이트웨이 해석 확인, `sudo ss -ltnp \| grep 8080` 으로 0.0.0.0 바인딩 확인, `sudo ufw status \| grep 8080` |
| 웹훅 Test 가 403 | Secret token 불일치. `webhook-secret` 파일과 GitLab 입력값 비교 |
| Jenkins 가 안 뜸 | `sudo journalctl -u jenkins -n 100`. groovy 예외면 `/var/lib/jenkins/init.groovy.d/` 파일을 잠시 옮기고 재시작 |
| 메모리 | `systemctl show jenkins -p MemoryCurrent`, `docker stats --no-stream` |
