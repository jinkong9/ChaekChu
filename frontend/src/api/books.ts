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

/** GET /books/search (§4.1) — q 1~100자, page 0부터, size 1~50(기본 20).
 *  q 가 ISBN 형태(하이픈 무시 13자리)면 서버가 정확 조회로 처리해 0~1건을 준다. */
export async function searchBooks(q: string, page = 0, size = 20): Promise<SearchResponse> {
  const res = await api.get<ServerSearchResponse>('/books/search', { params: { q, page, size } })
  const { total, items } = res.data
  return { total, page: res.data.page, size: res.data.size, items: items.map(toBookSummary) }
}

/** 서버 오류 응답의 code (§1.3). 네트워크 오류·형식 밖이면 null. */
export function apiErrorCode(err: unknown): string | null {
  if (!isAxiosError(err)) return null
  const data = err.response?.data as { code?: unknown } | undefined
  return typeof data?.code === 'string' ? data.code : null
}

/** 503 SEARCH_UNAVAILABLE — 검색 엔진만 잠시 불가. 다른 기능은 정상이라 로그아웃·전역 오류로 번지지 않게 화면에서 안내만 한다. */
export const isSearchUnavailable = (err: unknown) => apiErrorCode(err) === 'SEARCH_UNAVAILABLE'
