import { http, HttpResponse } from 'msw'
import type { BookSummary, FeatureScore, LibraryItem, RecommendationResponse, ServerBookSummary, ServerSearchResponse, ShelfStatus } from '../api/types'

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
/** 화면 BookSummary → 서버 BookSummary(§1.5) 모양. 서버가 주는 그대로를 흉내 내는 핸들러(검색·함께대출)가 쓴다 */
const toServerBook = (bk: BookSummary): ServerBookSummary => ({
  bookId: String(bk.bookId), isbn13: null, title: bk.title, authors: bk.author ? [bk.author] : [], publisher: bk.publisher,
  publicationYear: bk.publicationYear, coverUrl: bk.coverUrl, pageCount: bk.pageCount, category: bk.category ?? null, classNo: null,
})

const withCategory = (bk: BookSummary): BookSummary =>
  // 정적 맵에 없는 책(세그먼트 인기에서 편입된 책)은 자기 값을 그대로 유지한다
  ({ ...bk, category: CATEGORY[bk.bookId] ?? bk.category ?? null, coverUrl: COVER[bk.bookId] ?? bk.coverUrl ?? null })

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
/** 서버는 Asia/Seoul 기준 오늘(§6.2) — mock 은 브라우저 로컬 날짜로 대신한다 */
const today = () => new Date().toLocaleDateString('sv-SE')
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

/** mock 사용자 상태 — 실서버의 users 행에 해당. authorize/profile/preferences가 갱신하고 GET /users/me가 읽는다 */
const me = { userId: '1', nickname: null as string | null, onboardingStatus: 'PENDING' as 'PENDING' | 'COMPLETED' | 'SKIPPED', interestTags: [] as string[], birthYear: null as number | null, gender: null as string | null }

/** ---- 세그먼트 인기 (온보딩 그리드, §4.2) ----
 *  실측 수집분 popular-ring.json(10세그먼트×20권)을 재료로 프로필의 연령·성별에 맞는 top을 준다.
 *  연령+성별 → 해당 세그먼트 / 연령만 → 그 연령대 남녀 합산 재랭킹 / 그 외 → 전 세그먼트 합산.
 *  실서버에서는 book_loaned_top20 테이블이 같은 역할을 한다. */
interface RingBook { title: string; author: string; publisher: string; publicationYear: string; isbn13: string; loanCount: number; classNo: string; coverUrl: string | null }
interface RingSegment { age: string; gender: '남' | '여'; label: string; items: RingBook[] }

let ringCache: RingSegment[] | null = null
async function loadRing(): Promise<RingSegment[]> {
  if (ringCache) return ringCache
  const res = await fetch('/data/popular-ring.json') // 정적 파일 — 핸들러가 없어 네트워크로 통과된다
  ringCache = ((await res.json()) as { segments: RingSegment[] }).segments
  return ringCache
}

/** KDC → 서재 선반이 쓰는 분류 경로 근사 */
const ringCategory = (classNo: string) => {
  if (classNo.startsWith('813')) return '문학 > 한국소설'
  if (classNo.startsWith('833')) return '문학 > 일본문학'
  if (classNo.startsWith('818') || classNo.startsWith('814')) return '문학 > 에세이'
  return { '1': '인문 > 철학', '3': '사회 > 사회과학', '4': '과학 > 자연과학', '5': '기술 > 기술과학', '8': '문학 > 문학', '9': '역사 > 역사' }[classNo[0] ?? ''] ?? '기타'
}

/** ring 도서를 CATALOG에 편입해 bookId를 부여한다 — 온보딩에서 고른 책이 서재·상세에서도 이어지게 */
const ringIds = new Map<string, number>()
let nextRingId = 1001
function toSummary(b: RingBook): BookSummary {
  let id = ringIds.get(b.isbn13)
  if (id == null) {
    id = nextRingId++
    ringIds.set(b.isbn13, id)
    CATALOG.push({ bookId: id, title: b.title, author: b.author, publisher: b.publisher, coverUrl: b.coverUrl,
      pageCount: null, publicationYear: Number(b.publicationYear) || null, category: ringCategory(b.classNo) })
  }
  return CATALOG.find((c) => c.bookId === id)!
}

