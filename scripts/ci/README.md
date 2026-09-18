# scripts/ci — Jenkins 가 실행하는 CI 스크립트

루트 `Jenkinsfile` 이 호출한다. 호스트에는 Node·Java·Python 을 설치하지 않고 전부 고정 버전 docker 이미지 안에서 돈다.
로컬에서도 같은 명령으로 실행할 수 있다(docker 필요).

| 파일 | 역할 | 이미지 |
| --- | --- | --- |
| `changed_components.py` | 변경 경로 → 컴포넌트(frontend·backend·AI·data·deploy) 선택. 모르는 경로·base 없음 → 전부. dev 머지 커밋은 MR 빌드 검증 재사용 판단 | 호스트 python3 |
| `tests/test_changed_components.py` | 위 분류 규칙 테스트. 매 빌드 먼저 실행 | 호스트 python3 |
| `run-frontend-ci.sh` | `npm ci` → `npm run lint` → `npm run build` | `node:24-bookworm-slim` |
| `run-backend-ci.sh` | CI 전용 PG+ES(nori) 를 임시 compose 프로젝트 `b102-ci` 로 띄우고 `./gradlew test`. 끝나면 `down -v` | `eclipse-temurin:21-jdk-noble` |
| `run-ai-ci.sh` | Python 패키지를 설치하고 `ai/tests` 전체 pytest 실행, JUnit 결과 보관 | `python:3.12-slim` |
| `compose.backend-ci.yml` | 위 CI 인프라 override: 이름 `b102-ci-*`, 포트 없음, ES 힙 512m, fsync off | |
| `run-data-ci.sh` | `database/*/tests` 의 표준 라이브러리 unittest (`ai/` 제외) | `python:3.12-slim` |
| `run-deploy-ci.sh` | `bash -n` + ShellCheck(warning), compose 3종 렌더링, python 컴파일 | `koalaman/shellcheck-alpine:v0.10.0` |
| `lib.sh` | 공통: 경로·uid·캐시 루트·docker 확인·**메모리 가드** | |

## 메모리 가드

운영 컨테이너와 같은 서버다. `lib.sh` 의 `ci_check_memory` 가 시작 전에 `MemAvailable` 을 보고(frontend 2.5g, AI 1.5g, backend 3.5g 필요) 부족하면 중단한다.
운영 Qdrant(`b102-qdrant`) 가 켜져 있으면 그 컨테이너의 `mem_limit`(3g) 를 필요량에 더해서 본다 — 비어 있는 Qdrant 때문에 멈추지 않되, Qdrant 가 상한까지 자라도 운영이 버틸 때만 빌드한다(`B102_ALLOW_BUILD_WITH_QDRANT=true` 면 더하지 않음). 빌드 컨테이너에는 `--memory` 상한이 걸려 있다.
Jenkinsfile 은 frontend·AI·data·deploy 를 병렬로 돌리고 backend 는 그 뒤 단독으로 돈다.

## 변경 범위 규칙 (요약)

- `frontend/**` → frontend, `backend/**` → backend, `ai/**` 소스 → AI + deploy, `database/**/scripts|tests` → data, `deploy/**`·`Jenkinsfile`·`scripts/ci/**` → deploy
- `backend/Dockerfile`, `backend/docker/**`, `backend/docker-compose.yml` → backend + deploy
- `scripts/ci/run-X-ci.sh` → X + deploy. `scripts/ci/lib.sh`, `.gitattributes` → 전부
- 문서(`*.md`, `docs/`, reports·samples·metadata), `ai/**/*.md`, `.gitlab/` → 선택 없음(빌드 설명이 `docs-only`)
- MR 은 target(dev) 과의 merge-base 기준, dev 는 직전 성공 커밋 → 직전 커밋 → 머지 커밋 첫 부모. 기준을 못 찾으면 전부

## MR 검증 재사용 (dev, 09-16)

Jenkins 는 MR 을 **타깃과 머지한 상태**로 빌드한다(`OriginMergeRequestDiscoveryTrait(1)`). 그래서 MR 빌드가 검증한 트리는
「그때의 dev + MR head」이고, GitLab 이 만든 dev 머지 커밋의 두 부모가 바로 그 쌍이다. `changed_components.py --jenkins` 는 dev 에서
`$JENKINS_HOME/jobs/b102/branches/MR-*/builds/*/build.xml` 의 `SCMRevisionAction` 해시 쌍이 머지 커밋의 부모 쌍과 같고 `result=SUCCESS` 이며
`archive/ci-plan.json` 이 이번에 필요한 컴포넌트를 전부 돌렸던 빌드를 찾으면 `reuse_merge_request_validation: true` 를 낸다.
Jenkinsfile 은 그때 컴포넌트 CI 를 건너뛰고 이미지 빌드·배포만 한다(설명 `mr-verified MR-176 #1`). 머지 커밋 메시지의 `See merge request …!176` 으로 폴더를 먼저 찾는다.
- MR 빌드 뒤에 dev 가 움직였으면(첫 부모가 다름) 재사용하지 않고 전부 다시 돈다 — 검증한 트리와 배포할 트리가 다르기 때문
- `FORCE_ALL` 이면 재사용 안 함. 끄려면 Jenkins 전역 env `B102_REUSE_MR_VALIDATION=false`

## 로컬에서 돌려보기

```bash
bash scripts/ci/run-deploy-ci.sh
bash scripts/ci/run-data-ci.sh
bash scripts/ci/run-frontend-ci.sh
bash scripts/ci/run-backend-ci.sh          # PG+ES 임시 기동, 3~5분
bash scripts/ci/run-ai-ci.sh               # AI 단위 테스트
python3 scripts/ci/changed_components.py --base origin/dev --head HEAD
```

캐시는 `B102_CI_CACHE_ROOT`(Jenkins: `/var/lib/jenkins/.cache/b102`, 로컬: `.cache/`) 아래 npm·gradle·pip.
