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
 *  이 화면은 고치러 오는 곳이다. 고치는 문은 오른쪽 끝 「기록 수정」 하나 — 누르면 완독 모달(edit 모드)이 열린다.
 *  그 옆 「상세 보기 ›」는 상세로 가는 길. 둘은 같은 자리에서 한 단 차이(잉크 / 회색)로 갈린다.
 *  행 전체를 버튼으로 두었던 때가 있었다 — 어디를 눌러도 수정 모달이 떠서 그냥 훑어보려는 손도 잡혔다.
 *  행은 보는 자리, 고치는 건 그 문으로만.
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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
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
          </div>

          {/* 두 문 — 고치기(잉크)와 상세(회색). 같은 자리에서 한 단 차이로 갈린다 */}
          <span className="flex shrink-0 items-center gap-x-4 whitespace-nowrap">
            {/* eo-link 기본은 회색 — 고치는 문만 잉크로 올린다. Tailwind 클래스는 editorial.css 뒤에 져서 인라인 */}
            <button type="button" onClick={() => edit(li)} className="eo-link" style={{ color: 'var(--eo-ink)', borderBottomColor: 'var(--eo-ink)' }}
              aria-label={`${li.book.title} 기록 수정`}>
              기록 수정
            </button>
            <Link to={`/books/${li.book.bookId}`} className="eo-link" aria-label={`${li.book.title} 상세 보기`}>
              상세 보기 <span aria-hidden>›</span>
            </Link>
          </span>
        </li>
      ))}
    </ul>
  )
}
