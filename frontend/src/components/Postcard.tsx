import { useState } from 'react'
import type { BookSummary } from '../api/types'
import { coverPalette } from '../lib/coverPalette'
import { coverAtWidth } from '../lib/coverUrl'

/** 추천 이유를 '받은 엽서'로 보여주는 카드 (추천 B안 · 편지).
 *  옛 우편엽서 뒷면 구조 그대로 — 가운데 세로선 기준으로
 *  왼쪽은 손글씨 사연(추천 이유), 오른쪽은 우표 자리와 받는이 줄.
 *  우표 자리에는 책 표지가 붙는다: 표지가 곧 '어디서 온 편지인지'다. */

const PAPER = '#f6f1e3'
const INK = '#2b3a86'

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

interface PostcardProps {
  book: BookSummary
  /** 손글씨로 옮겨 적을 추천 이유 (계약상 내 서재의 구체 근거를 담은 문장) */
  reason: string
  /** 인사말의 수신인 — 없으면 '독자' */
  to?: string | null
  /** 엽서 폭(px). 안쪽 글씨·우표·여백이 전부 이 값에 비례한다. */
  width?: number
  /** 소인(날짜 도장)에 찍을 문구 */
  postmark?: string
  /** 엽서 아래쪽 이만큼(px)이 주머니에 가려진다 — 그만큼 글씨를 위로 올려 잘리지 않게 한다 */
  insetBottom?: number
  className?: string
  style?: React.CSSProperties
}

export default function Postcard({ book, reason, to, width = 620, postmark, insetBottom = 0, className = '', style }: PostcardProps) {
  const pad = width * 0.032
  const line = width * 0.042   // 손글씨 크기
  const meta: string[] = [
    book.title,
    [book.author, book.publisher].filter(Boolean).join(' · ') || ' ',
    [book.pageCount && `${book.pageCount}쪽`, book.publicationYear].filter(Boolean).join(' · ') || ' ',
  ]

  return (
    <div className={`relative ${className}`}
      style={{
        width, aspectRatio: '1.5 / 1', background: PAPER, color: INK,
        // 오래된 종이 — 미세한 얼룩 두 겹으로 균일한 색면을 깬다
        backgroundImage:
          'radial-gradient(120% 90% at 12% 8%, rgba(255,255,255,0.55), transparent 60%),' +
          'radial-gradient(80% 70% at 92% 96%, rgba(160,132,80,0.13), transparent 70%)',
        boxShadow: '0 18px 40px -18px rgba(34,34,74,0.45), 0 2px 0 rgba(255,255,255,0.6) inset',
        ...style,
      }}>
      {/* 엽서 테두리 인쇄선 */}
      <div className="absolute pointer-events-none" style={{ inset: pad, border: `1px solid ${INK}33` }} />
      {/* 가운데 세로 구분선 */}
      <div className="absolute pointer-events-none"
        style={{ left: '52%', top: pad * 1.8, bottom: pad * 1.8, width: 1, background: `${INK}30` }} />

      <div className="absolute inset-0 flex" style={{ padding: pad * 2.1, paddingBottom: pad * 2.1 + insetBottom }}>
        {/* ── 왼쪽: 손글씨 사연 ── */}
        <div className="flex flex-col" style={{ width: '50%', paddingRight: pad }}>
          <p className="font-hand" style={{ fontSize: line, lineHeight: 1.62, letterSpacing: '-0.01em' }}>
            {to ?? '독자'}님께,
          </p>
          <p className="font-hand" style={{ fontSize: line, lineHeight: 1.62, letterSpacing: '-0.01em', marginTop: line * 0.35 }}>
            {reason}
          </p>
          <p className="font-hand mt-auto self-end" style={{ fontSize: line * 0.82, opacity: 0.8 }}>
            — 책추책책추 드림
          </p>
        </div>

        {/* ── 오른쪽: 우표 자리 + 받는 이 ── */}
        <div className="relative flex flex-col" style={{ width: '50%', paddingLeft: pad * 1.6 }}>
          <div className="flex items-start justify-end" style={{ gap: pad }}>
            {postmark && (
              /* 소인 — 우표 옆에 비스듬히 찍힌 동그란 날짜 도장 */
              <div className="flex flex-col items-center justify-center rounded-full font-hand shrink-0"
                style={{
                  width: width * 0.145, height: width * 0.145, marginTop: width * 0.03,
                  border: `${Math.max(1.5, width * 0.004)}px solid ${INK}`, color: INK, opacity: 0.42,
                  transform: 'rotate(-13deg)', fontSize: width * 0.028, lineHeight: 1.15,
                }}>
                <span style={{ fontSize: width * 0.02, letterSpacing: '0.08em' }}>BOOKCHU</span>
                <span>{postmark}</span>
              </div>
            )}
            <Stamp book={book} width={width * 0.2} />
          </div>

          {/* 받는 이 — 인쇄된 줄 위에 손글씨로 책 정보 */}
          <div className="mt-auto" style={{ paddingBottom: pad * 0.4 }}>
            {meta.map((t, i) => (
              <div key={i} className="flex items-end" style={{ height: line * 1.5, borderBottom: `1px solid ${INK}2e` }}>
                <span className="font-hand truncate w-full"
                  style={{ fontSize: i === 0 ? line * 0.95 : line * 0.76, lineHeight: 1.1, paddingBottom: line * 0.12, opacity: i === 0 ? 1 : 0.72 }}>
                  {t}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
