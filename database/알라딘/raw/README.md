# 원본 응답 (raw)

알라딘 Open API 응답을 원형에 가깝게 저장하는 위치다. **내용물은 Git에 포함하지 않는다.**

수집기가 `--output-dir` 아래에 다음 구조로 생성한다.

```text
{output-dir}/raw/parts/
├── list__Bestseller__Book__0.jsonl        # 조회 조건별 원본 레코드
├── list__Bestseller__Book__0.done.json    # 완료 표시 + 종료 사유
├── search__Keyword__SalesPoint__Book__656__파이썬.jsonl
└── lookup__000000.jsonl                   # ISBN 청크 단위 상세 조회 결과
```

| 파일 | 내용 |
| --- | --- |
| `{조건명}.jsonl` | `item` 배열의 레코드를 한 줄에 하나씩. 응답 래퍼는 제외 |
| `{조건명}.done.json` | 수집 건수, `totalResults`, 종료 사유(`stop_reason`) |
| `{조건명}.part` | 수집 중인 임시 파일. 완료 시 `.jsonl`로 교체 |

`.done.json`이 있는 파트는 재실행 시 건너뛴다. 하루 호출 한도로 중단되어도 다음 날 이어서 수집할 수 있는 근거가 이 파일이다.

레코드에는 수집기가 붙인 `_source_label`(조회 조건) 또는 `_seed_isbn13`(조회에 사용한 ISBN)이 포함된다. 원본 API 필드가 아니므로 정제 단계에서 분리한다.

실제 값을 확인하려면 `samples/`의 소형 샘플을 본다.
