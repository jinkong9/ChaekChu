import { useState } from 'react'
import type { BookSummary } from '../api/types'
import { coverPalette } from '../lib/coverPalette'

/** 두께가 있는 3D 책 — 앞표지 + 책등 + 책배(종이 단면) + 스펙큘러 하이라이트.
 *
 *  부모가 transform-style: preserve-3d 여야 하고, rotateY가 걸릴 때 두께가 드러난다.
 *  깊이 표현(안개·하이라이트)은 부모가 매 프레임 CSS 변수로 주입한다:
 *    --veil  0~1  멀수록 크림색 안개 (대기 원근)
 *    --sheen 0~1  표지 위 광택 띠의 가로 위치
 *  opacity·filter를 쓰면 preserve-3d가 평면화되므로 '겹치기' 방식만 쓴다. */

const shade = (hex: string, amt: number) => {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)))
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

/** 멀리 있는 책을 배경색으로 물러나게 하는 안개 — 각 면마다 한 장씩.
 *  배경이 크림이 아닌 화면(궤도 홈=흰 배경)은 --veil-color 로 갈아끼운다 */
const Veil = () => (
  <i style={{ position: 'absolute', inset: 0, background: 'var(--veil-color, #fff8ec)', opacity: 'var(--veil, 0)', pointerEvents: 'none' }} />
)

export default function Book3D({ book, w, h, t = 7 }: { book: BookSummary; w: number; h: number; t?: number }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(book.bookId)
  const hasImg = Boolean(book.coverUrl) && !broken
  const r = Math.max(2, w * 0.035)

  return (
    <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}>
      {/* 책등 — 왼쪽 모서리에서 뒤(-z)로 t만큼. 옆에서 볼 때만 보인다 */}
      <div style={{
        position: 'absolute', left: 0, top: 0, width: t, height: h,
        transformOrigin: '0% 50%', transform: 'rotateY(90deg)',
        background: `linear-gradient(90deg, ${shade(c.bg, -0.16)}, ${c.bg} 45%, ${shade(c.bg, -0.3)})`,
        borderRadius: `${r}px 0 0 ${r}px`,
      }}>
        {/* 제본 띠 — 위아래 얇은 선이 '책등'이라는 신호를 준다 */}
        <i style={{ position: 'absolute', inset: `${h * 0.06}px 0`, borderTop: `1px solid ${shade(c.fg, -0.1)}55`, borderBottom: `1px solid ${shade(c.fg, -0.1)}55` }} />
        <Veil />
      </div>

      {/* 책배 — 종이 단면. 1px 줄무늬가 '종이 뭉치'로 읽히게 한다 */}
      <div style={{
        position: 'absolute', right: 0, top: 0, width: t, height: h,
        transformOrigin: '100% 50%', transform: 'rotateY(-90deg)',
        background: 'repeating-linear-gradient(180deg, #fffdf6 0 1px, #e3d9c2 1px 2px)',
        borderRadius: `0 ${r}px ${r}px 0`,
      }}>
        <Veil />
      </div>

      {/* 앞표지 */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        borderRadius: `${r}px ${r * 1.8}px ${r * 1.8}px ${r}px`,
        background: c.bg, color: c.fg,
        boxShadow: `inset 0 0 0 1px rgba(34,34,74,0.10), ${w * 0.03}px ${w * 0.05}px ${w * 0.14}px rgba(34,34,74,0.28)`,
      }}>
        {hasImg ? (
          <img src={book.coverUrl!} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false}
            onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, padding: w * 0.1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <span style={{ fontSize: Math.max(7, w * 0.115), fontWeight: 700, lineHeight: 1.25, overflow: 'hidden' }}>{book.title}</span>
            {w > 70 && <span style={{ fontSize: Math.max(6, w * 0.085), opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.author}</span>}
          </div>
        )}
        {/* 책등 쪽 접힘 그림자 — 표지가 '넘어가는' 면이라는 단서 */}
        <i style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w * 0.09, background: 'linear-gradient(90deg, rgba(0,0,0,0.30), rgba(0,0,0,0))', pointerEvents: 'none' }} />
        {/* 광택 — 회전에 따라 가로로 흐른다 */}
        <i style={{
          position: 'absolute', top: '-25%', bottom: '-25%', left: '-70%', right: '-70%',
          background: 'linear-gradient(102deg, transparent 43%, rgba(255,255,255,0.42) 50%, transparent 57%)',
          transform: 'translateX(calc(var(--sheen, 0.5) * 78% - 39%))', pointerEvents: 'none',
        }} />
        <Veil />
      </div>
    </div>
  )
}
