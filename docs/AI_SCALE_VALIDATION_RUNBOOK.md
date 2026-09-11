# AI 추천 규모별 검증 Runbook

이 문서는 1,000건 샘플에서 검증한 추천 파이프라인을 EC2에서 1만·10만·100만 건으로 단계적으로 검증하기 위한 절차다. GMS 호출과 Qdrant 쓰기가 발생하므로 작은 단계가 통과한 뒤 다음 단계로 진행한다.

## 1. 사전 조건

EC2에서 `dev` 최신 코드를 사용하고, `deploy/.env`에 다음 값이 설정되어 있어야 한다.

```bash
cd ~/S15P21B102
git switch dev
git pull --ff-only origin dev

set -a
source deploy/.env
set +a

export SOURCE=/home/ubuntu/pipeline_data/data4library/d4l_usage.jsonl.gz
export COMPOSE='docker compose --env-file deploy/.env -f deploy/docker-compose.yml'
export RUN_ROOT=/home/ubuntu/pipeline_data/data4library/recommendation-runs
```

서비스와 Qdrant가 정상인지 먼저 확인한다.

```bash
$COMPOSE --profile recsys up -d --wait ai qdrant
$COMPOSE exec -T ai python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5).read().decode())'
```

응답의 `status`가 `ok`이고 `indexVersion`이 `none`이 아니어야 한다.

## 2. 단계별 입력 파일 생성

원천 데이터는 수정하지 않고 각 단계의 gzip JSONL을 별도로 만든다. 첫 줄부터 사용하는 방식이므로 샘플 편향이 있을 수 있으며, 최종 품질 판단은 전체 데이터 실행으로 한다.

```bash
mkdir -p /home/ubuntu/pipeline_data/data4library/scale-inputs

for SIZE in 1000 10000 100000; do
  gzip -dc "$SOURCE" | head -n "$SIZE" | gzip > "/home/ubuntu/pipeline_data/data4library/scale-inputs/d4l_usage.${SIZE}.jsonl.gz"
done
```

100만 건 파일이 이미 원천 데이터 전체라면 별도 복사하지 않고 `SOURCE`를 직접 사용한다. 행 수는 반드시 확인한다.

```bash
for FILE in /home/ubuntu/pipeline_data/data4library/scale-inputs/*.gz; do
  echo "$FILE"
  gzip -dc "$FILE" | wc -l
done
```

## 3. 단계별 태그·임베딩·태그 인덱스 실행

각 단계마다 고유한 `RUN_ID`, `TAG_VERSION`, `INDEX_VERSION`을 사용한다. 같은 버전으로 중단된 명령을 재실행하면 sidecar와 Qdrant staging index를 재사용할 수 있다.

```bash
export SIZE=10000
export INPUT=/home/ubuntu/pipeline_data/data4library/scale-inputs/d4l_usage.${SIZE}.jsonl.gz
export RUN_ID=scale-${SIZE}-$(date +%Y%m%d-%H%M%S)
export RUN_DIR=$RUN_ROOT/$RUN_ID
export TAG_VERSION=d4l-tags-$RUN_ID
export INDEX_VERSION=d4l-small-$RUN_ID
mkdir -p "$RUN_DIR"

cd ~/S15P21B102/ai

/usr/bin/time -v -o "$RUN_DIR/tags.time.txt" \
  uv run b102-recommendation --config config/local.toml tags \
  --input "$INPUT" \
  --sidecar "$RUN_DIR/tags.jsonl" \
  --tag-version "$TAG_VERSION" \
  --max-retries 2 \
  --output "$RUN_DIR/tags-report.json"

/usr/bin/time -v -o "$RUN_DIR/index.time.txt" \
  uv run b102-recommendation --config config/local.toml index \
  --input "$INPUT" \
  --index-version "$INDEX_VERSION" \
  --tag-sidecar "$RUN_DIR/tags.jsonl" \
  --batch-size 32 \
  --max-retries 2 \
  --output "$RUN_DIR/index-report.json"

/usr/bin/time -v -o "$RUN_DIR/tag-index.time.txt" \
  uv run b102-recommendation --config config/local.toml tag-index \
  --input "$INPUT" \
  --index-version "$INDEX_VERSION" \
  --tag-version "$TAG_VERSION" \
  --batch-size 32 \
  --max-retries 2 \
  --output "$RUN_DIR/tag-index-report.json"
```

태그 생성은 GMS 비용과 시간이 가장 크게 늘어날 수 있으므로 1만 건 결과를 확인한 뒤 10만 건으로 진행한다. 실패하거나 SSH가 끊겨도 같은 `RUN_ID`와 출력 경로로 재실행한다.

## 4. 건수·해시·승격 검증

