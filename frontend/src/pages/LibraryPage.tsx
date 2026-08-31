import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, RecommendationResponse, ShelfStatus } from '../api/types'

const TABS: { key: ShelfStatus; label: string }[] = [
  { key: 'WISH', label: '찜' },
  { key: 'READING', label: '읽는 중' },
  { key: 'READ', label: '읽음' },
]

/** 책등(spine) 색 팔레트 — 테마 C 계열. bookId 기준 고정 배정(리렌더에도 색 유지) */
const SPINE_COLORS = [
  { bg: '#22224a', fg: '#fff8ec' }, { bg: '#ff6b4a', fg: '#fff8ec' }, { bg: '#ffd166', fg: '#22224a' },
  { bg: '#b7d9c8', fg: '#22224a' }, { bg: '#8a84a8', fg: '#fff8ec' }, { bg: '#e8e1cf', fg: '#22224a' },
]
const spineColor = (bookId: number) => SPINE_COLORS[bookId % SPINE_COLORS.length]
/** 쪽수 → 책등 높이(px). 얇은 책과 벽돌책이 눈으로 구분되게 */
const spineHeight = (pageCount: number | null) => 116 + Math.min(pageCount ?? 250, 600) / 600 * 48

/** 선반 키 = 분류 2단계의 마지막 세그먼트 ("문학 > 한국소설" → "한국소설") */
const shelfKey = (li: LibraryItem) => {
  const parts = (li.book.category ?? '').split(' > ').filter(Boolean)
  return parts[1] ?? parts[0] ?? '미분류'
}

/** LIB-001 내 서재 — 상태 탭 × (책장 선반 뷰 ↔ 리스트 뷰) + 통계 헤더.
 *  선반 = categories(KDC 2단계) 자동 분류: 유저 정리 노동 없이 책장이 구성된다 */
