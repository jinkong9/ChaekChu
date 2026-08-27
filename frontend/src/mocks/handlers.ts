import { http, HttpResponse } from 'msw'
import type { BookSummary, FeatureScore, LibraryItem, RecommendationResponse, SearchResponse, ShelfStatus } from '../api/types'

/** ============ mock 카탈로그 ============ */
const b = (bookId: number, title: string, author: string, publisher: string, pageCount: number, publicationYear: number): BookSummary =>
  ({ bookId, title, author, publisher, coverUrl: null, pageCount, publicationYear })

const CATALOG: BookSummary[] = [
  b(1, '수레바퀴 아래서', '헤르만 헤세', '민음사', 328, 2023),
  b(2, '싯다르타', '헤르만 헤세', '문예출판사', 244, 2021),
  b(3, '호밀밭의 파수꾼', 'J.D. 샐린저', '민음사', 280, 2019),
  b(4, '변신', '프란츠 카프카', '문학동네', 152, 2022),
  b(5, '이방인', '알베르 카뮈', '민음사', 216, 2020),
  b(6, '아몬드', '손원평', '창비', 264, 2017),
  b(7, '데미안', '헤르만 헤세', '민음사', 240, 2000),
  b(8, '어린 왕자', '생텍쥐페리', '열린책들', 136, 2015),
  b(9, '1984', '조지 오웰', '민음사', 400, 2007),
  b(10, '노르웨이의 숲', '무라카미 하루키', '민음사', 480, 2013),
  b(11, '채식주의자', '한강', '창비', 247, 2007),
  b(12, '불편한 편의점', '김호연', '나무옆의자', 268, 2021),
]

/** ============ 추천 ============ */
const fs = (taste: number | null, coLoan: number | null, trending: number | null, steady: number | null, newField: number | null): FeatureScore[] => [
  { key: 'taste', rawScore: taste }, { key: 'coLoan', rawScore: coLoan }, { key: 'trending', rawScore: trending },
  { key: 'steady', rawScore: steady }, { key: 'newField', rawScore: newField },
]

const recommendations: RecommendationResponse = {
  recommendationId: 'rec-mock-001',
  generatedAt: new Date().toISOString(),
  fallback: false,
  basedOnCount: 4,
  preset: 'balanced',
  weights: { taste: 35, coLoan: 25, trending: 15, steady: 10, newField: 15 },
  items: [
    { rank: 1, book: CATALOG[0], fitScore: 87, featureScores: fs(87, 77, null, 68, 73), reasonType: 'TEXT_SIMILAR',
      reasonText: '최근 높은 별점을 준 3권과 주제가 가까우면서, 그 책들을 빌린 사람들이 함께 많이 빌린 책입니다.' },
    { rank: 2, book: CATALOG[1], fitScore: 81, featureScores: fs(84, 70, null, 74, 60), reasonType: 'AUTHOR_MATCH',
      reasonText: '선호하는 작가의 다른 작품이에요.' },
    { rank: 3, book: CATALOG[2], fitScore: 79, featureScores: fs(72, 85, 40, 80, 55), reasonType: 'CO_LOAN',
      reasonText: '『데미안』을 빌린 사람들이 함께 많이 빌린 책이에요.' },
    { rank: 4, book: CATALOG[3], fitScore: 76, featureScores: fs(70, 66, 55, 78, 62), reasonType: 'TEXT_SIMILAR',
      reasonText: '최근 읽은 책들과 서사 결이 비슷해요.' },
    { rank: 5, book: CATALOG[4], fitScore: 74, featureScores: fs(68, 64, 48, 82, 50), reasonType: 'TEXT_SIMILAR',
      reasonText: '완독한 책들과 주제 키워드가 겹쳐요.' },
    { rank: 6, book: CATALOG[5], fitScore: 71, featureScores: fs(60, 74, 66, 58, 70), reasonType: 'CO_LOAN',
      reasonText: '내 또래가 이 책과 함께 많이 빌렸어요.' },
  ],
}

