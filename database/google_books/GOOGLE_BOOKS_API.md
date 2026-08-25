# Google Books API 수집 자료

`DATA_SOURCE_STRATEGY.md` 13장은 Google Books를 "키 없는 호출은 공용 쿼터라 즉시 429,
자체 키도 1,000 queries/day"라는 **쿼터 근거**로 제외했다.
자체 키를 확보해 재검증한 결과, **제외 판단은 유지하되 근거를 쿼터가 아니라 한국서 커버리지로 교체한다.**

수집일 2026-08-25 · API 호출 842회

| 측정 | 표본 | 결과 |
| --- | --- | --- |
| 매칭률 (`isbn:` 단건 조회) | n=33 한국서 | 48.5% |
| description 보유율 (색인 수확) | **n=13,702** 한국어 volume | 연도별 0.9% ~ 84.2% |
| 무조건부 확보율 (재가중 추정) | — | **9.1%** |

<br/>

## 1. 공식 API URL과 인증 방식

| 항목 | 내용 |
| --- | --- |
| 엔드포인트 | `https://www.googleapis.com/books/v1/volumes` |
| 공식 문서 | https://developers.google.com/books/docs/v1/using |
| 인증 | 쿼리 파라미터 `key={API_KEY}` |
| 키 발급 | Google Cloud Console → APIs & Services → Credentials (Books API 활성화 필요) |
| 키 보관 | `.env` 의 `GOOGLE_BOOKS_API_KEY`. `.gitignore` 로 제외한다 |

무키 호출은 프로젝트 공용 쿼터를 쓰므로 사실상 항상 429다. [실측]

```json
{"error": {"code": 429, "message": "Quota exceeded for quota metric 'Queries' and limit
'Queries per day' of service 'books.googleapis.com' for consumer 'project_number:624717413613'."}}
```

자체 키로는 59회 연속 호출까지 429가 발생하지 않았다. 일일 한도 자체는 응답으로 알 수 없고
Cloud Console의 Quotas 화면에서 확인해야 한다. **미확인 항목이다.**

<br/>

## 2. 요청 파라미터와 실제 요청 예시

| 파라미터 | 필수 | 설명 |
| --- | --- | --- |
| `q` | 필수 | 검색어. ISBN 조회는 `isbn:{ISBN13}` |
| `key` | 사실상 필수 | API 키 |
| `maxResults` | 선택 | 최대 40. ISBN 조회는 5로 충분 |
| `country` | 선택 | ISO 국가코드. **매칭 결과에는 영향 없음** [실측] |
| `langRestrict` | 선택 | 언어 제한 |
| `projection` | 선택 | `full` / `lite` |

```bash
curl "https://www.googleapis.com/books/v1/volumes?q=isbn:9791162245767&key=[발급받은키]&country=KR&maxResults=5"
```

`country` 민감도는 실측으로 배제했다. `not_found` 6건을 `KR` / `US` / 미지정 세 설정으로
재조회했으나 세 경우 모두 0/6이다. **지역 제한이 아니라 색인 부재다.**

<br/>

## 3. 응답 래퍼와 실제 레코드 예시

래퍼는 3키다.

```json
{"kind": "books#volumes", "totalItems": 1, "items": [ ... ]}
```

**미매칭 시 오류가 아니라 `items` 키 자체가 없다.** 이 형태를 결측으로 처리해야 한다.

```json
{"kind": "books#volumes", "totalItems": 0}
```

`items[]` 원소 구조:

```
kind · id · etag · selfLink
volumeInfo   : title, subtitle, authors[], publisher, publishedDate, description,
               industryIdentifiers[], readingModes, pageCount, printType, categories[],
               averageRating, ratingsCount, maturityRating, imageLinks, language,
               previewLink, infoLink, canonicalVolumeLink
saleInfo     : country, saleability, isEbook, listPrice{amount,currencyCode},
               retailPrice{...}, buyLink
accessInfo   : country, viewability, embeddable, publicDomain, epub, pdf,
               webReaderLink, accessViewStatus
searchInfo   : textSnippet
```

<br/>

## 4. 필드별 자료형·결측 표현·실제 값

