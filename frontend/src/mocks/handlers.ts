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
  b(13, '연금술사', '파울로 코엘료', '문학동네', 272, 2001),
  b(14, '모순', '양귀자', '쓰다', 300, 2013),
  b(15, '사피엔스', '유발 하라리', '김영사', 636, 2015),
  b(16, '코스모스', '칼 세이건', '사이언스북스', 719, 2006),
  // 17~34 — 궤도 홈이 링을 표지로 꽉 채우려면 덱이 두꺼워야 해서 늘린 mock 카탈로그
  b(17, '82년생 김지영', '조남주', '민음사', 192, 2016),
  b(18, '위대한 개츠비', 'F. 스콧 피츠제럴드', '민음사', 264, 2010),
  b(19, '오만과 편견', '제인 오스틴', '민음사', 592, 2003),
  b(20, '죄와 벌', '표도르 도스토옙스키', '민음사', 528, 2012),
  b(21, '총, 균, 쇠', '재레드 다이아몬드', '문학사상', 752, 2005),
  b(22, '이기적 유전자', '리처드 도킨스', '을유문화사', 632, 2018),
  b(23, '정의란 무엇인가', '마이클 샌델', '와이즈베리', 444, 2014),
  b(24, '나미야 잡화점의 기적', '히가시노 게이고', '현대문학', 456, 2012),
  b(25, '해변의 카프카', '무라카미 하루키', '문학사상', 620, 2010),
  b(26, '파과', '구병모', '위즈덤하우스', 332, 2018),
  b(27, '시선으로부터,', '정세랑', '문학동네', 332, 2020),
  b(28, '완득이', '김려령', '창비', 232, 2008),
  b(29, '엄마를 부탁해', '신경숙', '창비', 300, 2008),
  b(30, '살인자의 기억법', '김영하', '문학동네', 176, 2013),
  b(31, '지구 끝의 온실', '김초엽', '자이언트북스', 392, 2021),
  b(32, '달러구트 꿈 백화점', '이미예', '팩토리나인', 300, 2020),
  b(33, '아주 오랜만에 행복하다는 느낌', '백수린', '창비', 232, 2022),
  b(34, '여행의 이유', '김영하', '문학동네', 208, 2019),
  b(35, '소년이 온다', '한강', '창비', 216, 2014),
  b(36, '어린이라는 세계', '김소영', '사계절', 264, 2020),
]

