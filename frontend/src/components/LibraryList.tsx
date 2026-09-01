import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, ShelfStatus } from '../api/types'
import BookCover from './BookCover'

/** 분류 2단계의 마지막 세그먼트 ("문학 > 한국소설" → "한국소설") */
const categoryKey = (li: LibraryItem) => {
  const parts = (li.book.category ?? '').split(' > ').filter(Boolean)
  return parts[1] ?? parts[0] ?? '미분류'
}

/** 서재 목록 뷰 — 별점 · 상태 · 한 줄 감상평을 고치는 자리.
 *
 *  서재 시안 A(선반)와 B(나의 책)가 같은 편집 화면을 써야 해서 컴포넌트로 뺐다.
 *  B안의 원칙: 스프레드는 보는 자리, 목록은 고치는 자리 — 그래서 편집 UI는 전부 여기에만 둔다. */
export default function LibraryList({ items }: { items: LibraryItem[] }) {
  const [reviewOpenId, setReviewOpenId] = useState<number | null>(null)
  const [reviewDraft, setReviewDraft] = useState('')
  const qc = useQueryClient()

  const patch = useMutation({
    mutationFn: async (v: { id: number; status?: ShelfStatus; rating?: number; reviewText?: string | null }) =>
      api.patch(`/library/${v.id}`, { status: v.status, rating: v.rating, reviewText: v.reviewText }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  })

  const openReview = (li: LibraryItem) => {
    setReviewOpenId(li.libraryItemId)
    setReviewDraft(li.reviewText ?? '')
  }
  const saveReview = (id: number) => {
    // 계약 §4.3: 앞뒤 공백 제거, 빈 문자열은 null
    const trimmed = reviewDraft.trim()
    patch.mutate({ id, reviewText: trimmed === '' ? null : trimmed })
    setReviewOpenId(null)
  }

  return (
    <ul className="space-y-3">
      {items.map((li) => (
        <li key={li.libraryItemId} className="border-2 border-primary rounded-xl bg-white p-4">
          <div className="flex gap-4 items-center">
            <Link to={`/books/${li.book.bookId}`} className="flex gap-4 items-center flex-1 min-w-0">
              <BookCover book={li.book} size="sm" />
              <div className="min-w-0">
                <p className="font-bold truncate">{li.book.title} <span className="font-normal text-sm text-gray-500">{li.book.author}</span></p>
                <p className="text-sm text-gray-400">
                  {categoryKey(li)}
                  {li.status === 'READ' && li.finishedDate && ` · 완독 ${li.finishedDate}`}
                  {li.status === 'READING' && li.progressPage != null && ` · 읽는 중 ${li.progressPage}p`}
                  {li.status === 'WISH' && ' · 읽고 싶은 책'}
                </p>
              </div>
            </Link>
            {li.status === 'READ' && (
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => patch.mutate({ id: li.libraryItemId, rating: n })}
                    className={`text-xl leading-none ${(li.rating ?? 0) >= n ? 'text-primary' : 'text-gray-300'}`}>★</button>
                ))}
              </div>
            )}
            <select className="border-2 border-primary rounded-lg px-2 py-1.5 text-sm" value={li.status}
              onChange={(e) => patch.mutate({ id: li.libraryItemId, status: e.target.value as ShelfStatus })}>
              <option value="WISH">찜</option><option value="READING">읽는 중</option><option value="READ">읽음</option>
            </select>
          </div>
          {/* 한 줄 감상평 — READ만, 본인 기록 전용 */}
          {li.status === 'READ' && (
            reviewOpenId === li.libraryItemId ? (
              <div className="mt-3 border-t pt-3">
                <textarea className="w-full border-2 border-primary rounded-lg px-3 py-2 text-sm resize-none" rows={2}
                  maxLength={300} placeholder="한 줄 감상평 — 나만 볼 수 있어요"
                  value={reviewDraft} onChange={(e) => setReviewDraft(e.target.value)} autoFocus />
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-400">{reviewDraft.length} / 300</span>
                  <div className="flex gap-2">
                    <button className="text-sm text-gray-400 underline" onClick={() => setReviewOpenId(null)}>취소</button>
                    <button className="text-sm bg-primary text-white rounded px-3 py-1 font-bold" onClick={() => saveReview(li.libraryItemId)}>저장</button>
                  </div>
                </div>
              </div>
            ) : (
              <button className="mt-2 text-sm text-gray-500 hover:text-accent text-left w-full" onClick={() => openReview(li)}>
                {li.reviewText ? <>💬 {li.reviewText} <span className="text-xs text-gray-400 underline ml-1">수정</span></> : '💬 한 줄 감상평 남기기'}
              </button>
            )
          )}
        </li>
      ))}
    </ul>
  )
}