결측 표현은 **키 자체가 없는 방식**이다. 알라딘처럼 `""`/`0` 으로 채우지 않는다.
따라서 `key in volumeInfo` 검사와 빈값 검사를 분리할 필요가 거의 없다. 단 예외가 있다(7장).

매칭 성공 21건 기준 결측률 — `reports/missing_report_seed_sample.csv`

| 필드 | 자료형 | 결측률 | 비고 |
| --- | --- | --- | --- |
| `title` | str | 0.00% | |
| `publishedDate` | str | 0.00% | **형식 혼재** `2024` / `2022-06` / `2013-12-24` |
| `pageCount` | int | 0.00% | |
| `language` | str | 0.00% | **신뢰 불가.** 국내서가 `en` 으로 오는 사례 있음 |
| `previewLink` / `infoLink` | str | 0.00% | |
| `authors` | list | 14.29% | |
| `categories` | list | 47.62% | Google 자체 분류. KDC와 무관 |
| `description` | str | **52.38%** | 핵심 필드. 아래 참조 |
| `subtitle` | str | 61.90% | |
| `publisher` | str | 61.90% | **표기 혼재** `문학동네` / `Munhak Dongnae` |
| `averageRating` | float | 85.71% | |
| `ratingsCount` | int | 85.71% | |

<br/>

## 5. 우리 서비스에서의 역할과 저장 위치

**결론: description 소스로 채택하지 않는다.** 근거는 아래 실측이다.

계층별 결과 — `reports/data_quality_summary_seed_sample.txt`

| 계층 | 유효요청 | 매칭 | 매칭률 | 소개 보유 | 사용가능(≥100자) | 사용가능률 |
| --- | --- | --- | --- | --- | --- | --- |
| `FOREIGN` (외서) | 5 | 5 | **100.0%** | 5 | 5 | **100.0%** |
| `KR_CATALOG` (국중 샘플) | 5 | 4 | 80.0% | **0** | **0** | **0.0%** |
| `KR_RETAIL` (베스트셀러·신간) | 28 | 12 | 42.9% | 5 | 4 | 14.3% |
| **한국서 합계** | **33** | **16** | **48.5%** | **5** | **4** | **12.1%** |

핵심은 **매칭률과 텍스트 확보율이 전혀 다른 수치**라는 점이다.
`KR_CATALOG` 는 80% 매칭됐지만 description 은 4건 모두 0자다.
"Google Books가 이 책을 안다"와 "쓸 수 있는 소개문이 있다"는 별개다.

기존 소스 대비:

| 소스 | 책소개 보유율 | 표본 |
| --- | --- | --- |
| 알라딘 `ItemLookUp` | **54.67%** | n=300 [실측] |
| 국중 `BOOK_INTRODUCTION` | 6.49% | n=2,047,239 [실측] |
| **Google Books (한국서, 무조건부 추정)** | **9.1%** | n=13,702 + n=33 [실측] |
| Google Books (외서) | 100.0% | n=5 [실측] |

알라딘의 6분의 1이고, 국중 자체 보유율보다 약간 높은 수준에 그친다.
다만 이 평균값은 연도 편차를 감춘다. 5.2~5.4 참조.

### 5.1 유일하게 유효한 용도 — 외서

외서는 5/5 완전 매칭에 5/5 소개 확보다. 국중 카탈로그 안의 외국서(`978-0` / `978-1` 접두)
한정으로는 최상급 소스다. 다만 이는 서비스 타깃(일반 한국 독자) 밖의 소수 구간이므로
**우선순위를 부여하지 않는다.**

### 5.2 발간연도별 description 보유율 [실측 n=13,702]

`scripts/google_books_ko_harvester.py` 로 한국어 도서 13,702건을 수확해
연도별 보유율을 측정했다. 상세는 `reports/data_quality_summary_ko_harvest_by_year.txt`.

**연도에 따라 극단적으로 다르다.** 대표값은 subject 축 기준이다.

