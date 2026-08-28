/** API 계약 FE 사본 — 단일 기준은 docs/BACKEND_DATA_CONTRACT.md (8/27 회의 반영판)
 *  변경: 요인 점수·가중치·프리셋 폐기 → 해시태그, OAuth 로그인, 감상평(reviewText) 추가 */

/** 도서 요약. bookId는 book_edition 기준 — 계약의 string/authors[] rename은 별도 MR로 일괄 적용 */
export interface BookSummary {
  bookId: number
  title: string
  author: string | null
  publisher: string | null
  coverUrl: string | null
  pageCount: number | null
  publicationYear: number | null
}

export interface BookDetail extends BookSummary {
  isbn13: string | null
  description: string | null
  toc: string | null
  category: string | null // 예: "문학 > 한국소설" (국중/알라딘)
  /** 출처별 지표 — 결측 시 해당 항목 없음 (섹션 숨김 처리) */
  metrics: { source: string; name: string; value: string; asOf: string }[]
  /** 연령대별 대출 분포 (정보나루) — 없으면 섹션 숨김 */
  loanByAge: { ageGroup: string; ratio: number }[] | null
  /** 계약 §6: 로그인 사용자 본인의 상태만 — 비로그인·타인 것은 null */
  myLibraryStatus: ShelfStatus | null
  myRating: number | null
  myReviewText: string | null
}

export type ReasonType = 'SUBJECT_MATCH' | 'AUTHOR_MATCH' | 'TEXT_SIMILAR' | 'CO_LOAN' | 'SEGMENT_POPULAR'

/** 추천 항목 — 수치(적합도·기여도) 대신 해시태그 + 한 문장 (8/27 결정) */
export interface RecommendationItem {
  book: BookSummary
  rank: number
  /** 이 책이 걸린 이유 태그. 예: ['#함께대출', '#성장소설', '#내취향근접'] */
  tags: string[]
  reasonText: string
  reasonType: ReasonType
}

/** GET /recommendations 응답 — recommendationId·rank는 이벤트에 그대로 되돌려 보낸다 */
export interface RecommendationResponse {
  recommendationId: string
  generatedAt: string
  fallback: boolean // true = 콜드스타트 폴백(세그먼트 인기)
  basedOnCount: number // "최근 기록한 N권을 반영했어요"
  appliedTags: string[] // 서버가 이번 덱에 적용한 관심 태그 (없으면 [])
  items: RecommendationItem[]
}

/** 기준 조절(REC-002)용 태그 — 전부 보유 데이터로 계산 가능한 신호에 1:1 매핑 (확정 시 GET /recommendations/tags 로 이동).
 *  감성 태그(#몰입감 등)는 근거 데이터가 없어 제외 — 책 소개 LLM 분류가 생기면 P1로 추가 */
export const SUGGESTED_TAGS = [
  '#내취향근접', // 책 소개 임베딩 ↔ 내 서재(별점 가중) 프로필 벡터 유사도
  '#같은작가',   // books.authors 일치 (내 서재 고평점 저자)
  '#함께대출',   // 정보나루 co-loan — 내가 읽은 책과 동시 대출 빈도
  '#내또래인기', // 세그먼트(연령×성별) 인기대출 상위
  '#지금뜨는',   // book_demand_features.loan_3m_count 급증
  '#스테디셀러', // loan_24m_count 꾸준 (유행 무관 안정성)
  '#베스트셀러', // YES24·알라딘 판매지표
  '#신간',       // published_date 최근 1~2년
  '#새로운분야', // 내 관심 분야 밖 + 유사도 하한선 통과
  '#짧은호흡',   // page_count 하위 구간 — 가볍게 읽는 책
]

export type ShelfStatus = 'WISH' | 'READING' | 'READ' // 찜 / 읽는 중 / 읽음 (계약 표기는 WANT_TO_READ — rename MR에서 통일)

export interface LibraryItem {
  libraryItemId: number
  book: BookSummary
  status: ShelfStatus
  rating: number | null       // 정수 1~5 (계약 확정)
  /** 한 줄 감상평 — 본인 기록 전용, 최대 300자, 공백만이면 null (계약 §4.3) */
  reviewText: string | null
  finishedDate: string | null  // 읽음일 때만, 미입력 시 서버가 오늘로
  progressPage: number | null  // 읽는 중 표시용 (선택 — ERD 반영 대기)
}

export interface SearchResponse {
  total: number
  page: number
  items: BookSummary[]
}
