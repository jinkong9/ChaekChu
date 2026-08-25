# 도서관 정보나루 도서 상세 조회 API

국립중앙도서관(국중도) 수집 데이터에서 저자·책소개 같은 핵심 필드가 비어 있는 ISBN만 골라
정보나루 `srchDtlList`로 조회하고, 결과를 **국중도 39개 필드 스키마로 정규화**해서 저장하는
gap-driven 보강 수집 파이프라인이다. 전체 재수집이 아니라 결측 보강 전용이다.

## 1. 공식 API와 인증

| 항목 | 내용 |
| --- | --- |
| 서비스 | 도서관 정보나루 (문화체육관광부 · 국립중앙도서관) |
| 포털 | https://www.data4library.kr |
| 엔드포인트 | `https://data4library.kr/api/srchDtlList` (도서 상세 조회) |
| 인증 | 쿼리 파라미터 `authKey`. 포털 마이페이지에서 발급 |
| 쿼터 | 기본 인증키 일 500회. 활용 신청 승인 시 일 30,000회 |
| 키 보관 | `.env`의 `DATA4LIBRARY_AUTH_KEY` (`.env.example` 참고). 커밋 금지 |

## 2. 요청 파라미터와 실제 요청 예시

| 파라미터 | 값 | 설명 |
| --- | --- | --- |
| `authKey` | 발급 키 | 필수 |
| `isbn13` | 13자리 ISBN | 필수. 이 파이프라인의 조회 단위 |
| `loaninfoYN` | `N` | 대출 정보 미포함. 서지 보강만 필요하므로 N 고정 |
| `format` | `json` | 기본은 XML. JSON으로 받는다 |

```text
GET https://data4library.kr/api/srchDtlList?authKey={KEY}&isbn13=9791186150306&loaninfoYN=N&format=json
```

## 3. 응답 래퍼와 레코드 예시

```json
{
  "response": {
    "request": {"isbn13": "9791186150306", "loaninfoYN": "N"},
    "detail": [
      {
        "book": {
          "no": 1,
          "bookname": "책 제목",
          "authors": "지은이: 홍길동;그림: 김철수",
          "publisher": "출판사명",
          "publication_year": "2017",
          "isbn13": "9791186150306",
          "addition_symbol": "03810",
          "vol": "",
          "class_no": "813.7",
          "class_nm": "문학 > 한국문학 > 소설",
          "description": "출판사가 등록한 책소개 본문…",
          "bookImageURL": "https://bookthumb-phinf.pstatic.net/…"
        }
      }
    ]
  }
}
```

- 해당 ISBN 레코드가 없으면 `detail`이 빈 배열로 온다(미히트). 오류가 아니다.
- 인증·쿼터 문제는 `response.error`에 메시지로 온다. 수집기는 이 경우 즉시 중단한다.

## 4. 필드 매핑 (정보나루 → 국중도 스키마)

정규화 결과는 국중도와 동일한 39개 필드 레코드다. 매핑되지 않는 필드는 빈 문자열 `""`로 둔다
(국중도의 결측 표현과 동일). `DEPOSIT_YN` 같은 국중도 고유 필드에 임의값을 넣지 않는다.

| 정보나루 | 국중도 | 비고 |
| --- | --- | --- |
| `isbn13` | `EA_ISBN` | JOIN 키. 문자열 유지 |
| `bookname` | `TITLE` | |
| `authors` | `AUTHOR` | `지은이: 홍길동;그림: 김철수` 형식. 국중도(`홍길동 지음 ; 김철수 그림`)와 표기가 다르므로 저자명 정규화 로직이 두 형식을 모두 처리해야 한다 |
| `publisher` | `PUBLISHER` | |
| `addition_symbol` | `EA_ADD_CODE` | 앞자리 0 보존. 숫자 변환 금지 |
| `vol` | `VOL` | |
| `class_no` | `KDC` | 정보나루 분류는 KDC 기반 |
| `description` | `BOOK_INTRODUCTION` | 책소개 성격이므로 `BOOK_SUMMARY`(요약)가 아닌 `BOOK_INTRODUCTION`에 넣는다 |
| `bookImageURL` | `TITLE_URL` | 표지 이미지 URL |
| `publication_year` | (매핑 안 함) | 연도 4자리만 제공되어 8자리 `PUBLISH_PREDATE` 규칙과 맞지 않고, 국중도에 이미 있는 값이라 채울 필요가 없다 |
| `class_nm`, `no` | (매핑 안 함) | raw에만 보존 |

## 5. 우리 서비스에서의 역할과 저장 위치