| 구간 | 표본 n | 사용가능 | 보유율 | 95% CI |
| --- | --- | --- | --- | --- |
| ~1999 | 967 | 9 | **0.9%** | 0.5~1.8 |
| 2000-04 | 402 | 12 | 3.0% | 1.7~5.1 |
| 2005-09 | 553 | 17 | 3.1% | 1.9~4.9 |
| 2010-14 | 403 | 59 | 14.6% | 11.5~18.4 |
| 2015-19 | 475 | 82 | 17.3% | 14.1~20.9 |
| 2020-24 | 411 | 85 | 20.7% | 17.0~24.9 |
| 2025- | 76 | 64 | **84.2%** | 74.4~90.7 |

최저 대비 최고 **90배**다. 그러나 원인은 발간연도가 아니다.

### 5.3 진짜 원인은 레코드 출처다

Google Books에는 성격이 다른 두 종류의 레코드가 섞여 있다.

| 종류 | 유입 경로 | 대리 지표 |
| --- | --- | --- |
| **파트너 레코드** | 출판사가 직접 등록 | `publisher` 필드 있음 |
| **스캔 레코드** | 도서관 장서 스캔 | `publisher` 필드 없음 |

연도를 통제한 교차표 (subject 축):

| 구간 | 파트너 n | 파트너 보유율 | 스캔 n | 스캔 보유율 |
| --- | --- | --- | --- | --- |
| ~1999 | 67 | 0.0% | 900 | 1.0% |
| 2000-04 | 78 | 5.1% | 324 | 2.5% |
| 2005-09 | 82 | 11.0% | 471 | 1.7% |
| 2010-14 | 73 | 68.5% | 330 | 2.7% |
| 2015-19 | 84 | 96.4% | 391 | 0.3% |
| 2020-24 | 83 | 94.0% | 328 | 2.1% |
| **전체** | **532** | **53.8%** | **2,755** | **1.5%** |

**스캔 레코드는 모든 연대에서 1~3%로 평평하다. 연도 효과가 전혀 없다.**
파트너 레코드만 연도에 따라 오른다. 즉 관측된 연도 상관은 교란이며,
실제 결정 요인은 "출판사가 Google에 등록했는가"다.

### 5.4 국중 연대 구성으로 재가중한 추정치

subject 축 표본은 옛날 책을 과대 표집한다(스캔본이 검색에 많이 걸린다).
표본 비중 29.4% vs 국중 실측 5.6%. 따라서 단순 평균은 과소평가다.
국중 연대 분포(`DATA_SOURCE_STRATEGY.md` 6.1)로 사후층화 가중하면:

| 단계 | 값 |
| --- | --- |
| 색인 포함 조건부 보유율 (재가중) | **18.8%** |
| × 매칭률 (n=33, 낙관 편향) | 48.5% |
| **= 무조건부 확보율 추정** | **9.1%** |

알라딘 실측 54.67%의 **6분의 1**이다.

<br/>

## 6. JOIN 키와 정규화 규칙

| 항목 | 규칙 |
| --- | --- |
| JOIN 키 | `volumeInfo.industryIdentifiers[].identifier` 중 `type == "ISBN_13"` |
| 원본 보존 | 요청값 `isbn13_raw` 와 응답값 `isbn13_norm` 을 모두 저장한다 |
| 자료형 | **문자열 고정.** 정수 변환 시 `979` 접두 및 선행 0이 파괴된다 |

`q=isbn:` 검색은 요청 ISBN과 다른 판본을 돌려줄 수 있다.
수집기는 `industryIdentifiers` 를 대조해 정확 일치하지 않으면 `isbn_mismatch` 로 분류하고
**성공으로 세지 않는다.** 이번 표본에서는 `isbn_mismatch` 0건이었다.

<br/>

## 7. 결측·중복·이상값 처리 방식

**(1) 플레이스홀더 description** — 가장 위험한 이상값이다.

```
9788954682152  작별 하지 않는다  description = "In Korean field only." (21자)
9788954682237  작별하지 않는다   description = "무엇을 생각하면..." (737자)
```

비어 있지 않으므로 `is_blank()` 검사를 통과한다. 그대로 임베딩에 넣으면
`DATA_SOURCE_STRATEGY.md` 11.1이 경고한 가짜 클러스터가 생긴다.
품질 리포트는 `USABLE_MIN_CHARS = 100` 임계값으로 이를 분리한다.

