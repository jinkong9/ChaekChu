# AI 모델·태그·임베딩 Index 운영 Runbook

> 대상: AI 담당자·배포 담당자
> 기준: `dev` 기준 FastAPI 추천 서버, D4L ISBN 중복 제거 원본, Qdrant versioned index
> 원칙: 원본 데이터·API key·대용량 벡터는 Git에 저장하지 않는다.

## 1. 운영 구성과 버전 관계

AI 추천은 요청 중에 임베딩이나 GMS LLM을 호출하지 않는다. 수집된 D4L snapshot을
고정한 뒤 태그와 임베딩을 오프라인으로 생성하고, 성공한 index만 active alias로
전환한다.

```text
D4L snapshot
  ├─ validate → validation report
  ├─ tags    → tag sidecar(JSONL, tagVersion)
  └─ index   → Qdrant staging collection(indexVersion)
                    └─ 성공 시 books_active alias promote
                         └─ AI_INDEX_VERSION을 같은 값으로 반영
  └─ tag-index → Qdrant tag prototype staging collection
                    └─ 성공 시 tags_active alias promote
```

| 버전 | 의미 | 저장 위치 | 변경 시점 |
| --- | --- | --- | --- |
| `inputHash` | 정규화한 D4L snapshot 지문 | 배치 report·sidecar | 원본 snapshot 변경 시 |
| `embeddingVersion` | GMS embedding model·차원 조합 | Qdrant payload·report | 모델/차원 변경 시 |
| `tagVersion` | taxonomy·태그 생성 규칙/모델 버전 | sidecar·Qdrant payload | 태그 규칙/GMS model 변경 시 |
| `indexVersion` | 하나의 완결된 Qdrant index 버전 | collection·AI 환경변수 | 재색인 완료 시 |
| `AI_MODEL_VERSION` | FastAPI 응답에 표시하는 모델 버전 | `deploy/.env` | model/index release 시 |

`indexVersion`은 재사용하지 않는다. 예시는 다음처럼 실행 단위마다 고유하게 만든다.

```bash
RUN_ID=20260909-01
INDEX_VERSION=d4l-${RUN_ID}
TAG_VERSION=d4l-tags-${RUN_ID}
MODEL_VERSION=gms-embedding-${RUN_ID}
```

## 2. 실행 전 준비

EC2에서 실행하며, 명령은 저장소의 `ai` 디렉터리를 기준으로 한다.

```bash
cd ~/S15P21B102/ai
SOURCE=/home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz
RUN_DIR=/home/ubuntu/pipeline_data/data4library/recommendation-runs/${RUN_ID}
mkdir -p "$RUN_DIR"
```

실제 비밀값은 명령어·로그·Git에 직접 쓰지 않고 서버 secret/env에서 주입한다.
호스트에서 배치할 때 Qdrant는 loopback 주소를 사용한다. AI 컨테이너 런타임은
`deploy/.env`의 컨테이너 주소 `http://qdrant:6333`을 사용한다.

```bash
export QDRANT_URL=http://127.0.0.1:6333
export QDRANT_COLLECTION_PREFIX=books
export QDRANT_COLLECTION=books_active
export QDRANT_TIMEOUT_SECONDS=10
export EMBEDDING_API_URL=<GMS OpenAI-compatible embeddings endpoint>
export EMBEDDING_API_KEY=<secret manager에서 주입>
export EMBEDDING_MODEL=text-embedding-3-small
export EMBEDDING_DIMENSION=1536
```

Qdrant와 서버 상태를 먼저 확인한다.

```bash
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml --profile recsys up -d qdrant
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml ps qdrant
curl -fsS http://127.0.0.1:6333/healthz
df -h
free -h
```

16GiB EC2에서는 임베딩 대량 생성 중 수집기·Jenkins·Elasticsearch 메모리 사용량을
함께 확인한다. Qdrant가 기동하지 않거나 디스크 여유가 부족하면 배치를 시작하지
않는다.

## 3. 표준 갱신 절차

### 3.1 원본 검증과 증거 저장

같은 `SOURCE`에 대해 validation report를 먼저 만든다. report의 `inputHash`를 이후
태그·index report와 대조할 수 있도록 보존한다.

```bash
uv run b102-recommendation --config config/local.toml validate \
  --input "$SOURCE" \
  --output "$RUN_DIR/validation.json"
```

`status=PASS`, `blockingErrors=0`이 아니면 다음 단계로 진행하지 않는다.

### 3.2 태그 batch 생성

GMS를 사용하려면 `TAG_API_URL`, `TAG_API_KEY`, `TAG_MODEL`을 주입한다. endpoint/key가
둘 다 없으면 rule-only 태그가 생성되므로 report의 `gmsAttempts`와 `gmsFailures`를
확인한다.

