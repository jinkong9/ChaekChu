# AI 태그 품질 회귀·규모 검증 Runbook

이 문서는 선택적·다건 GMS 태그 생성 결과를 기존 baseline과 비교하고, 품질 gate 통과 후 10만 건으로 확장하는 절차다. 원천 데이터와 API key는 Git에 저장하지 않는다.

## 1. 비교 대상 준비

baseline과 candidate는 동일한 입력 snapshot으로 생성해야 한다. 각 실행의 `tags.jsonl`과 report 경로를 기록한다.

```bash
cd ~/S15P21B102
set -a
source deploy/.env
set +a

export INPUT=/home/ubuntu/d4l_usage.sample.1000.jsonl.gz
export BASELINE=/home/ubuntu/pipeline_data/data4library/recommendation-runs/batch-smoke-1000-20260911-005738/tags.jsonl
export CANDIDATE=/home/ubuntu/pipeline_data/data4library/recommendation-runs/batch-selective-1000-<실행시각>/tags.jsonl
export QUALITY_REPORT=/home/ubuntu/pipeline_data/data4library/recommendation-runs/batch-selective-1000-<실행시각>/tag-quality-report.json
```

## 2. baseline/candidate 품질 비교

```bash
cd ~/S15P21B102/ai

uv run b102-recommendation \
  --config config/local.toml \
  tag-quality \
  --input "$INPUT" \
  --baseline-sidecar "$BASELINE" \
  --candidate-sidecar "$CANDIDATE" \
  --max-missing-increase 0 \
  --max-coverage-drop 0 \
  --output "$QUALITY_REPORT"
```

`tag-quality`는 다음을 비교한다.

- 입력 hash와 baseline/candidate ISBN 집합
- 중복 ISBN, 누락 행, coverage
- 태그 code별 개수와 source 분포
- 변경 행 수와 baseline 태그 유지율
- 후보 결과의 누락 증가·coverage 하락 여부

report의 `status=PASS`여야 다음 규모로 진행한다. `FAIL`이면 report의 `blockingErrors`를 먼저 확인하며, 명령도 non-zero exit code로 종료된다.

```bash
jq '.tagQuality | {
  status,
  baseline: {rows, missingRows, coverage, tagAssignments},
  candidate: {rows, missingRows, coverage, tagAssignments},
  comparison,
  blockingErrors
}' "$QUALITY_REPORT"
```

## 3. 10만 건 실행

10만 건은 GMS 비용·시간이 발생하므로 tmux에서 실행한다. threshold는 먼저 검증한 `0.85`, batch size는 `16`에서 시작한다.

```bash
cd ~/S15P21B102
set -a
source deploy/.env
set +a

export INPUT=/home/ubuntu/pipeline_data/scale-inputs/d4l_usage.100000.jsonl.gz
export TAG_BATCH_SIZE=16
export TAG_RULE_CONFIDENCE_THRESHOLD=0.85
export RUN_ID=scale-100000-$(date +%Y%m%d-%H%M%S)
export RUN_DIR=/home/ubuntu/pipeline_data/data4library/recommendation-runs/$RUN_ID
export TAG_VERSION=d4l-tags-$RUN_ID
mkdir -p "$RUN_DIR"

tmux new -s "tag-$RUN_ID"
```

tmux 안에서 실행한다.

```bash
cd ~/S15P21B102/ai

/usr/bin/time -v -o "$RUN_DIR/tags.time.txt" \
uv run b102-recommendation \
  --config config/local.toml \
  tags \
  --input "$INPUT" \
  --sidecar "$RUN_DIR/tags.jsonl" \
  --tag-version "$TAG_VERSION" \
  --batch-size "$TAG_BATCH_SIZE" \
  --rule-confidence-threshold "$TAG_RULE_CONFIDENCE_THRESHOLD" \
  --max-retries 2 \
  --output "$RUN_DIR/tags-report.json"
```

실행 중에는 `Ctrl+B`, `D`로 detach하고 다른 SSH 터미널에서 아래를 실행한다. `RUN_DIR`은 첫 번째 터미널에서 출력된 값을 그대로 사용한다.

```bash
export RUN_DIR=/home/ubuntu/pipeline_data/data4library/recommendation-runs/실행한-RUN_ID
export TOTAL=100000

while true; do
  clear
  date

  DONE=0
  if test -f "$RUN_DIR/.tags.jsonl.tmp"; then
    DONE=$(wc -l < "$RUN_DIR/.tags.jsonl.tmp")
  elif test -f "$RUN_DIR/tags.jsonl"; then
    DONE=$(wc -l < "$RUN_DIR/tags.jsonl")
  fi

  PID=$(pgrep -n -f "b102-recommendation.*$(basename "$RUN_DIR")" || true)
  if test -n "$PID"; then
    echo "상태: RUNNING"
    ELAPSED=$(ps -o etime= -p "$PID" | tr -d ' ')
    echo "경과 시간: $ELAPSED"
  else
    echo "상태: STOPPED 또는 완료"
  fi

  awk -v done="$DONE" -v total="$TOTAL" 'BEGIN {
    printf "진행: %d / %d (%.2f%%)\n", done, total, done / total * 100
  }'

  if test -f "$RUN_DIR/tags-report.json"; then
    jq '.tags | {
      status, rows, succeededRows, missingRows,
      gmsAttempts, gmsRequests, gmsBatchRequests,
      gmsFailures, gmsSkippedRows, ruleConfidenceThreshold
    }' "$RUN_DIR/tags-report.json"
    break
  fi

  sleep 10
done
```

## 4. 10만 건 통과 기준

- `status=SUCCESS`
- `rows`가 실제 입력 행 수와 일치
- `missingRows`와 `gmsFailures`의 원인 확인
- `gmsSkippedRows`가 0.85 선택 정책과 일치
- `gmsRequests`가 전수 단건 기준보다 감소
- `gmsBatchRequests`가 0보다 크고, 처리 시간·메모리를 기록
- sidecar `inputHash`, tag version, taxonomy version을 보관

10만 건 태그가 통과한 뒤에만 동일 `TAG_VERSION`으로 임베딩 index와 tag prototype index를 생성하고, FastAPI smoke 및 백엔드 연동을 확인한다.
