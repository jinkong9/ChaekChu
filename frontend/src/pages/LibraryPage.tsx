import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, ShelfStatus } from '../api/types'
import { trackEvent } from '../lib/events'

const TABS: { key: ShelfStatus; label: string }[] = [
  { key: 'WISH', label: '찜' },
  { key: 'READING', label: '읽는 중' },
  { key: 'READ', label: '읽음' },
]

/** LIB-001 내 서재 — 상태 탭 + 별점(0.5 단위는 게이트 확정 대기, 현재 1점 단위) + 상태 변경 */
export default function LibraryPage() {
  const [tab, setTab] = useState<ShelfStatus>('WISH')
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

  const patch = useMutation({
    mutationFn: async (v: { id: number; status?: ShelfStatus; rating?: number }) =>
      api.patch(`/library/${v.id}`, { status: v.status, rating: v.rating }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  })

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
          <li key={li.libraryItemId} className="flex gap-4 items-center border-2 border-primary rounded-xl bg-white p-4">
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
                  <button key={n}
                    onClick={() => { patch.mutate({ id: li.libraryItemId, rating: n }); trackEvent('reading_feedback', { bookId: li.book.bookId, rating: n }) }}
                    className={`text-xl leading-none ${(li.rating ?? 0) >= n ? 'text-primary' : 'text-gray-300'}`}>★</button>
                ))}
              </div>
            )}

            <select
              className="border-2 border-primary rounded-lg px-2 py-1.5 text-sm"
              value={li.status}
              onChange={(e) => { patch.mutate({ id: li.libraryItemId, status: e.target.value as ShelfStatus }); trackEvent('reading_feedback', { bookId: li.book.bookId, status: e.target.value }) }}
            >
              {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <div className="mt-6 border-2 border-dashed border-gray-300 rounded-xl p-10 text-center">
          <p className="text-gray-400">첫 책을 담아보세요</p>
          <div className="mt-3 flex gap-2 justify-center">
            <Link to="/" className="border-2 border-primary rounded-lg px-4 py-1.5 font-bold">추천 보러 가기</Link>
            <Link to="/search" className="border-2 border-primary rounded-lg px-4 py-1.5">검색하기</Link>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-gray-400">캘린더 뷰는 베타 이후 추가 (완독일은 지금부터 저장) · 별점 0.5 단위는 게이트 확정 대기</p>
    </main>
  )
}
