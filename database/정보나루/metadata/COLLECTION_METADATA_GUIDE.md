# 정보나루 수집 메타데이터

| 파일 | 역할 | Git 포함 |
| --- | --- | --- |
| `range_plan.json` | 수집 실행 계획(입력 gap list·재개 지점·배치 한도). 수집기가 실행마다 갱신 | 포함 |
| `gap_isbn_list_{YYYYMMDD}.jsonl` | 국중도 결측 ISBN 목록. 수집기의 입력 | 제외(수십 MB) |
| `gap_extract_summary_{YYYYMMDD}.json` | 추출 실행 요약(대상 필드·건수·필터) | 포함 |
| `gap_collector_checkpoint.json` | 수집 재개 지점(`next_index`)과 누적 요청·히트 수 | 포함 |
| `unresolved_ranges.json` | 재시도 소진·오류 응답 ISBN과 원인 | 포함 |

- 체크포인트의 `request_count_total`은 이 수집기가 기록한 호출 수이며 인증키 전체 사용량이 아니다.
  키 단위 정확한 사용량은 정보나루 포털에서 확인한다.
- 체크포인트는 gap list 경로를 기억한다. 다른 gap list로 바꾸려면 `--reset`을 사용한다.
- API 키와 `.env` 값은 메타데이터에 기록하지 않는다.