| 산출물 | 경로 | Git |
| --- | --- | --- |
| 응답 원형 | `raw/dtl_raw_{YYYYMMDD}.jsonl` | 제외 |
| 국중도 스키마 정규화본 | `processed/data4library_normalized_{YYYYMMDD}.jsonl` | 제외 |
| 소형 샘플 | `samples/sample_data4library.jsonl`, `.pretty.json` | 포함 |
| 품질 요약 | `reports/data_quality_summary_gap_{YYYYMMDD}.txt` | 포함 |
| 필드 리포트 | `reports/missing_report_gap_{YYYYMMDD}.csv` (`scripts/data4library_missing_report.py`로 생성) | 포함 |
| 수집 계획 | `metadata/range_plan.json` (수집기 실행 시 자동 갱신) | 포함 |
| gap list | `metadata/gap_isbn_list_{YYYYMMDD}.jsonl` | 크기에 따라 판단 |
| 추출 요약 | `metadata/gap_extract_summary_{YYYYMMDD}.json` | 포함 |
| 체크포인트 | `metadata/gap_collector_checkpoint.json` | 포함 |
| 실패 기록 | `metadata/unresolved_ranges.json` | 포함 |

출처 구분은 레코드 안 필드가 아니라 **파일명**으로 한다. 정규화 파일 전체가 정보나루산이므로
파일 단위 provenance로 충분하고, 국중도 스키마를 오염시키지 않는다.

## 6. JOIN 키와 정규화 규칙

- JOIN 키: `EA_ISBN`(ISBN-13). gap 추출 단계에서 국중도 ISBN-10은 ISBN-13으로 변환하고
  체크섬이 틀린 값은 제외한다.
- 병합 규칙: 국중도 원본 레코드의 **빈 필드만** 정규화본으로 채운다. 기존 값 덮어쓰기 금지.
- 같은 ISBN이 국중도에 여러 레코드로 있으면, 모든 레코드에서 비어 있을 때만 결측으로 판정한다.

## 7. 결측·중복·이상값 처리

- 결측 판정: `None`, 빈 문자열, 공백, 자리표시 값(`-`, `N/A`, `없음` 등)을 결측으로 본다.
- 정보나루 텍스트에는 `&lt;` 같은 HTML 엔티티가 섞여 온다(실측: `&lt;아몬드&gt;`). 정규화 단계에서
  `html.unescape`로 풀어 국중도 표기와 맞춘다. raw에는 원형 그대로 남는다.
- 필드 그룹 단위 판정: `description`은 `BOOK_INTRODUCTION`과 `BOOK_SUMMARY`가 **둘 다** 비어 있을 때만 결측.
- 미히트(정보나루에 레코드 없음)는 오류가 아니라 정상 결과로 집계한다. 정보나루는 공공도서관
  소장 기반이라 국중도 납본 전용 ISBN은 없을 수 있다.
- 일시 오류는 지수 백오프로 재시도하고, 소진 시 `metadata/unresolved_ranges.json`에 기록한다.

## 8. 수집 코드 실행 방법

```bash
# 1) 국중도 데이터(외부 저장 경로)에서 결측 ISBN 추출
python scripts/extract_gap_isbns.py {국중도_JSONL_파일_또는_디렉토리} --min-year 2015

# 2) 히트율 사전 검증: 300건만 조회해서 reports/ 요약 확인
python scripts/data4library_gap_collector.py --gap-list metadata/gap_isbn_list_{date}.jsonl --max-requests 300

# 3) 본 수집: 매일 실행하면 체크포인트에서 이어서 수집
python scripts/data4library_gap_collector.py --gap-list metadata/gap_isbn_list_{date}.jsonl --max-requests 490
```

- `--fields author,description,cover,kdc`로 결측 판정 그룹을 조정할 수 있다(기본 `author,description`).
- `--min-year`로 대상 연도를 제한해 쿼터를 절약한다. 국중도의 description 계열 결측이 약 200만 건이라
  전수 조회는 비현실적이며, 서비스에 실제 노출될 도서부터 우선한다.
- 수집기는 요청 한도 도달 시 안전하게 멈추고, 다음 실행에서 `gap_collector_checkpoint.json`의
  `next_index`부터 이어서 수집한다. 재시도를 포함한 모든 네트워크 시도가 쿼터 1회를 소모한다.

## 9. 대용량 결과물을 저장하지 않는 이유

`raw/`와 `processed/`는 일 단위로 수만 줄씩 누적되므로 Git에 올리지 않는다(`.gitignore` 적용).
저장 위치가 달라지면 `--output-dir`로 외부 경로를 지정한다. 검토용 실제 값은 `samples/`의
소형 샘플로 확인한다.
