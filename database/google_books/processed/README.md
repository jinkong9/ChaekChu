# processed

`raw/` 응답을 서비스 스키마로 정규화한 결과를 저장하는 위치다.

- 파일명: `volumes_normalized_{YYYYMMDD}.jsonl`
- 결측은 빈 문자열이 아니라 `null` 로 통일한다
- `isbn13_raw`(요청값)와 `isbn13_norm`(정규화값)을 모두 보존한다
- 대용량이므로 Git에 포함하지 않는다