/** ============ 서재 (in-memory — 세션 동안 상태 유지) ============ */
let nextLibraryId = 3
const library: LibraryItem[] = [
  { libraryItemId: 1, book: CATALOG[6], status: 'READ', rating: 4.5, finishedDate: '2026-08-20', progressPage: null },
  { libraryItemId: 2, book: CATALOG[9], status: 'READING', rating: null, finishedDate: null, progressPage: 142 },
]

/** ============ 핸들러 ============ */
export const handlers = [
  // 인증 — mock: OAuth authorize 응답으로 callback 이후 상태를 대신한다.
  http.get('*/auth/oauth/:provider/authorize', ({ params }) => {
    const provider = String(params.provider).toUpperCase()
    if (provider !== 'KAKAO' && provider !== 'GOOGLE') {
      return HttpResponse.json({ message: '지원하지 않는 OAuth provider입니다.' }, { status: 400 })
    }
    return HttpResponse.json({
      accessToken: 'mock-token',
      nickname: provider === 'KAKAO' ? '카카오 독자' : 'Google 독자',
      onboarded: false,
    })
  }),

  // 온보딩
  http.get('*/books/popular', () => HttpResponse.json({ items: CATALOG.slice(4, 12) })), // 세그먼트 인기 (온보딩 그리드용)
  http.post('*/users/me/preferences', () => new HttpResponse(null, { status: 204 })),

  // 검색
  http.get('*/books/search', ({ request }) => {
    const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
    const items = q.length < 1 ? [] : CATALOG.filter((bk) => bk.title.includes(q) || (bk.author ?? '').includes(q))
    return HttpResponse.json({ total: items.length, page: 1, items } satisfies SearchResponse)
  }),

  // 추천·상세
  http.get('*/recommendations', () => HttpResponse.json(recommendations)),
  http.get('*/books/:id', ({ params }) => {
    const found = CATALOG.find((bk) => bk.bookId === Number(params.id)) ?? CATALOG[0]
    return HttpResponse.json({
      ...found, isbn13: '9791100000000',
      description: '자기 자신을 잃어버린 채 어른들의 기대 속에서 소진되어 가는 한 소년의 이야기. 성장과 자아 탐색이라는 주제를 정면으로 다룬다.',
      toc: '1부\n2부\n3부', category: '문학 > 한국소설',
      metrics: [
        { source: '정보나루', name: '전국 대출 순위', value: '상위 3%', asOf: '2026-06' },
        { source: '알라딘', name: '평균 별점', value: '4.2 · 128명', asOf: '2026-08' },
      ],
      loanByAge: [
        { ageGroup: '10대', ratio: 8 }, { ageGroup: '20대', ratio: 34 }, { ageGroup: '30대', ratio: 38 },
        { ageGroup: '40대', ratio: 14 }, { ageGroup: '50대+', ratio: 6 },
      ],
    })
  }),

  // 서재 CRUD
  http.get('*/library/me', () => HttpResponse.json({ items: library })),
  http.post('*/library', async ({ request }) => {
    const body = (await request.json()) as { bookId: number; status: ShelfStatus }
    const book = CATALOG.find((bk) => bk.bookId === body.bookId)
    if (!book) return new HttpResponse(null, { status: 404 })
    const existing = library.find((li) => li.book.bookId === body.bookId)
    if (existing) { existing.status = body.status } else {
      library.unshift({ libraryItemId: nextLibraryId++, book, status: body.status, rating: null,
        finishedDate: body.status === 'READ' ? new Date().toISOString().slice(0, 10) : null, progressPage: null })
    }
    return new HttpResponse(null, { status: 201 })
  }),
  http.patch('*/library/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<Pick<LibraryItem, 'status' | 'rating'>>
    const item = library.find((li) => li.libraryItemId === Number(params.id))
    if (!item) return new HttpResponse(null, { status: 404 })
    if (body.status) { item.status = body.status; item.finishedDate = body.status === 'READ' ? new Date().toISOString().slice(0, 10) : item.finishedDate }
    if (body.rating !== undefined) item.rating = body.rating
    return HttpResponse.json(item)
  }),

  // 이벤트 수집
  http.post('*/events', () => new HttpResponse(null, { status: 202 })),
]