```bash
export TAG_API_URL=<GMS OpenAI-compatible chat endpoint>
export TAG_API_KEY=<secret manager에서 주입>
export TAG_MODEL=gpt-4o-mini

uv run b102-recommendation --config config/local.toml tags \
  --input "$SOURCE" \
  --sidecar "$RUN_DIR/tags.jsonl" \
  --tag-version "$TAG_VERSION" \
  --max-retries 2 \
  --output "$RUN_DIR/tags-report.json"
```

확인 항목:

- sidecar의 모든 ISBN이 원본 ISBN과 일치하는지
- `inputHash`와 `tagVersion`이 이번 실행값인지
- `missingRows`, `gmsFailures`, `lowConfidenceRows`가 허용 기준 이내인지
- taxonomy 밖의 tag code가 없는지

이 단계의 산출물은 tag sidecar다. tag prototype collection은 별도 기능이므로 이
단계에서 자동 생성하지 않는다. 대신 다음 index 단계에서 sidecar를 전달하면
`inputHash`·`tagVersion`·taxonomy·ISBN을 검증한 뒤 일치하는 도서 payload에
`tagCodes`, `tagScores`, `tagConfidence`를 복사한다. sidecar가 없거나 태그가 없는
ISBN은 결측으로 남기고 임의의 태그를 만들지 않는다.

### 3.3 임베딩 index 생성 및 promote

임베딩 모델·차원·feature/tag version을 고정하고 새 `indexVersion`으로 실행한다.
배치는 versioned staging collection에만 적재하며, 모든 입력이 성공했을 때만
`books_active` alias를 새 collection으로 교체한다.

```bash
export AI_FEATURE_VERSION=d4l-feature-v1
export AI_TAG_VERSION="$TAG_VERSION"

uv run b102-recommendation --config config/local.toml index \
  --input "$SOURCE" \
  --index-version "$INDEX_VERSION" \
  --tag-sidecar "$RUN_DIR/tags.jsonl" \
  --batch-size 32 \
  --max-retries 2 \
  --output "$RUN_DIR/index-report.json"
```

다음 조건을 모두 만족해야 runtime 반영 단계로 넘어간다.

```bash
jq -e '.status == "PROMOTED" and .promoted == true and .failedRows == 0' \
  "$RUN_DIR/index-report.json"
jq -e '.stagedRows == .rows and .indexVersion == "'"$INDEX_VERSION"'"' \
  "$RUN_DIR/index-report.json"
```

`PARTIAL_FAILURE`이면 새 index를 active로 사용하지 않는다. 실패 ISBN과 retry 횟수를
확인해 같은 `indexVersion`으로 재실행하거나, 원인을 해결한 뒤 새 version으로 다시
시작한다. active alias를 수동으로 덮어쓰지 않는다.

index report의 `tagSidecarRows`, `taggedRows`, `missingTagRows`,
`outOfInputTagRows`를 확인한다. `outOfInputTagRows`는 색인 대상에 없는 sidecar ISBN이며
무시되지만, 수가 예상과 다르면 같은 원본 snapshot으로 tags 단계를 다시 실행한다.
`QDRANT_TAG_COLLECTION`을 사용하는 query vector용 prototype 적재는 별도의 후속 작업이다.

### 3.4 태그 prototype index 생성 및 promote

taxonomy의 code·label prototype은 도서 snapshot과 별도로 임베딩하지만, 동일한
`indexVersion`을 point ID와 metadata에 사용한다. 성공한 staging collection만
`tags_active` alias로 promote한다.

```bash
uv run b102-recommendation --config config/local.toml tag-index \
  --input "$SOURCE" \
  --index-version "$INDEX_VERSION" \
  --tag-version "$TAG_VERSION" \
  --batch-size 32 \
  --max-retries 2 \
  --output "$RUN_DIR/tag-index-report.json"
```

report의 `status=\"PROMOTED\"`, `failedRows=0`, `stagedRows=rows`를 확인한 뒤에만
AI runtime의 `QDRANT_TAG_COLLECTION=tags_active`를 반영한다. point key는
`tag:{code}`이며 query vector reader와 같은 versioned UUID 규칙을 사용한다.
일부 prototype 생성이 실패하면 기존 `tags_active` alias를 유지한다.

### 3.5 온라인 tag 연동 확인

runtime의 `QDRANT_TAG_COLLECTION`은 prototype을 적재한 alias와 동일하게 설정하고,
`AI_INDEX_VERSION`은 books/tag prototype 배치에 사용한 값으로 맞춘다. 온라인 reader는
`tag:{code}` point를 조회해 tag-only query vector를 만들며, 추천 후보의 `tagCodes`는
임베딩 index payload에서 읽는다.

