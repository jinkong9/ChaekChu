# 수집 메타데이터

수집 실행을 재현하고 실패 구간을 추적하기 위한 파일을 저장한다.

| 파일 | 설명 |
| --- | --- |
| `range_plan.json` | 날짜 구간별 예상 수집 건수 |
| `range_count_cache.json` | API `TOTAL_COUNT` 조회 캐시 |
| `unresolved_ranges.json` | API 오류 등으로 끝까지 수집하지 못한 구간 |

메타데이터 파일의 건수와 실제 Raw 레코드 건수가 다를 수 있으므로, 품질 리포트에서 두 값을 함께 비교한다.
