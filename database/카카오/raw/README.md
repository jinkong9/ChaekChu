# 원본 응답 (raw)

카카오 도서 검색 API의 `documents`를 **도서 한 권당 JSONL 한 줄**로 저장한다. API 도서 필드는 그대로 보존하고 `_source_query`, `_source_target`, `_source_page`, `_http_status`, `_collected_at`만 수집 추적용으로 추가한다.

```text
raw/parts/
├── isbn_000001.jsonl       # 국립중앙도서관 ISBN 입력 파트
├── isbn_000001.done.json   # 완료 건수·요청 수·종료 상태
├── query_000001.jsonl      # 일반 제목 검색 파트
└── title_000001.jsonl      # 일일 쿼터 제목 순회 파트
```

수집 중에는 `.part`에 기록하고 완료 후 `.jsonl`과 `.done.json`을 만든다. 두 파일이 모두 있는 파트는 재실행 시 건너뛴다.

대용량 Raw와 `.done.json`은 `.gitignore`로 제외하며 이 README만 저장소에 포함한다. 기존 `books_raw_part_*.jsonl`은 요청 응답 래퍼를 저장한 v1 형식이고, 새 수집기는 접두사가 다른 v2 파트를 생성하므로 서로 섞이지 않는다.

현재 v1 8개 파트를 API 재호출 없이 `title_000001.jsonl`~`title_000008.jsonl`로 변환했다. v2 Raw는 도서 429,399줄이며 8번은 마이그레이션 경계에서 닫았다. 기존 v1 파일은 검증·롤백을 위해 그대로 보존한다.