```bash
export AI_INDEX_VERSION="$INDEX_VERSION"
export AI_MODEL_VERSION="$MODEL_VERSION"
export AI_TAG_VERSION="$TAG_VERSION"
export QDRANT_TAG_COLLECTION=tags_active

COMPOSE="docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml"
$COMPOSE --profile recsys up -d --build --force-recreate qdrant ai
$COMPOSE exec -T ai python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5).read().decode())'
$COMPOSE exec -T ai python -c 'import json,urllib.request; p={"requestId":"smoke-tag-1","userId":"smoke-user","mode":"PERSONALIZED","size":5,"tags":[{"code":"FANTASY","weight":1}],"weights":{"semantic":0,"tagMatch":1,"coLoan":0,"trending":0,"steady":0}}; r=urllib.request.Request("http://127.0.0.1:8000/internal/v1/recommendations",data=json.dumps(p).encode(),headers={"Content-Type":"application/json"}); print(urllib.request.urlopen(r,timeout=10).read().decode())'
```

운영 Compose에서 AI 8000 포트는 Docker 내부에만 노출되므로 호스트의
`127.0.0.1:8000`으로 직접 호출하지 않는다. 응답의 `fallback`, `indexVersion`,
`items[].matchedTags`, `items[].primaryReason`을 확인한다. 태그가 있는 요청은
semantic 후보와 `tagCodes` 필터 후보를 합친 뒤 재랭킹한다. prototype 결측·version
불일치·Qdrant timeout이면 GMS/embedding API를 요청 중 호출하지 않고 명시적인
fallback을 반환해야 한다.

### 3.6 품질 확인과 runtime 반영

태그가 운영 index에 실제로 연결된 경우에만 sidecar를 함께 넣어 가중치를 평가한다.
현재 `tune`의 semantic은 TF-IDF proxy이므로, 결과는 배포 승인 근거 중 하나로만
사용하고 운영 ANN 품질은 staging Qdrant에서 별도로 확인한다.

배치 전후에는 `smoke` 명령으로 원본 validation, sidecar version/coverage, 관계 기반
weight tuning을 하나의 report에 남긴다. sidecar가 없으면 태그 상태를
`NOT_PROVIDED`로 기록하면서 semantic·관계 평가를 계속한다.

```bash
uv run b102-recommendation --config config/local.toml smoke \
  --input "$SOURCE" \
  --tag-sidecar "$RUN_DIR/tags.jsonl" \
  --tag-version "$TAG_VERSION" \
  --k 5 --recall-k 10 \
  --output "$RUN_DIR/smoke.json"
```

`smoke.json`의 `status="PASS"`, `validation.blockingErrors=0`을 확인하고,
`tags.coverage`, `tags.lowConfidenceRows`, `recommendedMetrics.pAt5`,
`recommendedMetrics.recallAt10`, `recommendedMetrics.diversityAt5`,
`recommendedMetrics.candidateShortageQueries`를 기록한다.

```bash
uv run b102-recommendation --config config/local.toml tune \
  --input "$SOURCE" \
  --tag-sidecar "$RUN_DIR/tags.jsonl" \
  --k 5 --recall-k 10 \
  --output "$RUN_DIR/tuning.json"
```

report와 함께 다음 값을 기록한다.

- `inputHash`, `indexVersion`, `embeddingVersion`, `tagVersion`
- `recommendedConfig`, `recommendedWeights`
- P@5, Recall@10, target coverage, diversity, candidate shortage
- validation/tag/index report 경로와 실행 시각

검증이 통과하면 서버의 `deploy/.env`에서 다음 값을 한 번에 변경하고 AI 컨테이너를
재생성한다. 실제 운영 비밀값은 보존하고, 변경 전 값을 run directory에 기록한다.

```bash
# 변경 전 백업: 값 자체가 포함된 파일은 Git에 추가하지 않는다.
cp ../deploy/.env "$RUN_DIR/deploy.env.before"

# deploy/.env에서 다음 버전을 같은 release로 반영
# AI_INDEX_VERSION=d4l-20260909-01
# AI_MODEL_VERSION=gms-embedding-20260909-01
# AI_TAG_VERSION=d4l-tags-20260909-01
# QDRANT_TAG_COLLECTION=tags_active   # prototype 적재를 완료한 경우에만

docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml up -d --force-recreate ai
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml ps ai qdrant
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml exec -T ai \
  python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=3).read().decode())'
```

health 응답의 `modelVersion`, `indexVersion`이 이번 release와 같아야 한다. 이후
백엔드 경유 smoke request로 다음을 확인한다.

- 정상 personalized 요청이 200이며 top-5를 반환하는지
- seed/exclude ISBN이 결과에 없는지
- index timeout·query vector 결측 시 fallback 응답이 500이 아닌지
- 추천 응답의 `modelVersion`·`indexVersion`이 report와 같은지