/** ============ 분류 (국중 KDC 2단계 기준) — books.categories 정제 결과의 mock ============ */
const CATEGORY: Record<number, string> = {
  1: '문학 > 독일문학', 2: '문학 > 독일문학', 3: '문학 > 영미문학', 4: '문학 > 독일문학',
  5: '문학 > 프랑스문학', 6: '문학 > 한국소설', 7: '문학 > 독일문학', 8: '문학 > 프랑스문학',
  9: '문학 > 영미문학', 10: '문학 > 일본문학', 11: '문학 > 한국소설', 12: '문학 > 한국소설',
  13: '문학 > 브라질문학', 14: '문학 > 한국소설', 15: '역사 > 인류사', 16: '과학 > 천문학',
  17: '문학 > 한국소설', 18: '문학 > 영미문학', 19: '문학 > 영미문학', 20: '문학 > 러시아문학',
  21: '역사 > 인류사', 22: '과학 > 생물학', 23: '인문 > 철학', 24: '문학 > 일본문학',
  25: '문학 > 일본문학', 26: '문학 > 한국소설', 27: '문학 > 한국소설', 28: '문학 > 한국소설',
  29: '문학 > 한국소설', 30: '문학 > 한국소설', 31: '문학 > 한국소설', 32: '문학 > 한국소설',
  33: '문학 > 에세이', 34: '문학 > 에세이', 35: '문학 > 한국소설', 36: '문학 > 에세이',
}
/** 표지 URL — 카카오 책 검색 API로 확보한 실제 썸네일 (핫링크, 실 데이터 합류 시 books.coverImageUrl로 교체) */
const COVER: Record<number, string> = {
  1: 'https://image.aladin.co.kr/product/29/21/cover500/s172933259_1.jpg',
  2: 'https://image.aladin.co.kr/product/67/6/cover500/8931005423_2.jpg',
  3: 'https://image.aladin.co.kr/product/30882/22/cover500/8937460475_2.jpg',
  4: 'https://image.aladin.co.kr/product/57/72/cover500/8954600204_1.jpg',
  5: 'https://image.aladin.co.kr/product/21224/66/cover500/8937443848_1.jpg',
  6: 'https://image.aladin.co.kr/product/10636/66/cover500/8936456784_1.jpg',
  7: 'https://image.aladin.co.kr/product/26/0/cover500/s452139198_1.jpg',
  8: 'https://image.aladin.co.kr/product/6853/49/cover500/8932917248_2.jpg',
  9: 'https://image.aladin.co.kr/product/41/89/cover500/s122531356_2.jpg',
  10: 'https://image.aladin.co.kr/product/11561/49/cover500/8937434482_1.jpg',
  11: 'https://image.aladin.co.kr/product/100/1/cover500/8936433598_2.jpg',
  12: 'https://image.aladin.co.kr/product/29045/74/cover500/k192836746_2.jpg',
  13: 'https://image.aladin.co.kr/product/30/73/cover500/8982814477_3.jpg',
  14: 'https://image.aladin.co.kr/product/2584/37/cover500/8998441012_3.jpg',
  15: 'https://image.aladin.co.kr/product/31424/4/cover500/k482832219_1.jpg',
  16: 'https://image.aladin.co.kr/product/54/7/cover500/898371154x_2.jpg',
  17: 'https://image.aladin.co.kr/product/9476/48/cover500/8937473135_1.jpg',
  18: 'https://image.aladin.co.kr/product/41/79/cover500/s582934787_1.jpg',
  19: 'https://image.aladin.co.kr/product/43/68/cover500/s937460882_1.jpg',
  20: 'https://image.aladin.co.kr/product/1621/17/cover500/8937462842_3.jpg',
  21: 'https://image.aladin.co.kr/product/61/50/cover500/8970127240_2.jpg',
  22: 'https://image.aladin.co.kr/product/17048/25/cover500/8932473900_1.jpg',
  23: 'https://image.aladin.co.kr/product/4898/84/cover500/s812035947_1.jpg',
  24: 'https://image.aladin.co.kr/product/2175/33/cover500/s842635620_1.jpg',
  25: 'https://image.aladin.co.kr/product/42/41/cover500/8970124993_2.jpg',
  26: 'https://image.aladin.co.kr/product/39759/19/cover500/k692130905_1.jpg',
  27: 'https://image.aladin.co.kr/product/24131/37/cover500/s962738283_1.jpg',
  28: 'https://image.aladin.co.kr/product/183/68/cover500/k642831423_3.jpg',
  29: 'https://image.aladin.co.kr/product/272/78/cover500/8936433679_2.jpg',
  30: 'https://image.aladin.co.kr/product/2859/65/cover500/s702531649_2.jpg',
  31: 'https://image.aladin.co.kr/product/27692/63/cover500/s222930473_1.jpg',
  32: 'https://image.aladin.co.kr/product/24512/70/cover500/k392630952_3.jpg',
  33: 'https://image.aladin.co.kr/product/30276/23/cover500/8936438867_1.jpg',
  34: 'https://image.aladin.co.kr/product/18827/60/cover500/8954655971_3.jpg',
  35: 'https://image.aladin.co.kr/product/23940/2/cover500/8936434411_1.jpg',
  36: 'https://image.aladin.co.kr/product/25509/75/cover500/k132633125_2.jpg',
}
const withCategory = (bk: BookSummary): BookSummary =>
  ({ ...bk, category: CATEGORY[bk.bookId] ?? null, coverUrl: COVER[bk.bookId] ?? null })

const fs = (taste: number | null, coLoan: number | null, trending: number | null, steady: number | null, newField: number | null): FeatureScore[] => [
  { key: 'taste', rawScore: taste },
  { key: 'coLoan', rawScore: coLoan },
  { key: 'trending', rawScore: trending },
  { key: 'steady', rawScore: steady },
  { key: 'newField', rawScore: newField },
]

/** ============ 추천 — 해시태그 설명 + feature 가중치 (하이브리드) ============ */
/** 11위 이하 — 궤도 홈이 링을 표지로 채우려면 덱이 두꺼워야 해서 붙인 꼬리.
 *  실제 추천 덱 크기는 백엔드 계약에서 확정한다 (24권은 시안용 mock 값). */
