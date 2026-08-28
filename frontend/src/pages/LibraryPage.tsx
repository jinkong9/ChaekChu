import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, ShelfStatus } from '../api/types'

const TABS: { key: ShelfStatus; label: string }[] = [
  { key: 'WISH', label: '찜' },
  { key: 'READING', label: '읽는 중' },
  { key: 'READ', label: '읽음' },
]

/** LIB-001 내 서재 — 상태 탭 + 별점(정수 1~5 확정) + 한 줄 감상평(300자, 본인 전용) */
export default function LibraryPage() {
  const [tab, setTab] = useState<ShelfStatus>('WISH')
  const [reviewOpenId, setReviewOpenId] = useState<number | null>(null)
  const [reviewDraft, setReviewDraft] = useState('')
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

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

  const items = (data ?? []).filter((li) => li.status === tab)
  const count = (s: ShelfStatus) => (data ?? []).filter((li) => li.status === s).length

  return (
    <main className="p-8 max-w-3xl">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">내 서재</h1>
        <Link to="/search" className="border-2 border-primary rounded-lg px-4 py-1.5 font-bold">+ 책 추가</Link>
      </div>

      <div className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-5 py-2 border-2 font-bold ${tab === t.key ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-400'}`}>
            {t.label} {count(t.key)}
          </button>
        ))}
      </div>

      <ul className="mt-4 space-y-3">
        {items.map((li) => (
          <li key={li.libraryItemId} className="border-2 border-primary rounded-xl bg-white p-4">
            <div className="flex gap-4 items-center">
              <Link to={`/books/${li.book.bookId}`} className="flex gap-4 items-center flex-1 min-w-0">
                <div className="w-12 h-[68px] bg-gray-200 rounded flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold truncate">{li.book.title} <span className="font-normal text-sm text-gray-500">{li.book.author}</span></p>
                  <p className="text-sm text-gray-400">
                    {li.status === 'READ' && li.finishedDate && `완독 · ${li.finishedDate}`}
                    {li.status === 'READING' && li.progressPage != null && `읽는 중 · ${li.progressPage}p`}
                    {li.status === 'WISH' && '읽고 싶은 책'}
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

              <select
                className="border-2 border-primary rounded-lg px-2 py-1.5 text-sm"
                value={li.status}
                onChange={(e) => patch.mutate({ id: li.libraryItemId, status: e.target.value as ShelfStatus })}
              >
                {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>

            {/* 한 줄 감상평 — READ만, 본인 기록 전용 (추천·검색에 안 쓰임) */}
            {li.status === 'READ' && (
              reviewOpenId === li.libraryItemId ? (
                <div className="mt-3 border-t pt-3">
                  <textarea
                    className="w-full border-2 border-primary rounded-lg px-3 py-2 text-sm resize-none" rows={2}
                    maxLength={300} placeholder="한 줄 감상평 — 나만 볼 수 있어요"
                    value={reviewDraft} onChange={(e) => setReviewDraft(e.target.value)} autoFocus
                  />
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

      {items.length === 0 && (
        <div className="mt-6 border-2 border-dashed border-gray-300 rounded-xl p-10 text-center">
          <p className="text-gray-400">첫 책을 담아보세요</p>
          <div className="mt-3 flex gap-2 justify-center">
            <Link to="/home" className="border-2 border-primary rounded-lg px-4 py-1.5 font-bold">추천 보러 가기</Link>
            <Link to="/search" className="border-2 border-primary rounded-lg px-4 py-1.5">검색하기</Link>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-gray-400">캘린더 뷰는 베타 이후 추가 (완독일은 지금부터 저장) · 감상평은 본인만 볼 수 있어요</p>
    </main>
  )
}
