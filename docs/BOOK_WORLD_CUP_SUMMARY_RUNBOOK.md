# 익명 책 이상형 월드컵 요약 배치

Jira: `S15P21B102-189`
명세: [BOOK_DNA_API_CONTRACT.md §8](BOOK_DNA_API_CONTRACT.md)

## 기준과 비용 가드

- 입력은 데이터 담당자가 제공한 Data4Library JSONL/JSONL.GZ 후보 스냅샷이다. `loan_total` 내림차순, 동률 ISBN13 오름차순으로 상위 N권을 선택한다. 입력 해시, 원천 이름·기간, 선택 규칙을 부착한다.
- GMS에는 책 소개(`desc`), 분류, 출간연도만 보낸다. 제목·저자·ISBN 등 식별정보는 프롬프트 입력에서 제외한다.
- 모델 기본값은 `gpt-4o-mini`, 계획 비용은 요청당 2 크레딧이다. 20권 파일럿 예상은 약 40크레딧, 500권은 약 1,000크레딧이다.
- 기본 최대 예상 비용은 1,200 크레딧이며 요청 횟수도 런타임에 제한한다. 상한을 넘는 실행은 GMS 호출 전에 종료한다.
- 재시작 시 같은 입력 해시·요약 버전의 성공행과 소개 원문이 없는 행은 재사용한다. 부분 파일은 `.<sidecar>.tmp`, 진행 현황은 report JSON이다.
- 월드컵 진행 API에서는 GMS를 부르지 않는다. 요약에 제목·저자 포함, 3문장 이상, 스포일러 표현 등이 검출되면 재시도하며 실패는 `FAILED`로 보고한다.

## 20권 파일럿 (EC2)

실제 GMS 키가 있는 EC2에서 실행한다. 키를 화면이나 로그에 출력하지 않는다.

```bash
cd ~/S15P21B102
set -a
source deploy/.env
set +a

export INPUT=/home/ubuntu/pipeline_data/candidates/2026-09-15/d4l_usage.candidates.jsonl.gz
export RUN_ID=worldcup-pilot-20-$(date +%Y%m%d-%H%M%S)
export RUN_DIR=/home/ubuntu/pipeline_data/data4library/worldcup-runs/$RUN_ID
export WORLD_CUP_SUMMARY_API_URL=${WORLD_CUP_SUMMARY_API_URL:-$TAG_API_URL}
export WORLD_CUP_SUMMARY_API_KEY=${WORLD_CUP_SUMMARY_API_KEY:-$TAG_API_KEY}
export WORLD_CUP_SUMMARY_MODEL=gpt-4o-mini
export WORLD_CUP_SUMMARY_CREDITS_PER_REQUEST=2
export WORLD_CUP_SUMMARY_MAX_ESTIMATED_CREDITS=60
mkdir -p "$RUN_DIR"
```

환경 변수 이름과 입력 파일이 맞는지 확인한 다음 `tmux`에서 시작한다. 출력 경로는 실행마다 새로 만들고 입력은 덮어쓰지 않는다.

```bash
tmux new-session -d -s "$RUN_ID" \
  "cd ~/S15P21B102/ai && \
   uv run b102-recommendation --config config/local.toml worldcup-summaries \
     --input '$INPUT' --sidecar '$RUN_DIR/synopses.jsonl' --report '$RUN_DIR/report.json' \
     --limit 20 --source-period 2026-09-15 --max-estimated-credits 60 --output '$RUN_DIR/artifact.json' \
     > '$RUN_DIR/console.log' 2>&1"
```

다른 Git Bash에서 실시간 진행률을 본다(10초 갱신). report의 성공/실패·요청 수·예상 비용과 임시 sidecar 행 수를 함께 확인한다.

```bash
RUN_DIR=/home/ubuntu/pipeline_data/data4library/worldcup-runs/여기에_RUN_ID
watch -n 10 "date '+%F %T %Z'; jq '{status,selectedRows,processedRows,remainingRows,successRows,missingSourceRows,failedRows,gmsRequests,estimatedGmsCredits,maxEstimatedCredits}' '$RUN_DIR/report.json' 2>/dev/null; wc -l '$RUN_DIR/.synopses.jsonl.tmp' 2>/dev/null; tail -5 '$RUN_DIR/console.log' 2>/dev/null"
```

완료 뒤 파일럿 품질과 실제 GMS 잔액 차감을 확인한다.

