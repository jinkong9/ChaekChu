/** 서재 행동 두 개 — 「읽었어요」·「읽고 싶어요」.
 *
 *  책 상세(펼침면)에서 쓰던 한 벌을 그대로 떼어 냈다. BOOK DNA 의 가챠 결과·월드컵 우승 책도
 *  같은 버튼을 쓴다 — 어디서 만나든 책에 하는 일은 이 둘뿐이고, 모양도 같아야 같은 일로 읽힌다.
 *
 *  상태는 전부 `my`(본인 서재 항목, §4.4)에서 나온다: 없으면 null, 있으면 READ 아니면 WISH.
 *  - 읽음은 완독 모달을 거친다(별점·감상·완독일). 이미 찜이면 그 항목 id 를 넘겨 그 자리에서 READ 로 올린다(§6.3).
 *  - 찜은 한 버튼에서 담고 푼다 — 라벨은 그대로, 담겼는지는 북마크가 채워졌는가로 말한다.
 *  - 읽은 책에서는 둘 다 잠근다. 읽음을 무르거나 기록을 고치는 일은 내 서재 한 곳에서만 한다. */
import { useState, type SVGProps } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { addToLibrary, removeLibraryItem } from '../api/library'
import type { MyLibraryEntry, ShelfStatus } from '../api/types'
import { useFinishModalStore } from '../stores/finishModalStore'
import { trackEvent, type EventContext } from '../lib/events'
import './ShelfActions.css'

const CTA_LABEL: Record<ShelfStatus, string> = { READ: '읽었어요', WISH: '읽고 싶어요' }
const READ_DONE_LABEL = '이미 읽었어요'
/** 찜을 다시 누르면 해제된다 — 라벨에 적으면 버튼이 둘인 것처럼 읽혀 title·aria-label 로 옮겼다 */
const WISH_CANCEL_HINT = '읽고 싶어요 해제'

const PATH = {
  bookmark: 'M4 2h8v12l-4-3-4 3V2z',
  check: 'M3 8.4l3.2 3.1L13 4.8',
}

function Icon({ d, ...rest }: { d: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}><path d={d} /></svg>
  )
}

export default function ShelfActions({
  bookId,
  title,
  my,
  eventContext,
  onChanged,
  className,
}: {
  bookId: string | number
  title: string
  /** 본인 서재 항목 — 없으면 null */
  my: MyLibraryEntry | null
  /** WISH 이벤트에 붙일 화면 표시(예: 'DNA'). 상세 화면은 비운다 */
  eventContext?: EventContext
  /** 서재가 바뀐 뒤 화면이 더 비워야 할 캐시가 있으면 여기서 — ['library'] 는 컴포넌트가 늘 비운다 */
  onChanged?: () => void
  className?: string
}) {
  const qc = useQueryClient()
  const openFinish = useFinishModalStore((s) => s.open)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const readItem = my?.status === 'READ' ? my : null
  const wishedItem = my?.status === 'WISH' ? my : null

  const openRead = () =>
    openFinish({ bookId, title, libraryItemId: wishedItem?.libraryItemId,
      rating: wishedItem?.rating, reviewText: wishedItem?.reviewText })

  /** 서버로 바로 가는 건 찜뿐이다 — 왕복 동안 버튼을 잠그고, 실패하면 버튼 아래에 알린다.
   *  담기는 POST(이미 있으면 409 → PATCH)라 두 번 눌러도 줄이 늘지 않고, 해제는 DELETE /library/{id}(§6.4). */
  const toggleWish = () => {
    // 이벤트는 담을 때만 — 계약의 EventType 에 해제가 없다(lib/events.ts)
    if (!wishedItem) trackEvent('WISH', eventContext ? { bookId, context: eventContext } : { bookId })
    setSaving(true)
    setSaveError(null)
    const req: Promise<unknown> = wishedItem
      ? removeLibraryItem(wishedItem.libraryItemId)
      : addToLibrary(bookId, 'WISH')
    req
      .then(() => { qc.invalidateQueries({ queryKey: ['library'] }); onChanged?.() })
      // 401 은 인터셉터가 로그아웃으로 받아 간다 — 여기 남는 건 네트워크 끊김·서버 오류·담기 경합
      .catch(() => setSaveError(wishedItem
        ? '찜을 해제하지 못했습니다. 잠시 후 다시 눌러 주세요.'
        : '서재에 담지 못했습니다. 잠시 후 다시 눌러 주세요.'))
      .finally(() => setSaving(false))
  }

  return (
    <div className={className}>
      <div className="shelf-cta">
        <button type="button" className="eo-button" onClick={openRead} disabled={saving || readItem !== null} aria-pressed={readItem !== null}>
          {readItem && <Icon d={PATH.check} />}
          {readItem ? READ_DONE_LABEL : CTA_LABEL.READ}
        </button>
        <button type="button" className="shelf-cta__ghost" onClick={toggleWish} disabled={saving || readItem !== null}
          aria-pressed={wishedItem !== null}
          title={wishedItem ? WISH_CANCEL_HINT : undefined}
          aria-label={wishedItem ? WISH_CANCEL_HINT : undefined}>
          {/* 담긴 북마크는 속을 채운다 — 빈/채운 북마크는 따로 배우지 않아도 되는 짝이다 */}
          <Icon d={PATH.bookmark} fill={wishedItem ? 'currentColor' : 'none'} />
          {CTA_LABEL.WISH}
        </button>
      </div>
      {readItem && (
        <p className="shelf-cta__note">
          이미 읽은 책이에요. 별점·감상·완독일을 고치거나 기록을 무르는 건 <Link to="/library" className="eo-link">내 서재</Link>에서 할 수 있어요.
        </p>
      )}
      {saveError && <p className="shelf-cta__error" role="alert">{saveError}</p>}
    </div>
  )
}
