/** API 계약 초안 — W0 명세 확정 시 이 파일이 단일 기준 (OpenAPI와 동기화) */

/** 도서 요약. bookId는 book_edition 기준 (W0 게이트에서 최종 확정) */
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
}

/** 추천 기준(요인) 키 — REC-002 슬라이더·REC-004 기여도와 1:1 */
export type FeatureKey = 'taste' | 'coLoan' | 'trending' | 'steady' | 'newField'

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  taste: '내 취향과 비슷한 책',
  coLoan: '같이 읽히는 책',
  trending: '지금 뜨는 책',
  steady: '오래 사랑받은 책',
  newField: '새로운 분야',
}

/** 후보별 요인 점수 — rawScore가 null이면 '정보 없음' (계산 분모에서 제외) */
export interface FeatureScore {
  key: FeatureKey
  rawScore: number | null // 0~100
}

export type ReasonType = 'SUBJECT_MATCH' | 'AUTHOR_MATCH' | 'TEXT_SIMILAR' | 'CO_LOAN' | 'SEGMENT_POPULAR'

export interface RecommendationItem {
  book: BookSummary
  rank: number
  /** 종합 적합도 0~100 — 노출 여부는 게이트 재결정 대상 (베타는 숨김 가능) */
  fitScore: number
  featureScores: FeatureScore[]
  /** 한 문장 설명 (REC-004의 요약이자 카드 이유) */
  reasonText: string
  reasonType: ReasonType
}

/** GET /recommendations 응답 — recommendationId·rank는 이벤트 로깅에 그대로 되돌려 보낸다 */
export interface RecommendationResponse {
  recommendationId: string
  generatedAt: string
  fallback: boolean // true = 콜드스타트 폴백(세그먼트 인기)
  basedOnCount: number // "최근 기록한 N권을 반영했어요"
  preset: PresetKey
  weights: Record<FeatureKey, number> // 합계 100 (정규화는 서버)
  items: RecommendationItem[]
}

export type PresetKey = 'balanced' | 'myTaste' | 'discovery' | 'safe'

export const PRESET_LABELS: Record<PresetKey, { name: string; desc: string }> = {
  balanced: { name: '균형 추천', desc: '기본값 · 무난하게' },
  myTaste: { name: '내 취향대로', desc: '읽던 결을 유지' },
  discovery: { name: '새로운 발견', desc: '안 읽던 분야로' },
  safe: { name: '실패 없는 선택', desc: '검증된 책 위주' },
}

export type ShelfStatus = 'WISH' | 'READING' | 'READ' // 찜 / 읽는 중 / 읽음

export interface LibraryItem {
  libraryItemId: number
  book: BookSummary
  status: ShelfStatus
  rating: number | null      // 0.5 단위 여부는 W0 확정
  finishedDate: string | null // 읽음일 때만, 미입력 시 서버가 오늘로
  progressPage: number | null // 읽는 중 표시용 (선택)
}

export interface SearchResponse {
  total: number
  page: number
  items: BookSummary[]
}

/** 요인별 기여도 계산 — 덱 재정렬의 핵심: 적합도 = Σ(원점수×가중치) / Σ(가중치), null 요인은 분모 제외 */
export function computeFit(scores: FeatureScore[], weights: Record<FeatureKey, number>) {
  let num = 0, den = 0
  for (const s of scores) {
    const w = weights[s.key]
    if (s.rawScore === null || w === 0) continue
    num += s.rawScore * w
    den += w
  }
  return den === 0 ? 0 : Math.round((num / den) * 10) / 10
}