/** 여러 세그먼트의 loanCount 합산 재랭킹 — 같은 책이 양쪽에 있으면 자연히 올라온다 */
function topAcross(segs: RingSegment[], size: number): BookSummary[] {
  const acc = new Map<string, { b: RingBook; loan: number }>()
  for (const s of segs) for (const it of s.items) {
    const cur = acc.get(it.isbn13)
    if (cur) cur.loan += it.loanCount
    else acc.set(it.isbn13, { b: it, loan: it.loanCount })
  }
  return [...acc.values()].sort((x, y) => y.loan - x.loan).slice(0, size).map((v) => toSummary(v.b))
}

/** 태그 사전 — 실서버 V1_1__seed_tags.sql과 같은 12개. 목록의 주인은 DB, 여기는 사본 */
const TAGS = [
  ['FICTION', '#소설'], ['ESSAY', '#에세이'], ['HUMANITIES', '#인문'], ['HISTORY', '#역사'],
  ['SCIENCE', '#과학'], ['ART', '#예술'], ['SELF_HELP', '#자기계발'], ['BUSINESS', '#경제·경영'],
  ['SOCIETY', '#사회'], ['POETRY', '#시'], ['TRAVEL', '#여행'], ['TECH', '#기술·IT'],
].map(([code, label]) => ({ code, label, kind: 'GENRE' as const, selectable: true }))

