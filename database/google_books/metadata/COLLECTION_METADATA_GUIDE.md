# metadata 파일 안내

| 파일 | 내용 |
| --- | --- |
| `seed_isbns.jsonl` | 조회 대상 ISBN13과 계층(`FOREIGN`/`KR_CATALOG`/`KR_RETAIL`) 라벨. `build_seed.py` 생성 |
| `collection_run_20260825.json` | 실행 메타데이터. 호출 수, 계층별 결과, 발견사항, 결론 |
| `unresolved_ranges.json` | API 오류·쿼터 소진으로 미해결된 ISBN과 원인 |

`range_plan.json` 과 `range_count_cache.json` 은 사용하지 않는다.
Google Books는 날짜 구간 순회형 API가 아니라 ISBN 단건 조회형이라
수집 계획이 곧 `seed_isbns.jsonl` 이기 때문이다.