export default function LibraryPage() {
  const [tab, setTab] = useState<ShelfStatus>('READ')
  const [view, setView] = useState<'shelf' | 'list'>('shelf')
  const [reviewOpenId, setReviewOpenId] = useState<number | null>(null)
  const [reviewDraft, setReviewDraft] = useState('')
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })
  // 선반 끝 "어울리는 다음 한 권" — 이미 캐시된 추천 덱 재사용 (추가 계산 없음)
  const { data: rec } = useQuery({
    queryKey: ['recommendations'],
    queryFn: async () => (await api.get<RecommendationResponse>('/recommendations')).data,
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

  const all = data ?? []
  const items = all.filter((li) => li.status === tab)
  const count = (s: ShelfStatus) => all.filter((li) => li.status === s).length

  // ===== 통계 헤더 =====
  const readItems = all.filter((li) => li.status === 'READ')
  const rated = readItems.filter((li) => li.rating != null)
  const avgRating = rated.length ? (rated.reduce((a, li) => a + (li.rating ?? 0), 0) / rated.length).toFixed(1) : '–'
  const thisYear = new Date().getFullYear().toString()
  const readThisYear = readItems.filter((li) => li.finishedDate?.startsWith(thisYear)).length

  // ===== 선반 구성: 분류별 그룹 (권수 내림차순) =====
  const shelves = [...items.reduce((m, li) => {
    const k = shelfKey(li)
    m.set(k, [...(m.get(k) ?? []), li])
    return m
  }, new Map<string, LibraryItem[]>())].sort((a, b) => b[1].length - a[1].length)

  // 선반별 추천 슬롯: 덱에서 서재에 없는 책을 선반 순서대로 하나씩 배정 (mock — 실제는 분야 필터)
  const inLibrary = new Set(all.map((li) => li.book.bookId))
  const recPool = (rec?.items ?? []).filter((it) => !inLibrary.has(it.book.bookId))

  return (
    <main className="p-8 max-w-4xl">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">내 서재</h1>
        <Link to="/search" className="border-2 border-primary rounded-lg px-4 py-1.5 font-bold">+ 책 추가</Link>
      </div>

      {/* 통계 헤더 — 서재 = 기록의 축적임을 숫자로 */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { label: '서재의 책', value: `${all.length}권` },
          { label: '평균 별점', value: `★ ${avgRating}` },
          { label: `${thisYear}년 완독`, value: `${readThisYear}권` },
        ].map((s) => (
          <div key={s.label} className="border-2 border-primary rounded-xl bg-white px-4 py-3">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className="text-xl font-bold mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2 items-center">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-5 py-2 border-2 font-bold ${tab === t.key ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-400'}`}>
            {t.label} {count(t.key)}
          </button>
        ))}
        <div className="ml-auto flex border-2 border-primary rounded-lg overflow-hidden text-sm">
          <button className={`px-3 py-1.5 font-bold ${view === 'shelf' ? 'bg-primary text-white' : ''}`} onClick={() => setView('shelf')}>📚 책장</button>
          <button className={`px-3 py-1.5 font-bold ${view === 'list' ? 'bg-primary text-white' : ''}`} onClick={() => setView('list')}>☰ 목록</button>
        </div>
      </div>

      {/* ===== 책장 뷰: 분류별 선반 + 책등 ===== */}
      {view === 'shelf' && (
        <div className="mt-5 space-y-7">
          {shelves.map(([shelf, books], si) => {
            const slot = recPool[si] // 이 선반의 추천 슬롯 (mock: 순서 배정)
            return (
              <section key={shelf}>
                <h2 className="text-sm font-bold text-gray-500">{shelf} <span className="font-normal text-gray-400">{books.length}권</span></h2>
                <div className="mt-2 flex items-end gap-1.5 border-b-8 border-primary/80 pb-0 px-2 overflow-x-auto">
                  {books.map((li) => {
                    const c = spineColor(li.book.bookId)
                    return (
                      <Link key={li.libraryItemId} to={`/books/${li.book.bookId}`}
                        title={`${li.book.title}${li.rating ? ` · ★${li.rating}` : ''}`}
                        className="flex-shrink-0 rounded-t-sm px-1 flex flex-col items-center justify-between py-2 hover:-translate-y-1.5 transition-transform"
                        style={{ width: 36, height: spineHeight(li.book.pageCount), background: c.bg, color: c.fg }}>
                        <span className="text-[11px] font-bold leading-tight overflow-hidden [writing-mode:vertical-rl] max-h-[85%]">
                          {li.book.title}
                        </span>
                        {li.status === 'READ' && li.rating != null && <span className="text-[9px]">★{li.rating}</span>}
                        {li.status === 'READING' && <span className="text-[9px]">…</span>}
                      </Link>
                    )
                  })}
                  {/* 선반 끝: 이 선반과 어울리는 다음 한 권 — 서재가 곧 추천의 입구 */}
                  {slot && (
                    <Link to={`/books/${slot.book.bookId}?from=rec`}
                      title={slot.reasonText}
                      className="flex-shrink-0 rounded-t-sm border-2 border-dashed border-accent text-accent px-1 py-2 flex flex-col items-center justify-center gap-1 hover:bg-accent/10 transition-colors"
                      style={{ width: 36, height: 120 }}>
                      <span className="text-base leading-none">+</span>
                      <span className="text-[10px] leading-tight overflow-hidden [writing-mode:vertical-rl] max-h-[70%]">{slot.book.title}</span>
                    </Link>
                  )}
                </div>
                {slot && <p className="mt-1.5 text-xs text-gray-400">+ 이 선반과 어울리는 다음 한 권: <span className="text-accent font-bold">{slot.book.title}</span></p>}
              </section>
            )
          })}
          {items.length > 0 && <p className="text-xs text-gray-400">선반은 도서 분류(KDC)로 자동 구성돼요 · 책등을 누르면 상세로</p>}
        </div>
      )}

      {/* ===== 목록 뷰 (기존) ===== */}
      {view === 'list' && (
        <ul className="mt-4 space-y-3">
          {items.map((li) => (
            <li key={li.libraryItemId} className="border-2 border-primary rounded-xl bg-white p-4">
              <div className="flex gap-4 items-center">
                <Link to={`/books/${li.book.bookId}`} className="flex gap-4 items-center flex-1 min-w-0">
                  <div className="w-12 h-[68px] rounded flex-shrink-0" style={{ background: spineColor(li.book.bookId).bg }} />
                  <div className="min-w-0">
                    <p className="font-bold truncate">{li.book.title} <span className="font-normal text-sm text-gray-500">{li.book.author}</span></p>
                    <p className="text-sm text-gray-400">
                      {shelfKey(li)}
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
      )}

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