const TAIL: { i: number; tags: string[]; reason: string }[] = [
  { i: 16, tags: ['#소설', '#내또래인기'], reason: '내 또래가 가장 많이 완독한 한국소설이에요.' },
  { i: 17, tags: ['#스테디셀러', '#내취향근접'], reason: '완독한 영미문학과 시대·화법이 겹쳐요.' },
  { i: 18, tags: ['#스테디셀러', '#소설'], reason: '고전 소설 취향이 그대로 이어지는 책이에요.' },
  { i: 19, tags: ['#내취향근접', '#소설'], reason: '『이방인』에 반응한 독자가 다음으로 많이 집어요.' },
  { i: 20, tags: ['#새로운분야', '#스테디셀러'], reason: '『사피엔스』와 같은 결의 인류사 책이에요.' },
  { i: 21, tags: ['#과학', '#새로운분야'], reason: '문학에서 과학으로 넘어갈 때 가장 많이 고르는 책이에요.' },
  { i: 22, tags: ['#새로운분야', '#베스트셀러'], reason: '서재에 인문이 비어 있어 한 권 얹었어요.' },
  { i: 23, tags: ['#소설', '#짧은호흡'], reason: '가볍게 읽히는 일본소설이에요.' },
  { i: 24, tags: ['#같은작가', '#내취향근접'], reason: '『노르웨이의 숲』과 같은 작가의 다른 결이에요.' },
  { i: 25, tags: ['#추리', '#소설'], reason: '읽는 중인 한국소설과 호흡이 비슷해요.' },
  { i: 26, tags: ['#소설', '#지금뜨는'], reason: '최근 3개월 대출이 가장 빠르게 늘고 있어요.' },
  { i: 27, tags: ['#성장', '#짧은호흡'], reason: '『아몬드』에 5점을 준 취향의 성장 서사예요.' },
  { i: 28, tags: ['#소설', '#스테디셀러'], reason: '완독한 한국소설들과 정서가 가까워요.' },
  { i: 29, tags: ['#추리', '#짧은호흡'], reason: '176쪽, 한 자리에서 끝낼 수 있어요.' },
  { i: 30, tags: ['#판타지', '#지금뜨는'], reason: '서재에 없는 SF인데 또래에서 가장 많이 읽혀요.' },
  { i: 31, tags: ['#판타지', '#베스트셀러'], reason: '가볍게 읽히는 판타지 베스트셀러예요.' },
  { i: 32, tags: ['#에세이', '#짧은호흡'], reason: '서재에 에세이가 없어 짧은 것부터 골랐어요.' },
  { i: 33, tags: ['#에세이', '#같은작가'], reason: '『살인자의 기억법』 작가의 산문이에요.' },
  { i: 34, tags: ['#같은작가', '#내취향근접'], reason: '『채식주의자』와 같은 작가의 다른 결이에요.' },
  { i: 35, tags: ['#에세이', '#새로운분야'], reason: '소설에 치우친 서재에 다른 결을 하나 얹었어요.' },
]