**(2) 판본 중복** — 같은 도서가 ISBN별로 나뉘고 품질 편차가 크다. 위 예시가 그대로 해당한다.

**(3) `publisher` 로마자 혼재** — `문학동네` / `Munhak Dongnae`. 출판사 기준 조인 시 정규화가 필요하다.

**(4) `publishedDate` 형식 혼재** — `2024`, `2022-06`, `2013-12-24`. 연도만 안전하게 파싱한다.

**(5) `language` 오류** — `9788994797700`(국내 발행)이 `language=en`. 언어 판별에 쓰지 않는다.

<br/>

## 8. 수집 코드 실행 방법

```bash
cd database/google_books
cp .env.example .env    # GOOGLE_BOOKS_API_KEY 채우기
```

```bash
py scripts/build_seed.py
```

```bash
py scripts/google_books_collector.py --resume
```

```bash
py scripts/google_books_quality_report.py --scope seed_sample
```

| 스크립트 | 역할 |
| --- | --- |
| `build_seed.py` | 저장소 커밋 샘플/리포트에서 실측 ISBN13 추출, 계층 라벨 부여 |
| `google_books_collector.py` | ISBN 단건 조회(매칭률 측정), 정확 일치 검증, `--resume` 지원 |
| `google_books_quality_report.py` | 계층별 매칭률·소개 보유율·필드 결측률·샘플 생성 |
| `google_books_ko_harvester.py` | 한국어 도서 대량 수확(출판사 축 + 주제 축), `--max-calls` 예산 |
| `analyze_description_by_year.py` | 발간연도별 보유율, 축 편향 비교, 파트너/스캔 교차표, 사후층화 |

대량 수확과 연도 분석:

```bash
py scripts/google_books_ko_harvester.py --max-calls 450
```

```bash
py scripts/analyze_description_by_year.py
```

표준 라이브러리만 사용한다. `requests` 불필요.

<br/>

## 9. 대용량 결과물을 저장하지 않는 이유와 외부 데이터 위치

`raw/` 와 `processed/` 는 `.gitignore` 로 제외한다.
이번 실행은 39건 122KB로 작지만, 확장 시 ISBN 1건 = 응답 1건 구조라 선형 증가한다.
확장 수집이 필요하면 `--output` 으로 외부 경로를 지정한다.

```bash
py scripts/google_books_collector.py --output "C:\data\google_books_output\raw\volumes_raw_20260825.jsonl"
```

Git에 남기는 것은 `samples/`, `reports/`, `metadata/` 뿐이다.

<br/>

## 10. 표본의 한계

측정이 두 갈래이고 한계가 서로 다르다. 섞어 읽으면 안 된다.

| | 매칭률 측정 | 보유율 측정 |
| --- | --- | --- |
| 스크립트 | `google_books_collector.py` | `google_books_ko_harvester.py` |
| 표본 | **n=33** (한국서) | **n=13,702** (한국어 volume) |
| 프레임 | 저장소 커밋 샘플에서 추출한 ISBN | Google Books 색인 자체 |
| 측정 대상 | 국중 ISBN을 Google이 아는가 | 아는 책에 소개문이 있는가 |
| 주된 편향 | 베스트셀러·신간 편중 → **과대평가** | 색인 포함 조건부 → **상한** |

### 10.1 매칭률(n=33)의 한계

로컬에 국중 수집 원본(`raw/`)이 없어 204만건에서 무작위 표본을 뽑을 수 없었다.
저장소 커밋 샘플에서 추출했고 그 출처는 알라딘 베스트셀러와 YES24 신상품이 29/33이다.
**Google Books가 가장 잘 아는 구간에 몰려 있으므로 48.5%는 상한이다.**
무작위 표본에서는 더 낮아진다.

### 10.2 보유율(n=13,702)의 한계

색인에 없는 책은 애초에 표본에 들어오지 않는다. 곧 **조건부 확률**이다.
무조건부 확보율은 매칭률을 곱해야 나온다(5.4).

