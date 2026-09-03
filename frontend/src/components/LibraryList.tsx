import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, ShelfStatus } from '../api/types'

const REVIEW_MAX = 300

/** 분류 2단계의 마지막 세그먼트 ("문학 > 한국소설" → "한국소설") */
const categoryKey = (li: LibraryItem) => {
  const parts = (li.book.category ?? '').split(' > ').filter(Boolean)
  return parts[1] ?? parts[0] ?? '미분류'
}

/** 서재 목록 뷰 — 별점 · 상태 · 한 줄 감상평을 고치는 자리.
 *
 *  서재 시안 A(선반)와 B(나의 책)가 같은 편집 화면을 써야 해서 컴포넌트로 뺐다.
 *  B안의 원칙: 스프레드는 보는 자리, 목록은 고치는 자리 — 그래서 편집 UI는 전부 여기에만 둔다.
 *  둥근 카드 대신 행마다 1px 규칙선으로 끊는다 (DESIGN.md Layout). */
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
    <ul className="border-b border-rule-soft">
      {items.map((li) => (
        <li key={li.libraryItemId} className="border-t border-rule-soft py-4">
          <div className="flex items-center gap-4">
            <Link to={`/books/${li.book.bookId}`} className="flex min-w-0 flex-1 items-center gap-4 transition-opacity duration-150 hover:opacity-60">
              {li.book.coverUrl
                ? <img className="eo-row__cover" src={li.book.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                : <span className="eo-row__cover" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {li.book.title}
                  {li.book.author && <span className="ml-2 text-[11px] font-normal text-ink-muted">{li.book.author}</span>}
                </span>
                <span className="mt-1 block truncate text-[10px] tabular-nums text-ink-faint">
                  {categoryKey(li)}
                  {li.status === 'READ' && li.finishedDate && ` · 완독 ${li.finishedDate}`}
                  {li.status === 'READING' && li.progressPage != null && ` · 읽는 중 ${li.progressPage}p`}
                  {li.status === 'WISH' && ' · 읽고 싶은 책'}
                </span>
              </span>
            </Link>

            {/* 별점은 완독한 책에만 — 자리는 늘 비워 두어 행 폭이 흔들리지 않게 한다 */}
            <div className="hidden w-[92px] shrink-0 justify-end gap-0.5 sm:flex">
              {li.status === 'READ' && [1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => patch.mutate({ id: li.libraryItemId, rating: n })}
                  aria-label={`별점 ${n}점`} aria-pressed={li.rating === n}
                  className={`text-[15px] leading-none ${(li.rating ?? 0) >= n ? 'text-ink' : 'text-rule-soft'}`}>★</button>
              ))}
            </div>

            <select className="eo-field eo-field--sm w-[86px] shrink-0" value={li.status}
              aria-label={`${li.book.title} 상태`}
              onChange={(e) => patch.mutate({ id: li.libraryItemId, status: e.target.value as ShelfStatus })}>
              <option value="WISH">찜</option><option value="READING">읽는 중</option><option value="READ">읽음</option>
            </select>
          </div>

          {/* 한 줄 감상평 — READ만, 본인 기록 전용 */}
          {li.status === 'READ' && (
            reviewOpenId === li.libraryItemId ? (
              <div className="mt-3.5 border-t border-rule-soft pt-3.5">
                <textarea className="eo-field eo-field--sm w-full resize-none leading-relaxed" rows={2}
                  maxLength={REVIEW_MAX} placeholder="한 줄 감상평 — 나만 볼 수 있어요"
                  value={reviewDraft} onChange={(e) => setReviewDraft(e.target.value)} autoFocus />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] tabular-nums text-ink-faint">{reviewDraft.length} / {REVIEW_MAX}</span>
                  <div className="flex items-center gap-5">
                    <button className="eo-link" onClick={() => setReviewOpenId(null)}>취소</button>
                    <button className="eo-text-button text-[13px]" onClick={() => saveReview(li.libraryItemId)}>저장</button>
                  </div>
                </div>
              </div>
            ) : (
              <button className="mt-2.5 block w-full text-left text-[12px] leading-relaxed text-ink-muted transition-opacity duration-150 hover:opacity-60"
                onClick={() => openReview(li)}>
                {li.reviewText
                  ? <>{li.reviewText} <span className="ml-1.5 border-b border-rule text-[10px] text-ink-faint">수정</span></>
                  : <span className="border-b border-rule text-[11px] text-ink-faint">한 줄 감상평 남기기</span>}
              </button>
            )
          )}
        </li>
      ))}
    </ul>
  )
}