## 4. 롤백 절차

롤백 대상은 애플리케이션 환경변수만이 아니라 Qdrant `books_active` alias까지
이전 index로 함께 돌려야 한다. `AI_INDEX_VERSION`만 이전 값으로 바꾸면 alias가 새
collection을 가리킨 채 이전 version filter와 불일치할 수 있다.

### 4.1 즉시 runtime 롤백

배포 직전 기록한 값을 확인하고, 이전 index collection이 Qdrant에 남아 있는지 먼저
확인한다. `PREVIOUS_INDEX_VERSION`은 추측하지 말고 `deploy.env.before` 또는 직전
성공 report에서 복사한다.

```bash
export PREVIOUS_INDEX_VERSION=<직전 성공 indexVersion>
export PREVIOUS_MODEL_VERSION=<직전 성공 modelVersion>
export PREVIOUS_TAG_VERSION=<직전 성공 tagVersion>
export QDRANT_URL=http://127.0.0.1:6333
export QDRANT_COLLECTION_PREFIX=books
export QDRANT_COLLECTION=books_active
export QDRANT_API_KEY=<secret manager에서 주입>
export EMBEDDING_DIMENSION=1536
```

먼저 이전 collection으로 active alias를 복구한다. 이 명령은 새 데이터를 삭제하지
않고 alias만 이전 version collection으로 이동한다.

```bash
uv run python -c 'import os; from recommendation.embedding_batch import QdrantVersionedIndexStore; QdrantVersionedIndexStore(base_url=os.environ["QDRANT_URL"], collection_prefix=os.environ.get("QDRANT_COLLECTION_PREFIX", "books"), active_alias=os.environ.get("QDRANT_COLLECTION", "books_active"), dimension=int(os.environ.get("EMBEDDING_DIMENSION", "1536")), timeout_seconds=10, api_key=os.environ.get("QDRANT_API_KEY") or None).promote(os.environ["PREVIOUS_INDEX_VERSION"])'
```

그 다음 `deploy/.env`를 이전 버전으로 되돌리고 AI만 재생성한다.

```bash
# AI_INDEX_VERSION=PREVIOUS_INDEX_VERSION
# AI_MODEL_VERSION=PREVIOUS_MODEL_VERSION
# AI_TAG_VERSION=PREVIOUS_TAG_VERSION
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml up -d --force-recreate ai
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml exec -T ai \
  python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=3).read().decode())'
```

### 4.2 롤백 후 확인

```bash
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml ps ai qdrant
docker compose --env-file ../deploy/.env -f ../deploy/docker-compose.yml logs --tail 100 ai
```

최소 smoke request를 실행하고 `indexVersion`이 이전 값인지, 결과가 hard exclude를
지키는지 확인한다. 장애 원인, 새/이전 version, alias 전환 시각, health 결과를
`$RUN_DIR/rollback-report.md`에 기록한다. 원인 확인 전 새 collection을 삭제하지
않아 재현·복구에 필요한 증거를 보존한다.

## 5. 실패별 판단표

| 상황 | 판단 | 조치 |
| --- | --- | --- |
| validation blocking error | 원본 계약 위반 | 원본 snapshot 교체/수정 후 처음부터 재실행 |
| GMS tag 실패·low confidence 증가 | tag 품질 불확실 | sidecar를 active tag로 연결하지 않고 rule-only 또는 이전 tag 유지 |
| embedding 일부 실패 | index 불완전 | `PARTIAL_FAILURE` 유지, 실패 ISBN 재처리 후 재검증 |
| Qdrant 용량 부족 | 새 collection 생성/최적화 위험 | 배치 중지, 디스크·메모리 확보 후 새 version으로 실행 |
| AI health 실패 | runtime version/연결 불일치 | env와 Qdrant alias를 같은 release로 맞추고 재기동 |
| 추천 결과 5개 미만 | 후보 부족 또는 index 결측 | fallback 상태와 `indexVersion` 확인, 정상 index로 롤백 |
| timeout 증가 | Qdrant·네트워크·메모리 문제 | traffic 완화, 로그/`docker stats` 확인 후 이전 alias 복구 |

## 6. 보존해야 할 산출물

각 실행의 `$RUN_DIR`에 최소 다음 파일을 남긴다.

```text
validation.json
tags-report.json
tags.jsonl                 # 대용량이면 Git이 아닌 EC2 보관소
index-report.json
tuning.json
deploy.env.before          # 접근 권한 제한
rollback-report.md         # 롤백한 경우
```

배치 report의 `inputHash`가 다르면 같은 version을 재사용하지 않는다. 운영 종료 후
이전 Qdrant collection을 정리할 때도 현재 alias와 직전 rollback 후보를 먼저 확인하고,
보존 기간이 지난 version만 별도 승인 후 삭제한다.