또한 쿼리 축에 따라 결과가 크게 달라진다. `inpublisher:` 축은
publisher 필드가 있는 레코드만 매칭하므로 파트너 레코드만 골라내
보유율을 5.4~20.7%p 과대평가한다. 대표값은 subject 축으로 읽어야 한다.

subject 축도 연대 구성이 국중과 다르다(~1999 구간이 29.4% vs 국중 5.6%).
5.4의 사후층화 가중이 이를 보정한 값이다.

### 10.3 신뢰도가 낮은 구간

`2025-` 구간은 n=76으로 작다(95% CI 74.4~90.7%).
11.1의 신간 트랙 판단은 이 구간에 의존하므로, 채택 전 표본 확대가 필요하다.

<br/>

## 11. 최종 판단

`DATA_SOURCE_STRATEGY.md` 13장의 제외를 **유지**한다. 다만 근거를 교체하고, 예외를 하나 둔다.

| | 기존 서술 | 재검증 결과 |
| --- | --- | --- |
| 제외 근거 | 쿼터 1,000/day → 204만건 2,040일 | 쿼터는 미확인. **한국서 커버리지가 진짜 이유** |
| 무키 호출 | 즉시 429 | 확인됨 [실측] |
| 한국서 소개 확보율 | 미측정 | **9.1%** (재가중 추정) [실측 n=13,702 + n=33] |
| 연도별 편차 | 미측정 | **0.9% (~1999) ~ 84.2% (2025-)**, 90배 |
| 진짜 결정 요인 | — | 발간연도가 아니라 **레코드 출처**(파트너 vs 스캔) |
| 외서 | 언급 없음 | **100%** [실측 n=5] |

13장 표의 Google Books 행을 다음으로 갱신할 것을 제안한다.

> Google Books API — 전량 대상으로는 제외. 한국서 무조건부 소개 확보율 9.1% 추정으로
> 알라딘 54.67%의 1/6. 단 **2025년 이후 신간은 84.2%**(n=76)로 국중 6.49%를 크게 상회하므로,
> 10.1의 신간 cold start 트랙 보조 소스로는 재검토 가치가 있다.

### 11.1 예외 — 신간 트랙에서는 살릴 수 있다

`DATA_SOURCE_STRATEGY.md` 10.1은 "출간 6개월 이내 신간은 대출 이력이 없어
구조적으로 전멸한다"는 cold start 문제를 지적한다.
바로 그 구간에서 Google Books가 가장 강하다.

| 구간 | Google Books | 국중 원본 |
| --- | --- | --- |
| 2025년 이후 | **84.2%** | 6.49% (전체 평균) |
| 2020-24 | 20.7% | |
| ~1999 | 0.9% | |

메커니즘상 합리적이다. 출판사가 신간을 파트너 프로그램에 등록하면서 소개문을 함께 올리고,
과거 도서는 스캔 경로로만 들어와 소개문이 없다. 신간일수록 파트너 비중이 높다.

다만 채택 전에 확인할 것이 두 가지다.

1. **2025- 구간 n=76은 작다.** 95% CI가 74.4~90.7%로 넓다.
2. **매칭률을 함께 재야 한다.** 84.2%는 색인에 있는 책 기준이다.
   신간 ISBN을 국중에서 뽑아 매칭률부터 측정해야 무조건부 확보율이 나온다.

<br/>

## 12. 남은 측정 과제

| # | 측정 | 방법 | 호출 수 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | 신간(2025-) 매칭률 | 국중 2025년 ISBN 500건 → `isbn:` 조회 | 500 | **미실행. 11.1의 전제** |
| 2 | 연도별 매칭률 | 국중 연도층화 ISBN 2,000건 | 2,000 | 미실행 |
| 3 | 일일 쿼터 실측 | Cloud Console Quotas 화면 | 0 | 미확인 |

1·2번은 **국중 수집 원본(`raw/`)이 있어야 한다.** 현재 이 저장소와 로컬에 없다.
원본을 확보하면 `google_books_collector.py --seed` 에 ISBN 목록을 넣어 즉시 실행 가능하다.