```bash
jq '{status,rows,succeededRows,failedRows,gmsAttempts,gmsFailures,gmsSkippedRows,ruleConfidenceThreshold,missingRows,lowConfidenceRows}' \
  "$RUN_DIR/tags-report.json"

jq '{status,promoted,rows,succeededRows,failedRows,skippedRows,retriedRows,dimension,indexVersion,tagVersion}' \
  "$RUN_DIR/index-report.json"

jq '{status,promoted,rows,succeededRows,failedRows,dimension,indexVersion,tagVersion}' \
  "$RUN_DIR/tag-index-report.json"
```

GMS를 사용하는 경우 `TAG_RULE_CONFIDENCE_THRESHOLD`도 실행 설정으로 기록한다. 기본값은 `0.85`이며, 규칙 기반 태그 중 하나라도 해당 confidence 이상이면 해당 도서의 GMS 호출을 생략한다. report의 `gmsSkippedRows`와 `ruleConfidenceThreshold`로 선택적 호출 결과를 확인한다.

다음 조건이 모두 맞아야 해당 단계가 통과다.

- 태그 `rows`와 `succeededRows`가 입력 행 수와 일치한다. `missingRows`와 `gmsFailures`는 원인 확인 없이 무시하지 않는다.
- 임베딩 `rows`가 입력 행 수와 같고 `failedRows`가 0이다.
- 임베딩 `dimension`은 1536이고 `embeddingVersion`은 `text-embedding-3-small`이다.
- `promoted`가 `true`이고 `indexVersion`, `tagVersion`, `inputHash`가 같은 단계의 산출물에서 일치한다.
- Qdrant point 수가 `succeededRows`와 일치한다.

Qdrant point 수는 다음처럼 확인한다.

```bash
$COMPOSE exec -T ai python -c 'import os,urllib.request,json; c=os.environ["QDRANT_COLLECTION"]; u=os.environ["QDRANT_URL"].rstrip("/")+"/collections/"+c; r=urllib.request.Request(u,headers={"api-key":os.environ.get("QDRANT_API_KEY","")}); print(json.load(urllib.request.urlopen(r,timeout=10))["result"]["points_count"])'
```

## 5. 추천 smoke 테스트

운영 API가 같은 인덱스를 읽는지 확인한 뒤 태그-only, 혼합 가중치, 콜드스타트를 각각 실행한다.

```bash
cd ~/S15P21B102

$COMPOSE exec -T ai python -c 'import json,urllib.request; p={"requestId":"scale-tag-1","userId":"scale-user","mode":"PERSONALIZED","size":5,"tags":[{"code":"FANTASY","weight":1.0}],"weights":{"semantic":0.0,"tagMatch":1.0,"coLoan":0.0,"trending":0.0,"steady":0.0}}; r=urllib.request.Request("http://127.0.0.1:8000/internal/v1/recommendations",data=json.dumps(p).encode(),headers={"Content-Type":"application/json"}); b=json.load(urllib.request.urlopen(r,timeout=15)); print(json.dumps(b,ensure_ascii=False,indent=2)); assert b["fallback"] is False and len(b["items"]) == 5 and all("FANTASY" in x["matchedTags"] for x in b["items"]); print("tag-only: PASS")'
```

백엔드 연동은 별도의 인증 토큰을 사용하므로 이 문서에 토큰을 기록하지 않는다. AI 내부 smoke가 통과한 뒤 백엔드 API에서 동일한 인덱스 버전과 결과를 확인한다.

## 6. 시간·메모리·비용 기록

`time.txt`에서 다음 값을 기록한다.

```bash
grep -E 'Elapsed|Maximum resident|User time|System time' "$RUN_DIR"/*.time.txt
```

- `Elapsed (wall clock) time`: 실제 소요 시간
- `Maximum resident set size`: 최대 메모리 사용량
- report의 `rows`, `gmsAttempts`, `failedRows`: 처리량·실패율 산정 기준

임베딩 비용은 GMS 콘솔의 모델별 단가와 실제 요청 토큰량을 기준으로 산정한다. 1만 건에서 측정한 평균 비용을 10만·100만 건에 단순 곱하기 전에 책 텍스트 길이 분포와 배치 크기를 함께 기록한다.

## 7. 재현성·중단 복구

같은 입력 파일, `TAG_VERSION`, `INDEX_VERSION`, 모델, 설정으로 재실행한 뒤 다음 해시가 동일해야 한다.

```bash
jq -r '.inputHash, .outputHash' "$RUN_DIR/tags-report.json"
jq -r '.inputHash, .tagSidecarHash, .indexVersion' "$RUN_DIR/index-report.json"
```

SSH 연결이 끊긴 경우 `tmux`나 `nohup`으로 재실행하고, 이미 생성된 `tags.jsonl`과 Qdrant staging version을 삭제하지 않는다. fixture와 원천 데이터는 Git에 추가하지 않는다.
