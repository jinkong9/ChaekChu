# raw

Google Books API `volumes` 응답을 원형에 가깝게 저장하는 위치다.

- 파일명: `volumes_raw_{YYYYMMDD}.jsonl`
- 1행 = ISBN 1건에 대한 조회 결과(요청 메타 + 응답 원본)
- 대용량이므로 Git에 포함하지 않는다. `--output` 으로 외부 경로 지정 가능
