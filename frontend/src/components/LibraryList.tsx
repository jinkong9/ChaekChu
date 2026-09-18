import { Link } from 'react-router'
import type { LibraryItem } from '../api/types'
import { useFinishModalStore } from '../stores/finishModalStore'

/** 분류 2단계의 마지막 세그먼트 ("문학 > 한국소설" → "한국소설") */
const categoryKey = (li: LibraryItem) => {
  const parts = (li.book.category ?? '').split(' > ').filter(Boolean)
  return parts[1] ?? parts[0] ?? '미분류'
}

/** "2026-09-17" → "2026.09.17" — 행에서는 점으로 잇는다. 하이픈은 입력칸 몫이다 */
const dotted = (ymd: string) => ymd.replace(/-/g, '.')

/** 서재 목록 — 「책 기록 수정」 화면의 행.
 *
 *  이 화면은 고치러 오는 곳이다. 그래서 행(표지·제목·별점·완독일)을 누르면 바로 완독 모달(edit 모드)이 열리고,
 *  상세로 가는 길은 오른쪽 끝 「상세 보기 ›」 하나로 낮춘다. 예전에는 반대였다 — 행을 누르면 상세로 가고
 *  고치려면 별점·감상평·상태를 각자 다른 자리에서 건드려야 했다.
 *  버튼 안에 링크를 넣을 수 없으므로 행은 「버튼(넓은 왼쪽) + 링크(오른쪽 끝)」 형제로 놓는다.
 *  둥근 카드 대신 행마다 1px 규칙선으로 끊는다 (DESIGN.md Layout). */
export default function LibraryList({ items }: { items: LibraryItem[] }) {
  const openFinish = useFinishModalStore((s) => s.open)

  const edit = (li: LibraryItem) =>
    openFinish({
      mode: 'edit', status: li.status,
      bookId: li.book.bookId, title: li.book.title, libraryItemId: li.libraryItemId,
      rating: li.rating, reviewText: li.reviewText, finishedDate: li.finishedDate,
    })

  return (
    <ul className="border-b border-rule-soft">
      {items.map((li) => (
        <li key={li.libraryItemId} className="flex items-center gap-x-5 border-t border-rule-soft py-4">
          {/* 행 = 수정 버튼. 표지부터 완독일까지 한 덩어리로 누른다 */}
          <button type="button" onClick={() => edit(li)} aria-label={`${li.book.title} 기록 수정`}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-left transition-opacity duration-150 hover:opacity-60">
          <span className="flex min-w-[220px] flex-1 items-center gap-4">
            {li.book.coverUrl
              ? <img className="eo-row__cover" src={li.book.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              : <span className="eo-row__cover" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">
                {li.book.title}
                {li.book.author && <span className="ml-2 text-[11px] font-normal text-ink-muted">{li.book.author}</span>}
              </span>
              {/* 둘째 줄: 분류 · 감상평 한 줄. 감상평이 없으면 없다고 옅게 — 빈 줄보다 낫고, 「수정」으로 가는 이유가 된다 */}
              <span className="mt-1 block truncate text-[11px] text-ink-muted">
                <span className="text-ink-faint">{categoryKey(li)}</span>
                {li.status === 'READ' && (
                  <>
                    <span className="mx-1.5 text-ink-faint">·</span>
                    {li.reviewText
                      ? li.reviewText
                      : <span className="text-ink-faint">감상평이 없어요</span>}
                  </>
                )}
              </span>
            </span>
          </span>

          {/* 별점(읽기 전용) · 완독일. 좁은 화면에서는 제목 아래로 내려온다 */}
          <span className="ml-auto flex shrink-0 items-center gap-x-5">
            {li.status === 'READ' ? (
              <>
                <span className="flex gap-0.5 text-[13px] leading-none" aria-label={li.rating ? `별점 ${li.rating}점` : '별점 없음'}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} aria-hidden className={(li.rating ?? 0) >= n ? 'text-ink' : 'text-rule-soft'}>★</span>
                  ))}
                </span>
                <span className="w-[76px] text-right text-[11px] tabular-nums text-ink-muted">
                  {li.finishedDate ? dotted(li.finishedDate) : <span className="text-ink-faint">완독일 없음</span>}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-ink-faint">찜한 책</span>
            )}
          </span>
          </button>

          {/* 상세로 가는 길 — 이 화면의 주역이 아니라 밑줄 링크로 낮춘다 */}
          <Link to={`/books/${li.book.bookId}`} className="eo-link shrink-0 whitespace-nowrap" aria-label={`${li.book.title} 상세 보기`}>
            상세 보기 <span aria-hidden>›</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