const recommendations: RecommendationResponse = {
  recommendationId: 'rec-mock-001',
  generatedAt: new Date().toISOString(),
  mode: 'PERSONALIZED',
  fallback: false,
  basedOnCount: 4,
  weights: { taste: 60, coLoan: 0, trending: 15, steady: 10, newField: 15 },
  appliedTags: [],
  items: [
    { rank: 1, book: withCategory(CATALOG[0]), score: 91.2, featureScores: fs(94, null, 72, 61, 25), tags: ['#내취향근접', '#함께대출'], reasonType: 'TEXT_SIMILARITY',
      reasonText: '최근 높은 별점을 준 3권과 주제가 가까우면서, 그 책들을 빌린 사람들이 함께 많이 빌린 책입니다.' },
    { rank: 2, book: withCategory(CATALOG[1]), score: 87.6, featureScores: fs(88, null, 43, 91, 20), tags: ['#같은작가', '#스테디셀러'], reasonType: 'SAME_AUTHOR',
      reasonText: '선호하는 작가의 다른 작품이에요.' },
    { rank: 3, book: withCategory(CATALOG[2]), score: 82.4, featureScores: fs(80, 76, 38, 89, 15), tags: ['#함께대출', '#스테디셀러'], reasonType: 'DEMAND_POPULAR',
      reasonText: '『데미안』을 빌린 사람들이 함께 많이 빌린 책이에요.' },
    { rank: 4, book: withCategory(CATALOG[3]), score: 79.8, featureScores: fs(81, null, 30, 68, 35), tags: ['#내취향근접', '#짧은호흡'], reasonType: 'TEXT_SIMILARITY',
      reasonText: '최근 읽은 책들과 서사 결이 비슷해요.' },
    { rank: 5, book: withCategory(CATALOG[4]), score: 76.1, featureScores: fs(76, null, 35, 86, 10), tags: ['#스테디셀러', '#베스트셀러'], reasonType: 'TEXT_SIMILARITY',
      reasonText: '완독한 책들과 주제 키워드가 겹쳐요.' },
    { rank: 6, book: withCategory(CATALOG[5]), score: 72.3, featureScores: fs(68, 42, 88, 55, 45), tags: ['#지금뜨는', '#내또래인기'], reasonType: 'MOMENTUM',
      reasonText: '내 또래가 이 책과 함께 많이 빌렸어요.' },
    { rank: 7, book: withCategory(CATALOG[12]), score: 70.5, featureScores: fs(72, null, 41, 84, 22), tags: ['#스테디셀러', '#짧은호흡'], reasonType: 'TEXT_SIMILARITY',
      reasonText: '『데미안』에 5점을 준 취향과 성장 서사가 겹쳐요.' },
    { rank: 8, book: withCategory(CATALOG[13]), score: 68.9, featureScores: fs(70, 55, 33, 77, 28), tags: ['#소설', '#내취향근접'], reasonType: 'TEXT_SIMILARITY',
      reasonText: '완독한 한국소설 2권과 화자의 목소리가 비슷해요.' },
    { rank: 9, book: withCategory(CATALOG[14]), score: 64.2, featureScores: fs(38, null, 66, 80, 92), tags: ['#새로운분야', '#베스트셀러'], reasonType: 'NEW_BOOK',
      reasonText: '서재가 문학에 몰려 있어, 한 발 밖의 책을 하나 얹었어요.' },
    { rank: 10, book: withCategory(CATALOG[15]), score: 61.7, featureScores: fs(35, null, 29, 95, 88), tags: ['#새로운분야', '#스테디셀러'], reasonType: 'NEW_BOOK',
      reasonText: '『코스모스』는 문학 독자가 가장 많이 넘어가는 과학책이에요.' },
    ...TAIL.map((f, k) => ({
      rank: 11 + k,
      book: withCategory(CATALOG[f.i]),
      score: +(59.8 - k * 1.6).toFixed(1),
      featureScores: fs(58 - k, null, 38, 66, 24),
      tags: f.tags,
      reasonType: 'TEXT_SIMILARITY' as const,
      reasonText: f.reason,
    })),
  ],
}

/** ============ 서재 (in-memory — 세션 동안 상태 유지) ============ */
let nextLibraryId = 9
const library: LibraryItem[] = [
  { libraryItemId: 1, book: CATALOG[6], status: 'READ', rating: 4, reviewText: '어른이 되기 전에 읽었어야 했다.', finishedDate: '2026-08-20' },
  { libraryItemId: 2, book: CATALOG[9], status: 'READ', rating: null, reviewText: null, finishedDate: '2026-07-19' },
  { libraryItemId: 3, book: CATALOG[10], status: 'READ', rating: 5, reviewText: null, finishedDate: '2026-08-27' },
  { libraryItemId: 4, book: CATALOG[11], status: 'READ', rating: 3, reviewText: '가볍게 잘 읽힘', finishedDate: '2026-06-11' },
  { libraryItemId: 5, book: CATALOG[8], status: 'READ', rating: 5, reviewText: null, finishedDate: '2026-05-02' },
  { libraryItemId: 6, book: CATALOG[7], status: 'WISH', rating: null, reviewText: null, finishedDate: null },
  { libraryItemId: 7, book: CATALOG[4], status: 'WISH', rating: null, reviewText: null, finishedDate: null },
  { libraryItemId: 8, book: CATALOG[0], status: 'WISH', rating: null, reviewText: null, finishedDate: null },
]

/** ============ 핸들러 ============ */
const requireAuth = (request: Request) =>
  request.headers.get('authorization')?.startsWith('Bearer ')
    ? null
    : HttpResponse.json({ message: '로그인이 필요합니다.' }, { status: 401 })

