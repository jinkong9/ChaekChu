import { useState } from 'react'
import type { BookSummary } from '../api/types'
import { coverPalette } from '../lib/coverPalette'
import { coverAtWidth } from '../lib/coverUrl'

/** 우표 조각 — 톱니 테두리(Perforated)와 그 위에 책 표지를 붙인 우표(Stamp).
 *  추천 화면의 표지 우표와 사연 우표(LetterStamp)가 같은 톱니를 쓴다. */

const PAPER = '#f6f1e3'

/** 톱니 테두리 — 바탕색 반원을 네 변에 겹쳐 파낸다(마스크 없이 어느 브라우저에서나 같게 보인다).
 *  @param notch 이 종이가 올라앉은 바탕색. 이 색으로 톱니를 파므로 실제 배경과 달라지면 티가 난다. */
export function Perforated({ width, notch = PAPER, frame = '#fffdf6', children, style }: {
  width: number
  notch?: string
  /** 톱니 안쪽 여백의 색 — 우표는 흰 테, 엽서는 종이색 */
  frame?: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  const tooth = Math.min(11, Math.max(5, Math.round(width * 0.055))) // 톱니 반경 — 종이가 커져도 이가 벌어지지 않게 상한을 둔다
  const tile = tooth * 1.6
  const r = tooth * 0.62
  const half = tile / 2
  const strip = (bg: string, axis: 'x' | 'y'): React.CSSProperties => ({
    position: 'absolute',
    backgroundImage: bg,
    backgroundSize: axis === 'x' ? `${tile}px ${tooth}px` : `${tooth}px ${tile}px`,
    backgroundRepeat: axis === 'x' ? 'repeat-x' : 'repeat-y',
  })
  return (
    <div className="relative" style={{ width, filter: 'drop-shadow(1px 2px 3px rgba(34,34,74,0.22))', ...style }}>
      <div style={{ background: frame, padding: tooth * 0.6 }}>{children}</div>
      <div style={{ ...strip(`radial-gradient(circle ${r}px at ${half}px 0px, ${notch} 99%, transparent 100%)`, 'x'), left: 0, right: 0, top: 0, height: tooth }} />
      <div style={{ ...strip(`radial-gradient(circle ${r}px at ${half}px ${tooth}px, ${notch} 99%, transparent 100%)`, 'x'), left: 0, right: 0, bottom: 0, height: tooth }} />
      <div style={{ ...strip(`radial-gradient(circle ${r}px at 0px ${half}px, ${notch} 99%, transparent 100%)`, 'y'), top: 0, bottom: 0, left: 0, width: tooth }} />
      <div style={{ ...strip(`radial-gradient(circle ${r}px at ${tooth}px ${half}px, ${notch} 99%, transparent 100%)`, 'y'), top: 0, bottom: 0, right: 0, width: tooth }} />
    </div>
  )
}

/** 책 표지를 붙인 우표 — 표지가 곧 '어디서 온 편지인지'다.
 *  frame(테 색)과 notch(바탕색)가 비슷하면 톱니가 안 보인다 — 흰 배경에 놓을 땐 테를 종이색으로 준다. */
export function Stamp({ book, width, notch = PAPER, frame }: { book: BookSummary; width: number; notch?: string; frame?: string }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(book.bookId)
  return (
    <Perforated width={width} notch={notch} frame={frame}>
      {book.coverUrl && !broken ? (
        <img src={coverAtWidth(book.coverUrl, width)!} alt={book.title} referrerPolicy="no-referrer" loading="lazy"
          onError={() => setBroken(true)} className="block w-full object-cover" style={{ aspectRatio: '5 / 7' }} />
      ) : (
        <div className="flex items-end p-1.5 font-bold leading-tight"
          style={{ background: c.bg, color: c.fg, aspectRatio: '5 / 7', fontSize: width * 0.11 }}>
          <span className="line-clamp-4">{book.title}</span>
        </div>
      )}
    </Perforated>
  )
}