export const handlers = [
  // 태그 사전 — 온보딩 장르 칩·(추후) /tune 해시태그의 단일 원천
  // §4.7 분류 사전 — 문학(8) 가지만 채운 mock. depth·parent 둘 다 오면 400, 모르는 parent 는 items: [] (서버와 같다)
  http.get('*/kdc', ({ request }) => {
    const url = new URL(request.url)
    const depth = url.searchParams.get('depth')
    const parent = url.searchParams.get('parent')
    if (depth && parent) return HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'depth 와 parent 는 함께 쓸 수 없습니다.' }, { status: 400 })
    const row = (code: string, label: string) => ({ code, label, depth: code.length, parentCode: code.length > 1 ? code.slice(0, -1) : null })
    const MAIN = [['0', '총류'], ['1', '철학'], ['2', '종교'], ['3', '사회과학'], ['4', '자연과학'], ['5', '기술과학'], ['6', '예술'], ['7', '언어'], ['8', '문학'], ['9', '역사']]
    const CHILDREN: Record<string, [string, string][]> = {
      '8': [['80', '문학'], ['81', '한국문학'], ['82', '중국문학'], ['83', '일본문학'], ['84', '영미문학'], ['85', '독일문학'], ['86', '프랑스문학'], ['87', '스페인·포르투갈문학'], ['88', '이탈리아문학'], ['89', '기타 문학']],
      '81': [['810', '한국문학'], ['811', '시'], ['812', '희곡'], ['813', '소설'], ['814', '수필'], ['815', '연설·웅변'], ['816', '일기·서간·기행'], ['817', '풍자·유머'], ['818', '르포르타주']],
    }
    if (depth === '1' || (!depth && !parent)) return HttpResponse.json({ items: MAIN.map(([c, l]) => row(c, l)) })
    if (parent) return HttpResponse.json({ items: (CHILDREN[parent] ?? []).map(([c, l]) => row(c, l)) })
    return HttpResponse.json({ items: [] })
  }),

  http.get('*/tags', ({ request }) => {
    const kind = new URL(request.url).searchParams.get('kind')
    return HttpResponse.json({ items: kind ? TAGS.filter((t) => t.kind === kind) : TAGS })
  }),

  // 인증 — mock: OAuth authorize 응답으로 callback 이후 상태를 대신한다 (dev 이어진님 구조 채택).
  // 시연 분기: 카카오=신규(온보딩행, 닉네임은 Step 0에서 입력), 구글=기존 회원(홈 직행)
  http.get('*/auth/oauth/:provider/authorize', ({ params }) => {
    const provider = String(params.provider).toUpperCase()
    if (provider !== 'KAKAO' && provider !== 'GOOGLE') {
      return HttpResponse.json({ message: '지원하지 않는 OAuth provider입니다.' }, { status: 400 })
    }
    if (provider === 'GOOGLE') {
      Object.assign(me, { nickname: 'Google 독자', onboardingStatus: 'COMPLETED' })
      return HttpResponse.json({ accessToken: 'mock-token', nickname: me.nickname, onboarded: true })
    }
    Object.assign(me, { nickname: null, onboardingStatus: 'PENDING' })
    return HttpResponse.json({ accessToken: 'mock-token', nickname: null, onboarded: false })
  }),

  // 내 정보 — 실서버 응답 모양(§3.1): userId 문자열, onboardingStatus enum. onboarded 판정은 FE가 != PENDING 으로
  http.get('*/users/me', ({ request }) => requireAuth(request) ?? HttpResponse.json({ ...me })),

  // 온보딩 — Step 0 프로필(닉네임·생년월일·성별), Step 1~2 취향
  http.post('*/users/me/profile', async ({ request }) => {
    const body = (await request.json()) as { nickname: string; birthYear: number | null; gender: string | null }
    Object.assign(me, { nickname: body.nickname, birthYear: body.birthYear ?? null, gender: body.gender ?? null })
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('*/books/popular', async ({ request }) => {
    const size = Math.min(40, Number(new URL(request.url).searchParams.get('size') ?? 12))
    const segs = await loadRing()
    const decade = me.birthYear ? Math.min(50, Math.max(10, Math.floor((new Date().getFullYear() - me.birthYear) / 10) * 10)) : null
    const ringGender = me.gender === 'F' ? '여' : me.gender === 'M' ? '남' : null

    if (decade != null && ringGender) {
      const seg = segs.find((s) => s.age.replace(/\D/g, '') === String(decade) && s.gender === ringGender)
      if (seg) return HttpResponse.json({ segment: { age: String(decade), gender: me.gender, label: seg.label }, items: seg.items.slice(0, size).map(toSummary) })
    }
    if (decade != null) {
      const pair = segs.filter((s) => s.age.replace(/\D/g, '') === String(decade))
      if (pair.length) return HttpResponse.json({ segment: { age: String(decade), gender: null, label: `${decade}대` }, items: topAcross(pair, size) })
    }
    return HttpResponse.json({ segment: null, items: topAcross(segs, size) })
  }),
  // 온보딩 취향 제출 — 읽은 책은 서재의 완독 기록이 된다 (finished_at NULL = 서비스 이전에 읽음).
  // genres → user_interests 저장은 서버 몫이고, mock에서는 아직 읽는 화면이 없어 보관하지 않는다 (/tune 초기값은 P1).
  http.post('*/users/me/preferences', async ({ request }) => {
    const body = (await request.json()) as { genres: string[]; books: { bookId: number; rating: number }[] }
    Object.assign(me, { onboardingStatus: 'COMPLETED', interestTags: body.genres ?? [] })
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

  // 검색 — 실서버 응답 형태(§4.1: bookId 문자열·authors 배열·size)로 돌려준다. 화면 타입으로의 변환은 api/books.ts 가 맡는다
  http.get('*/books/search', ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const kdc = url.searchParams.get('kdc') ?? ''
    const page = Number(url.searchParams.get('page') ?? 0)
    const size = Math.min(50, Number(url.searchParams.get('size') ?? 20))
    if (!q && !kdc) return HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'q 또는 kdc 가 필요합니다.' }, { status: 400 })
    // mock 카탈로그엔 KDC 코드가 없어 대분류 라벨로 대신 거른다(§4.1 kdc prefix 의 1자리만 흉내). 서버는 books.category_code prefix
    const KDC_LABEL: Record<string, string> = { '1': '인문', '3': '사회', '4': '과학', '8': '문학', '9': '역사' }
    // 중분류(2자리)는 category 의 두 번째 마디로 흉내낸다 — "문학 > 독일문학" 에 '독일' 이 있으면 85. 3자리는 2자리처럼 본다
    const MID_LABEL: Record<string, string> = { '81': '한국', '82': '중국', '83': '일본', '84': '영미', '85': '독일', '86': '프랑스' }
    const kdcLabel = KDC_LABEL[kdc[0]]
    const midLabel = kdc.length >= 2 ? MID_LABEL[kdc.slice(0, 2)] : undefined
    const hits = CATALOG.map(withCategory)
      .filter((bk) => !q || bk.title.includes(q) || (bk.author ?? '').includes(q))
      .filter((bk) => !kdc || (kdcLabel ? (bk.category ?? '').startsWith(kdcLabel) : false))
      .filter((bk) => !midLabel || (bk.category ?? '').includes(midLabel))
    const items: ServerBookSummary[] = hits.slice(page * size, page * size + size).map(toServerBook)
    return HttpResponse.json({ total: hits.length, page, size, items } satisfies ServerSearchResponse)
  }),

  // 로그인 사용자 추천·상세
  http.get('*/recommendations', ({ request }) => requireAuth(request) ?? HttpResponse.json(recommendations)),
  http.get('*/books/:id', ({ params }) => {
    // withCategory로 감싸야 상세도 목록·서재와 같은 표지·분류를 준다 (CATALOG를 그대로 쓰면 coverUrl이 null이다)
    const found = withCategory(CATALOG.find((bk) => bk.bookId === Number(params.id)) ?? CATALOG[0])
    const mine = library.find((li) => li.book.bookId === found.bookId) // 계약 §6: 본인 상태 join
    return HttpResponse.json({
      // 체크디짓이 맞는 미배정 ISBN — 도서 카드 시안이 이 값을 EAN-13 바코드로 실제 인코딩한다
      ...found, isbn13: '9791100000007',
      description: '자기 자신을 잃어버린 채 어른들의 기대 속에서 소진되어 가는 한 소년의 이야기. 성장과 자아 탐색이라는 주제를 정면으로 다룬다.',
      toc: '1부\n2부\n3부',
      /** 시안용 — 'AI 추천 키워드'. 계약에 아직 없다 (docs/BACKEND_DATA_CONTRACT.md 합의 대기) */
      keywords: ['#성장소설', '#청소년의 고민', '#자기 탐색', '#고전의 힘', '#짧은 호흡'],
      metrics: [
        { source: '정보나루', name: '전국 대출 순위', value: '상위 3%', asOf: '2026-06' },
        { source: '알라딘', name: '평균 별점', value: '4.2 · 128명', asOf: '2026-08' },
      ],
      loanByAge: [
        { ageGroup: '10대', ratio: 8 }, { ageGroup: '20대', ratio: 34 }, { ageGroup: '30대', ratio: 38 },
        { ageGroup: '40대', ratio: 14 }, { ageGroup: '50대+', ratio: 6 },
      ],
      // 계약 §4.4 `my` — libraryItemId 를 함께 주어 상세에서 바로 PATCH 할 수 있게 한다
      my: mine
        ? { libraryItemId: String(mine.libraryItemId), status: mine.status, rating: mine.rating, reviewText: mine.reviewText, finishedDate: mine.finishedDate }
        : null,
    })
  }),

  /** 시안용 — 비슷한 책(소개 임베딩) · 함께 대출된 책(정보나루). 둘 다 계약에 없는 임시 경로다.
   *  무작위를 쓰지 않는다: 같은 책을 새로 열어도 같은 목록이 나와야 시안을 비교할 수 있다. */
  http.get('*/books/:id/similar', ({ params }) => {
    const self = CATALOG.find((bk) => bk.bookId === Number(params.id)) ?? CATALOG[0]
    // 같은 저자 → 같은 분류 → 나머지 순
    const rank = (bk: BookSummary) =>
      (bk.author === self.author ? 0 : 2) + (CATEGORY[bk.bookId] === CATEGORY[self.bookId] ? 0 : 1)
    const items = CATALOG.filter((bk) => bk.bookId !== self.bookId)
      .sort((a, z) => rank(a) - rank(z) || a.bookId - z.bookId)
      .slice(0, 4).map(withCategory)
    return HttpResponse.json({ items })
  }),
  http.get('*/books/:id/co-loans', ({ params }) => {
    const self = Number(params.id)
    // 함께 대출은 취향이 아니라 '같이 빌려 간' 신호다 — 저자·분류를 맞추지 않고 덱에서 고른다
    const pool = CATALOG.filter((bk) => bk.bookId !== self)
    const start = (self * 7) % Math.max(pool.length - 4, 1)
    // 서버 모양(§4.6): {book, rank} + 출처·기준월
    const items = pool.slice(start, start + 4).map((bk, i) => ({ book: toServerBook(withCategory(bk)), rank: i + 1 }))
    return HttpResponse.json({ items, source: 'DATA4LIBRARY', asOf: '2026-08' })
  }),

  // 서재 CRUD
  // §6.1 — status 없으면 전체, 있으면 그 상태만. 정렬은 updatedAt desc (mock 은 담은 순서 = unshift 순서로 대신한다)
  http.get('*/library/me', ({ request }) => {
    const status = new URL(request.url).searchParams.get('status')?.toUpperCase()
    const items = library.filter((li) => !status || li.status === status).map((li) => ({ ...li, book: withCategory(li.book) }))
    return HttpResponse.json({ items })
  }),
  // §6.2 — 본문은 bookId(문자열)·status 두 필드. 이미 있으면 409 + details.libraryItemId (프론트가 그 id 로 PATCH 한다)
  http.post('*/library', async ({ request }) => {
    const body = (await request.json()) as { bookId: string | number; status: ShelfStatus }
    const bookId = Number(body.bookId)
    const book = CATALOG.find((bk) => bk.bookId === bookId)
    if (!book) return HttpResponse.json({ code: 'BOOK_NOT_FOUND', message: '책을 찾을 수 없습니다.' }, { status: 404 })
    const existing = library.find((li) => li.book.bookId === bookId)
    if (existing) {
      return HttpResponse.json(
        { code: 'LIBRARY_ITEM_EXISTS', message: '이미 서재에 있는 책입니다.', details: { libraryItemId: String(existing.libraryItemId) } },
        { status: 409 },
      )
    }
    const item: LibraryItem = { libraryItemId: nextLibraryId++, book: withCategory(book), status: body.status, rating: null, reviewText: null,
      finishedDate: body.status === 'READ' ? today() : null }
    library.unshift(item)
    return HttpResponse.json(item, { status: 201 })
  }),
  // §6.3 — 보낸 필드만 갱신. READ 전환에 날짜 없으면 오늘, WISH 전환은 완독일 비움(별점·감상 보존), READ 재전송은 멱등
  http.patch('*/library/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<Pick<LibraryItem, 'status' | 'rating' | 'reviewText' | 'finishedDate'>>
    const item = library.find((li) => li.libraryItemId === Number(params.id))
    if (!item) return HttpResponse.json({ code: 'LIBRARY_ITEM_NOT_FOUND', message: '서재 항목이 없습니다.', details: { libraryItemId: params.id } }, { status: 404 })
    if (body.status === 'READ' && item.status !== 'READ') item.finishedDate = body.finishedDate ?? today()
    else if (body.status === 'WISH') item.finishedDate = null
    else if (body.finishedDate !== undefined && item.status === 'READ') item.finishedDate = body.finishedDate
    if (body.status) item.status = body.status
    if (body.rating !== undefined) item.rating = body.rating
    if (body.reviewText !== undefined) item.reviewText = body.reviewText?.trim() || null
    return HttpResponse.json(item)
  }),
  // §6.4 — 204
  http.delete('*/library/:id', ({ params }) => {
    const idx = library.findIndex((li) => li.libraryItemId === Number(params.id))
    if (idx < 0) return HttpResponse.json({ code: 'LIBRARY_ITEM_NOT_FOUND', message: '서재 항목이 없습니다.', details: { libraryItemId: params.id } }, { status: 404 })
    library.splice(idx, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  // 이벤트 수집 — 로그인 상세 조회는 BOOK_VIEW, 찜은 WISH로 기록한다.
  http.post('*/events', () => new HttpResponse(null, { status: 202 })),
]