export const handlers = [
  // 인증 — mock: OAuth authorize 응답으로 callback 이후 상태를 대신한다 (dev 이어진님 구조 채택).
  // 시연 분기: 카카오=신규(온보딩행, 닉네임은 Step 0에서 입력), 구글=기존 회원(홈 직행)
  http.get('*/auth/oauth/:provider/authorize', ({ params }) => {
    const provider = String(params.provider).toUpperCase()
    if (provider !== 'KAKAO' && provider !== 'GOOGLE') {
      return HttpResponse.json({ message: '지원하지 않는 OAuth provider입니다.' }, { status: 400 })
    }
    return provider === 'GOOGLE'
      ? HttpResponse.json({ accessToken: 'mock-token', nickname: 'Google 독자', onboarded: true })
      : HttpResponse.json({ accessToken: 'mock-token', nickname: null, onboarded: false })
  }),

  // 온보딩 — Step 0 프로필(닉네임·생년월일·성별), Step 1~2 취향
  http.post('*/users/me/profile', () => new HttpResponse(null, { status: 204 })),
  http.get('*/books/popular', () => HttpResponse.json({ items: CATALOG.slice(4, 12) })), // 세그먼트 인기 (온보딩 그리드용)
  // 온보딩 취향 제출 — 읽은 책은 서재의 완독 기록이 된다 (finished_at NULL = 서비스 이전에 읽음).
  // genres → user_interests 저장은 서버 몫이고, mock에서는 아직 읽는 화면이 없어 보관하지 않는다 (/tune 초기값은 P1).
  http.post('*/users/me/preferences', async ({ request }) => {
    const body = (await request.json()) as { genres: string[]; books: { bookId: number; rating: number }[] }
    for (const { bookId, rating } of body.books) {
      const book = CATALOG.find((bk) => bk.bookId === bookId)
      if (!book) continue
      const existing = library.find((li) => li.book.bookId === bookId)
      if (existing) {
        // 이미 서재에 있으면(찜 등) 완독으로 승격만 — 중복 행을 만들지 않는다
        existing.status = 'READ'
        existing.rating = rating
        continue
      }
      library.unshift({ libraryItemId: nextLibraryId++, book, status: 'READ', rating, reviewText: null, finishedDate: null })
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // 검색
  http.get('*/books/search', ({ request }) => {
    const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
    const items = q.length < 1 ? [] : CATALOG.filter((bk) => bk.title.includes(q) || (bk.author ?? '').includes(q))
    return HttpResponse.json({ total: items.length, page: 1, items } satisfies SearchResponse)
  }),

  // 로그인 사용자 추천·상세
  http.get('*/recommendations', ({ request }) => requireAuth(request) ?? HttpResponse.json(recommendations)),
  http.get('*/books/:id', ({ params }) => {
    const found = CATALOG.find((bk) => bk.bookId === Number(params.id)) ?? CATALOG[0]
    const mine = library.find((li) => li.book.bookId === found.bookId) // 계약 §6: 본인 상태 join
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
      myLibraryStatus: mine?.status ?? null,
      myRating: mine?.rating ?? null,
      myReviewText: mine?.reviewText ?? null,
    })
  }),

  // 서재 CRUD
  http.get('*/library/me', () =>
    HttpResponse.json({ items: library.map((li) => ({ ...li, book: withCategory(li.book) })) })),
  http.post('*/library', async ({ request }) => {
    const body = (await request.json()) as { bookId: number; status: ShelfStatus }
    const book = CATALOG.find((bk) => bk.bookId === body.bookId)
    if (!book) return new HttpResponse(null, { status: 404 })
    const existing = library.find((li) => li.book.bookId === body.bookId)
    if (existing) { existing.status = body.status } else {
      library.unshift({ libraryItemId: nextLibraryId++, book, status: body.status, rating: null, reviewText: null,
        finishedDate: body.status === 'READ' ? new Date().toISOString().slice(0, 10) : null })
    }
    return new HttpResponse(null, { status: 201 })
  }),
  http.patch('*/library/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<Pick<LibraryItem, 'status' | 'rating' | 'reviewText'>>
    const item = library.find((li) => li.libraryItemId === Number(params.id))
    if (!item) return new HttpResponse(null, { status: 404 })
    if (body.status) { item.status = body.status; item.finishedDate = body.status === 'READ' ? new Date().toISOString().slice(0, 10) : item.finishedDate }
    if (body.rating !== undefined) item.rating = body.rating
    if (body.reviewText !== undefined) item.reviewText = body.reviewText // 계약 §4.3: 빈 값 null 처리는 클라이언트에서 선반영
    return HttpResponse.json(item)
  }),

  // 이벤트 수집 — 로그인 상세 조회는 BOOK_VIEW, 찜은 WISH로 기록한다.
  http.post('*/events', () => new HttpResponse(null, { status: 202 })),
]
