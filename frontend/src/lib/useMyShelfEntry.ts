/** 어떤 책이 내 서재에 어떻게 있는지 — 상세 화면의 `book.my`(§4.4)와 같은 모양으로.
 *
 *  상세는 서버가 `my` 를 같이 주지만, 가챠·월드컵처럼 책 하나를 다른 경로로 받은 화면은
 *  서재 목록(GET /library/me, ['library'])에서 찾아야 한다. 캐시 키가 LibraryPage 와 같아
 *  이미 서재를 다녀왔다면 요청이 다시 나가지 않고, 찜·완독 뒤 invalidate 도 한 곳으로 모인다. */
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, MyLibraryEntry } from '../api/types'

export function useMyShelfEntry(bookId: string | number | null | undefined): MyLibraryEntry | null {
  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
    enabled: bookId != null && bookId !== '',
  })
  if (bookId == null || !data) return null
  const li = data.find((x) => String(x.book.bookId) === String(bookId))
  if (!li) return null
  return {
    libraryItemId: String(li.libraryItemId),
    status: li.status,
    rating: li.rating,
    reviewText: li.reviewText,
    finishedDate: li.finishedDate,
  }
}
