# 수집 메타데이터

수집 실행을 재현하고 실패 조건과 호출 예산을 추적하기 위한 파일을 저장한다.

| 파일 | 설명 | Git 포함 |
| --- | --- | --- |
| `category_index.jsonl` | 응답에서 실제로 확인된 분야 ID·분야명·깊이·건수 | 포함 |
| `category_ids.txt` | 위 목록에서 뽑은 `--category-file` 입력용 ID 목록 | 포함 |
| `range_plan.json` | 조회 조건별 실행 계획과 예상 호출 수 | 첫 수집 후 포함 |
| `range_count_cache.json` | 조회 조건별 `totalResults` 캐시 | 첫 수집 후 포함 |
| `unresolved_ranges.json` | API 오류로 끝까지 수집하지 못한 조회 조건과 원인 | 첫 수집 후 포함 |
| `isbn_not_found.jsonl` | 알라딘에 등록되지 않았거나 절판된 ISBN | 제외 |
| `quota_state.json` | 날짜별 호출 사용량 | 제외 |

## 국립중앙도서관과 다른 점

국립중앙도서관은 날짜 구간을 나누고 `TOTAL_COUNT`로 구간별 건수를 미리 확정할 수 있어 `range_plan.json`이 실제 예상 건수를 담는다.

알라딘은 조회 전에 건수를 알 수 없고 한 조건당 접근 가능 건수가 1,000건으로 고정되어 있다. 따라서 `range_plan.json`의 건수는 실측이 아니라 **조건 수 × 조건별 상한**으로 계산한 최대치다.

```json
{
  "mode": "list",
  "target_count": 240,
  "max_items_per_target": 1000,
  "estimated_calls": 4800,
  "estimated_max_rows": 240000
}
```

`estimated_max_rows`는 중복을 포함한 상한이다. 분야 순회는 상위·하위 분야가 겹치므로 실제 고유 건수는 이보다 훨씬 적다. 실제 값은 `reports/data_quality_summary_{scope}.txt`의 "최종 고유 레코드 수"와 "중복으로 제외된 레코드 수"를 비교해 확인한다.

## 분야 목록 확장 절차

알라딘 분야 ID 전체 목록은 별도 문서로만 제공된다. 이를 구하지 않고도 다음 순서로 순회 축을 넓힐 수 있다.

```text
1. --mode list       CategoryId=0 으로 전체를 훑는다
2. --mode categories 수집 결과에서 categoryId 와 categoryIdList 를 모은다
3. --mode list       --category-file metadata/category_ids.txt 로 다시 훑는다
4. 2~3 반복          새 분야가 더 나오지 않을 때까지
```

저장소에 포함된 `category_index.jsonl`은 표본 25건에서 추출한 86개 분야다. 실제 수집을 돌리면 이 파일이 훨씬 큰 목록으로 갱신된다.

## 호출 예산 추적

`quota_state.json`은 날짜 단위로 누적된다.

```json
{ "date": "2026-08-24", "used": 4800 }
```

날짜가 바뀌면 자동으로 초기화된다. 한도에 도달하면 수집기가 정상 종료하고, 다음 실행에서 `.done.json`이 있는 파트를 건너뛰고 이어서 수집한다. 메타데이터 파일의 예상 건수와 실제 Raw 레코드 건수가 다를 수 있으므로 품질 리포트에서 두 값을 함께 비교한다.
