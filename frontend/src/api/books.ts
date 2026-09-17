import { isAxiosError } from 'axios'
import { api } from './client'
import type { BookSummary, SearchResponse, ServerBookSummary, ServerSearchResponse } from './types'

/** 서버 BookSummary(§1.5) → 화면 BookSummary.
 *  bookId 문자열 → number (화면·mock 이 number 로 비교), authors[] → ' · ' 로 이은 한 줄 (화면은 한 줄로 그린다).
 *  화면 타입을 계약에 맞춰 바꾸는 별도 MR 이 끝나면 이 함수는 사라진다. */
export function toBookSummary(s: ServerBookSummary): BookSummary {
  return {
    bookId: Number(s.bookId),
    title: s.title,
    author: s.authors.length > 0 ? s.authors.join(' · ') : null,
    publisher: s.publisher,
    coverUrl: s.coverUrl,
    pageCount: s.pageCount,
    publicationYear: s.publicationYear,
    category: s.category,
  }
}

/** 검색 범위(§4.1 scope) — 검색어를 어느 필드에 대고 점수를 내는가.
 *  서버는 publisher 도 받지만 화면에는 내놓지 않는다(09-17 팀 결정) — 필요해지면 여기와 SCOPES 에 한 줄씩 더하면 된다. */
export type SearchScope = 'all' | 'title' | 'author'

/** GET /books/search (§4.1) — q 1~100자, page 0부터, size 1~50(기본 20). q·kdc 중 하나는 있어야 한다.
 *  kdc 는 KDC 코드 prefix(1~3자리) — 점수에 끼지 않는 filter 라 q 가 있으면 관련도 순 그대로, kdc 만이면 서버가 누적 대출순으로 준다.
 *  scope 는 검색 범위 — 'all'(기본)은 제목·저자·출판사를 함께 보고, 'title'·'author' 는 그 필드 하나만 본다.
 *    그래서 「한강 소년이 온다」처럼 저자+제목이 섞인 검색어는 좁힌 범위에서 안 잡힌다(서버 의도).
 *    기본값이라 all 은 아예 싣지 않는다 — 주소가 짧아지고, 서버 기본값과도 같다.
 *  q 가 ISBN 형태(하이픈 무시 13자리)면 서버가 정확 조회로 처리해 0~1건을 준다(그때 kdc·scope 는 무시).
 *  탐색 한도 10,000건 — page*size+size 가 넘으면 400 이라 화면이 쪽 번호를 그 안에서만 만든다. */
export async function searchBooks(q: string, page = 0, size = 20, kdc?: string, scope: SearchScope = 'all'): Promise<SearchResponse> {
  const params: Record<string, string | number> = { page, size }
  if (q) params.q = q
  if (kdc) params.kdc = kdc
  if (scope !== 'all') params.scope = scope
  const res = await api.get<ServerSearchResponse>('/books/search', { params })
  const { total, items } = res.data
  return { total, page: res.data.page, size: res.data.size, items: items.map(toBookSummary) }
}

/** GET /books/random (§4.8) — 가챠. 표지와 KDC 가 있는 추천 후보(약 44만) 중 무작위 한 권.
 *  봉투 없이 BookSummary 한 개가 온다. 화면 타입으로 줄이지 않고 서버 응답 그대로 받는다 —
 *  가챠는 classNo 로 취향 축을 대조하고 isbn13 으로 이미 읽은 책인지 본다.
 *
 *  @param exclude 직전에 뽑힌 bookId. 서버는 이력을 갖지 않으므로, 연속으로 같은 책이 나오는
 *                 아주 낮은 확률까지 0 으로 막고 싶은 화면이 직접 붙인다. */
export async function fetchRandomBook(exclude?: string): Promise<ServerBookSummary> {
  const res = await api.get<ServerBookSummary>('/books/random', { params: exclude ? { exclude } : undefined })
  return res.data
}

/** 404 BOOK_NOT_FOUND — 뽑을 후보가 없다. 운영에서는 나지 않고, 후보 배치를 안 돌린 로컬 DB 에서 난다 */
export const isBookNotFound = (err: unknown) => apiErrorCode(err) === 'BOOK_NOT_FOUND'

/** 서버 오류 응답의 code (§1.3). 네트워크 오류·형식 밖이면 null. */
export function apiErrorCode(err: unknown): string | null {
  if (!isAxiosError(err)) return null
  const data = err.response?.data as { code?: unknown } | undefined
  return typeof data?.code === 'string' ? data.code : null
}

/** 503 SEARCH_UNAVAILABLE — 검색 엔진만 잠시 불가. 다른 기능은 정상이라 로그아웃·전역 오류로 번지지 않게 화면에서 안내만 한다. */
export const isSearchUnavailable = (err: unknown) => apiErrorCode(err) === 'SEARCH_UNAVAILABLE'
