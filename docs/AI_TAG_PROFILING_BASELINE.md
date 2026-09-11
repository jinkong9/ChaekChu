# AI 태그 생성 프로파일링 기준

## 목적

도서 태그 생성 단계에서 GMS 호출이 차지하는 시간과 비용을 기준선으로 고정한다. 이후 규칙 기반 우선 분기와 다건 요청을 적용했을 때 동일한 입력·taxonomy 기준으로 성능과 품질을 비교할 수 있어야 한다.

## 현재 처리 흐름

1. D4L JSONL에서 도서 1건을 읽는다.
2. 규칙 기반 tagger가 D4L에 존재하는 필드만 사용해 1차 태그를 만든다.
3. GMS Chat Completions API를 도서 1건 단위로 호출한다.
4. 허용 taxonomy에 포함된 GMS 결과만 검증한다.
5. 규칙 태그와 GMS 태그를 confidence 기준으로 병합한다.
6. 태그 sidecar와 실행 report를 원자적으로 저장한다.

현재 구조에서는 GMS provider가 설정된 경우 모든 입력 도서에 대해 최소 1회의 GMS 요청이 발생한다. 따라서 GMS 호출 수가 입력 행 수와 거의 같고, 실패 시 재시도 횟수만큼 증가할 수 있다.

## 2026-09-10 기준선

입력은 `d4l_usage.10000.jsonl.gz`이며, 입력 해시와 산출물 버전은 실행 report에 기록한다.

| 단계 | 행 수 | 소요 시간 | 최대 RSS | GMS 시도 | GMS 실패 | 결과 |
|---|---:|---:|---:|---:|---:|---|
| 태그 생성 | 10,000 | 2:48:11 | 32,996 KiB | 10,000 | 0 | 성공 |
| 도서 임베딩 인덱스 | 10,000 | 0:42.73 | 39,604 KiB | 해당 없음 | 해당 없음 | 승격 |
| 태그 prototype 인덱스 | 14 | 0:04.93 | 28,776 KiB | 해당 없음 | 해당 없음 | 승격 |

태그 생성 결과의 추가 지표는 다음과 같다.

- `succeededRows`: 10,000
- `missingRows`: 0
- `lowConfidenceRows`: 1,781
- `retriedRows`: 0
- `sourceDataCommitted`: `false`
- `tagVersion`: `d4l-tags-scale-10000-20260910`
- `indexVersion`: `d4l-small-scale-10000-20260910`

### 기준선 해석

- 태그 생성은 전체 배치 시간의 사실상 병목이다.
- 현재 관측 처리량은 약 59.2건/분이다.
- 단순 선형 가정에서는 태그 생성만 100,000건에 약 27시간 56분, 1,000,000건에 약 11일 38시간이 필요하다.
- 위 추정은 네트워크 지연, rate limit, 입력 텍스트 길이, 재시도 증가를 반영하지 않은 참고값이다.
- 임베딩과 Qdrant 인덱싱은 현재 10,000건 기준 태그 생성보다 훨씬 짧다.

## 측정 방법

실행마다 고유한 `RUN_ID`, `TAG_VERSION`, `INDEX_VERSION`을 사용한다. 비밀값은 report나 문서에 기록하지 않는다.

```bash
RUN_DIR=/home/ubuntu/pipeline_data/data4library/recommendation-runs/$RUN_ID

/usr/bin/time -v -o "$RUN_DIR/tags.time.txt" \
  uv run b102-recommendation --config config/local.toml tags \
  --input "$INPUT" \
  --sidecar "$RUN_DIR/tags.jsonl" \
  --tag-version "$TAG_VERSION" \
  --max-retries 2 \
  --output "$RUN_DIR/tags-report.json"

grep -E 'Elapsed|Maximum resident|User time|System time' \
  "$RUN_DIR/tags.time.txt"

jq '{
  status: .tags.status,
  rows: .tags.rows,
  succeededRows: .tags.succeededRows,
  missingRows: .tags.missingRows,
  lowConfidenceRows: .tags.lowConfidenceRows,
  resumedRows: .tags.resumedRows,
  gmsAttempts: .tags.gmsAttempts,
  gmsFailures: .tags.gmsFailures,
  tagVersion: .tags.tagVersion
}' "$RUN_DIR/tags-report.json"
```

측정 결과에는 다음 항목을 함께 보관한다.

- 입력 행 수와 `inputHash`
- wall-clock 시간, user/system CPU 시간, 최대 RSS
- `gmsAttempts`, `gmsFailures`, `retriedRows`
- `missingRows`, `lowConfidenceRows`
- `tagVersion`, `taxonomyVersion`, `outputHash`

## 최적화 비교 기준

후속 작업의 전후 비교는 동일한 입력 파일과 taxonomy를 사용한다. `inputHash`가 다르면 성능 비교 결과로 취급하지 않는다.

| 지표 | 현재 기준 | 개선 목표 |
|---|---:|---|
| GMS 호출 수/입력 행 | 1.00 | 규칙 확정 행은 0, 불확실 행만 호출 |
| GMS 실패율 | 0% (10k) | 0% 유지, 실패 행은 누락 없이 report |
| 태그 생성 시간 | 2:48:11 / 10k | 호출 감소 또는 다건화로 유의미한 감소 |
| 태그 누락 | 0건 | 0건 유지 |
| low-confidence 비율 | 17.81% | 증가하지 않도록 품질 회귀 확인 |
| 결과 재현성 | 동일 입력·설정에서 hash 비교 | 기존 계약 유지 |

`lowConfidenceRows`는 단순히 줄이는 것이 목표가 아니다. GMS 호출을 줄인 뒤에도 표본 검토와 회귀 평가에서 태그 정확도가 유지되는지 확인해야 한다.

## 다음 작업과의 연결

- **#173**: 규칙 기반으로 충분히 확정할 수 있는 행은 GMS를 호출하지 않고, 불확실한 행만 선택적으로 호출한다.
- **#174**: 선택된 행을 가능한 경우 다건 요청으로 묶고 ISBN별 응답 매핑·재시도·부분 실패를 검증한다.
- **#175**: 동일 입력의 기존 기준선과 최적화 결과를 비교하고, 품질 통과 후 100,000건 검증으로 확장한다.

## 완료 조건

- 10,000건 기준 측정값과 실행 report 위치를 기록했다.
- 태그 생성이 병목이라는 사실과 호출 수 산정 기준을 문서화했다.
- 후속 최적화 전후에 비교할 지표와 품질 하한을 정의했다.
- 원천 데이터와 fixture, API key를 Git에 추가하지 않았다.