```bash
jq '{status,inputRows,selectedRows,successRows,missingSourceRows,failedRows,gmsRequests,estimatedGmsCredits,outputHash}' "$RUN_DIR/report.json"
jq -s '{rows:length, statuses:(group_by(.status)|map({status:.[0].status,count:length})), samples:(map(select(.status=="SUCCESS"))[:5]|map({loanRank,synopsis}))}' "$RUN_DIR/synopses.jsonl"
```

정책 검수에서 제목·저자 노출, 스포일러, 사실 오류를 확인하고, GMS 크레딧 화면의 실제 사용량으로 호출당 평균을 재산출한다. 소개의 대부분이 유효하고 500권 추정 비용이 1,200 이하일 때만 `--limit 500`으로 별도 새 run을 시작한다. 파일럿에서 비용·품질 문제가 보이면 전체 배치를 실행하지 않는다.

500권 실행에서는 파일럿 출력도 재사용해 이미 만든 20권을 다시 호출하지 않는다. `--resume-sidecar`에는 완료된 파일럿 sidecar의 실제 경로를 넣는다.

```bash
uv run b102-recommendation --config config/local.toml worldcup-summaries \
  --input "$INPUT" --sidecar "$RUN_DIR/synopses.jsonl" --resume-sidecar /path/to/pilot/synopses.jsonl \
  --report "$RUN_DIR/report.json" --limit 500 --source-period 2026-09-15 --max-estimated-credits 1200 --output "$RUN_DIR/artifact.json"
```

## 500권 요약을 PostgreSQL에 적재

파일럿 승인 후 500권 실행 결과에서 `SUCCESS`만 CSV로 만든다. 먼저 Flyway V10이 운영 DB에 적용됐는지 확인한다. 아래 적재는 선택된 요약 풀 전체를 한 트랜잭션으로 교체한다. 동작 중 API 조회는 MVCC로 이전 풀을 계속 본다.

```bash
jq -r 'select(.status=="SUCCESS") | [.isbn13,.loanRank,.loanCount,.synopsis,.sourceHash,.inputHash,.sourceName,.sourcePeriod,.selectionRule,.summaryVersion,.modelVersion] | @csv' \
  "$RUN_DIR/synopses.jsonl" > "$RUN_DIR/synopses.csv"
docker cp "$RUN_DIR/synopses.csv" b102-postgres:/tmp/worldcup-synopses.csv
```

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T postgres \
  sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
CREATE TEMP TABLE wc_synopsis_import (
  isbn13 CHAR(13), loan_rank SMALLINT, loan_count BIGINT, synopsis TEXT,
  source_hash CHAR(64), input_hash CHAR(64), source_name VARCHAR(40), source_period VARCHAR(20),
  selection_rule VARCHAR(64), summary_version VARCHAR(64), model_version VARCHAR(64)
);
\copy wc_synopsis_import FROM '/tmp/worldcup-synopses.csv' WITH (FORMAT csv)
DO $$
DECLARE imported_count BIGINT; matched_count BIGINT;
BEGIN
  SELECT count(*) INTO imported_count FROM wc_synopsis_import;
  SELECT count(*) INTO matched_count FROM wc_synopsis_import i JOIN books b ON b.isbn13=i.isbn13;
  IF imported_count <> matched_count THEN
    RAISE EXCEPTION 'world-cup import contains % ISBNs absent from books; matched %', imported_count, matched_count;
  END IF;
  IF matched_count < 16 THEN
    RAISE EXCEPTION 'world-cup requires at least 16 summarized books; got %', matched_count;
  END IF;
END $$;
DELETE FROM book_world_cup_synopses;
INSERT INTO book_world_cup_synopses (isbn13,loan_rank,loan_count,synopsis,source_hash,input_hash,source_name,source_period,selection_rule,summary_version,model_version)
SELECT i.isbn13,i.loan_rank,i.loan_count,i.synopsis,i.source_hash,i.input_hash,i.source_name,i.source_period,i.selection_rule,i.summary_version,i.model_version
FROM wc_synopsis_import i JOIN books b ON b.isbn13=i.isbn13;
COMMIT;
SELECT count(*) AS loaded, min(loan_rank) AS first_rank, max(loan_rank) AS last_rank FROM book_world_cup_synopses;
SQL
```

정상 적재 후 `loaded`가 성공 소개 수와 같은지 확인한다. ISBN이 DB에 없는 행은 JOIN에서 빠지므로 수가 다르면 원인부터 확인하고 세션 API를 열지 않는다.
