/** API 계약 FE 사본 — 단일 기준은 docs/BACKEND_DATA_CONTRACT.md
 *  추천은 해시태그로 설명하고, feature 점수·가중치로 최종 순위를 계산한다. */

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

/** 최종 추천 랭킹에 사용하는 요인. 태그는 taste 점수를 만드는 책 단위 재료다. */
export type FeatureKey = 'taste' | 'coLoan' | 'trending' | 'steady' | 'newField'

/** 후보별 요인 점수. 값이 null이면 해당 요인은 계산에서 제외한다. */
export interface FeatureScore {
  key: FeatureKey
  rawScore: number | null // 0~100
}

export type ReasonType = 'SAME_AUTHOR' | 'SAME_CATEGORY' | 'TEXT_SIMILARITY' | 'SEGMENT_POPULAR' | 'DEMAND_POPULAR' | 'MOMENTUM' | 'NEW_BOOK' | 'INITIAL_PREFERENCE'

export type RecommendationMode = 'ANONYMOUS_TAG' | 'COLD_START' | 'PERSONALIZED'

/** 추천 항목 — 해시태그는 설명용, featureScores는 랭킹 재현용 */
export interface RecommendationItem {
  book: BookSummary
  rank: number
  score: number // 최종 가중 점수 0~100
  featureScores: FeatureScore[]
  /** 이 책이 추천된 이유를 사람이 이해할 수 있게 표시하는 태그 */
  tags: string[]
  reasonText: string
  reasonType: ReasonType
}

/** GET /recommendations 응답 — recommendationId·rank는 이벤트에 그대로 되돌려 보낸다 */
export interface RecommendationResponse {
  recommendationId: string
  generatedAt: string
  mode: RecommendationMode
  sessionId: string | null
  fallback: boolean // true = 콜드스타트 폴백(세그먼트 인기)
  basedOnCount: number // "최근 기록한 N권을 반영했어요"
  /** 이번 추천 결과에 적용한 최종 랭킹 가중치. 합계는 서버가 정규화한다. */
  weights: Record<FeatureKey, number>
  appliedTags: string[] // 서버가 이번 덱에 적용한 관심 태그 (없으면 [])
  items: RecommendationItem[]
}

/** 사용자가 선택하거나 추천 이유로 볼 수 있는 통제된 태그 목록.
 *  태그는 책·사용자 취향을 표현하고, 최종 순위는 weights가 조절한다. */
export const SUGGESTED_TAGS = [
  '#소설',       // 국중도 SUBJECT/KDC·외부 카테고리
  '#에세이',     // 국중도 SUBJECT/KDC·외부 카테고리
  '#과학',       // 국중도 SUBJECT/KDC·외부 카테고리
  '#판타지',     // 카테고리·책소개 기반 콘텐츠 분류
  '#추리',       // 카테고리·책소개 기반 콘텐츠 분류
  '#성장',       // 책소개·목차 기반 콘텐츠 분류
  '#내취향근접', // 책 소개 임베딩 ↔ 내 서재(별점 가중) 프로필 벡터 유사도
  '#같은작가',   // books.authors 일치 (내 서재 고평점 저자)
  '#함께대출',   // 정보나루 item-item 연관 신호 — 개인별 협업 필터링 아님
  '#내또래인기', // 세그먼트(연령×성별) 인기대출 상위
  '#지금뜨는',   // book_demand_features.loan_3m_count 급증
  '#스테디셀러', // loan_24m_count 꾸준 (유행 무관 안정성)
  '#베스트셀러', // 알라딘 등 판매지표. 공공 대출량과 분리
  '#신간',       // published_date 최근 1~2년
  '#새로운분야', // 내 관심 분야 밖 + 유사도 하한선 통과
  '#짧은호흡',   // page_count 하위 구간 — 가볍게 읽는 책
]

export type ShelfStatus = 'WISH' | 'READING' | 'READ' // 찜 / 읽는 중 / 읽음

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
