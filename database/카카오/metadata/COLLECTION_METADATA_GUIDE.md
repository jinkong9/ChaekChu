# 카카오 수집 메타데이터 가이드

카카오 도서 검색은 날짜 범위 전체 건수를 제공하지 않으므로 검색어·ISBN과 페이지를 수집 단위로 관리한다.

| 파일 | 역할 | Git 정책 |
| --- | --- | --- |
| `range_plan.json` | 입력 유형, 검색 수, 페이지·파트 크기와 실행 계획 | 현재 v1→v2 변환 계획 포함 |
| `range_count_cache.json` | 검색어별 `total_count`, 페이지 수, 실제 도서 수 | 기존 수집분의 관측 캐시 포함 |
| `data_manifest.json` | v2 Raw 파트와 Processed 파일의 건수·용량·SHA-256 | 팀 전달 검증용으로 포함 |
| `unresolved_ranges.json` | 재시도 후 실패한 검색어·페이지·HTTP 상태·오류 | 개인정보·키가 없는 범위에서 포함 |
| `title_crawl_v2.runtime.json` | 제목 순회 커서와 미완료 파트 상태 | 실행 전용, Git 제외 |
| `*_merge.sqlite3` | 대용량 중복 제거용 임시 인덱스 | 실행 전용, Git 제외 |

`range_count_cache.json`의 1,979개 검색어 건수는 카카오 검색 결과의 관측값이다. 검색 API이므로 전체 카탈로그 건수나 완전한 커버리지를 의미하지 않는다.

`unresolved_ranges.json`의 항목은 다음 필드를 사용한다.

```json
{
  "scope": "isbn",
  "part": "isbn_000001",
  "query": "9788996991342",
  "target": "isbn",
  "page": 1,
  "http_status": 500,
  "error": "HTTP Error 500",
  "attempts": 4,
  "last_attempt_at": "2026-08-25T00:00:00+00:00"
}
```

API 키, 인증 헤더, 대용량 Raw·Processed 파일, SQLite와 런타임 로그는 메타데이터에 포함하거나 Git에 커밋하지 않는다.

팀원이 공유 저장소에서 Processed 파일을 받은 뒤 `data_manifest.json`의 `bytes`, `sha256`, `record_count`를 확인하면 로컬 변환 결과와 동일한지 검증할 수 있다.
