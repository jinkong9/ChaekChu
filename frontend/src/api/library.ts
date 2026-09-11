import { isAxiosError } from 'axios'
import { api } from './client'
import type { ServerBookSummary, ShelfStatus } from './types'

/** 서버 LibraryItem (API_SPEC §6) — id 는 문자열, book 은 서버 BookSummary 그대로.
 *  화면 타입(LibraryItem: number id · author 한 줄)으로의 변환은 string id rename MR 에서 함께 정리한다. */
export interface ServerLibraryItem {
  libraryItemId: string
  book: ServerBookSummary
  status: ShelfStatus
  rating: number | null
  reviewText: string | null
  finishedDate: string | null
  createdAt: string
  updatedAt: string
}

/** PATCH 본문 (§6.3) — 보낸 필드만 바뀐다. null 은 '지우기'(rating·reviewText·READ 의 finishedDate), undefined 는 '건드리지 않음'.
 *  axios 는 undefined 필드를 JSON 에서 빼고 보내므로 그대로 넘겨도 된다. */
export interface LibraryPatch {
  status?: ShelfStatus
  rating?: number | null
  reviewText?: string | null
  finishedDate?: string | null
}

/** 409 LIBRARY_ITEM_EXISTS 의 details.libraryItemId — 같은 책이 이미 서재에 있을 때 서버가 그 id 를 돌려준다 */
function existingItemId(err: unknown): string | null {
  if (!isAxiosError(err) || err.response?.status !== 409) return null
  const data = err.response.data as { code?: string; details?: { libraryItemId?: string | number } } | undefined
  if (data?.code !== 'LIBRARY_ITEM_EXISTS') return null
  const id = data.details?.libraryItemId
  return id == null ? null : String(id)
}

/** GET /library/me?status= (§6.1) — updatedAt 내림차순, 페이지 없음 */
export async function fetchMyLibrary(status?: ShelfStatus): Promise<ServerLibraryItem[]> {
  const res = await api.get<{ items: ServerLibraryItem[] }>('/library/me', { params: status ? { status } : undefined })
  return res.data.items
}

/** PATCH /library/{id} (§6.3) — 200 + LibraryItem */
export async function patchLibraryItem(libraryItemId: string | number, patch: LibraryPatch): Promise<ServerLibraryItem> {
  const res = await api.patch<ServerLibraryItem>(`/library/${libraryItemId}`, patch)
  return res.data
}

/** POST /library (§6.2) — 본문은 bookId·status 두 필드만. 201 + LibraryItem.
 *  이미 있으면 409 → 그 항목을 PATCH 로 상태 전환(WISH→READ 승격 포함). 화면은 둘을 구분할 필요가 없다. */
export async function addToLibrary(bookId: string | number, status: ShelfStatus): Promise<ServerLibraryItem> {
  try {
    const res = await api.post<ServerLibraryItem>('/library', { bookId: String(bookId), status })
    return res.data
  } catch (err) {
    const id = existingItemId(err)
    if (!id) throw err
    return patchLibraryItem(id, { status })
  }
}

/** 담기 + 별점·감상·완독일까지 한 번에 — 완독 모달용. POST 는 두 필드만 받으므로 나머지는 이어서 PATCH 한다. */
export async function saveLibraryRecord(bookId: string | number, record: LibraryPatch & { status: ShelfStatus }): Promise<ServerLibraryItem> {
  const { status, ...extra } = record
  const item = await addToLibrary(bookId, status)
  const hasExtra = Object.values(extra).some((v) => v !== undefined)
  return hasExtra ? patchLibraryItem(item.libraryItemId, extra) : item
}

/** DELETE /library/{id} (§6.4) — 204. 찜 해제·서재에서 빼기 */
export async function removeLibraryItem(libraryItemId: string | number): Promise<void> {
  await api.delete(`/library/${libraryItemId}`)
}
