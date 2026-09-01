import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { BookSummary } from '../api/types'
import Book3D from './Book3D'

/** 3D 원통 궤도 — 책들이 중앙을 공전한다.
 *
 *  품질의 핵심 4가지:
 *   1) 평면 원(translateX)이 아니라 원통(translateZ + perspective) — 앞뒤로 오가야 깊이가 생긴다
 *   2) CSS 키프레임 대신 각도 하나(rot)를 rAF로 적분 — 속도를 바꿔도 점프가 없다
 *   3) dt 곱셈 + 지수 감쇠 — 60/120/144Hz에서 같은 속도, 같은 감속
 *   4) 깊이(z)에서 안개·크기·그림자·z-index를 전부 파생 — 앞책이 항상 위로 온다
 *
 *  React 리렌더는 '포커스 책이 바뀔 때'만. 매 프레임은 ref로 DOM에 직접 쓴다. */

const DEG = Math.PI / 180
const AMBIENT = 7          // deg/s — 가만히 둘 때의 표류 속도
const AMBIENT_HOVER = 1.4  // 마우스를 올리면 거의 멈춘다 (읽으라고)
const FRICTION = 2.4       // 1/s — 관성이 표류 속도로 수렴하는 세기
const DRAG_PER_PX = 0.32   // 드래그 1px → 회전 deg
const FLING_MAX = 420      // deg/s
const SNAP_STIFF = 120
const SNAP_DAMP = 19       // 2*sqrt(120)=21.9 → 살짝 언더댐프 = 기분 좋은 오버슛
const DWELL_MS = 1400      // 스냅 직후 잠깐 멈춤 — 사용자가 고른 책을 바로 흘려보내지 않는다

/** -180~180 으로 정규화 — 스냅이 항상 최단 경로로 돌게 하는 한 줄 */
const norm180 = (a: number) => ((a % 360) + 540) % 360 - 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface OrbitHandle { snapTo: (index: number) => void }

interface Props {
  books: BookSummary[]
  /** 깊이 반지름(z) — 앞뒤로 오가는 거리. 원근 배율을 결정한다 */
  radius: number
  /** 가로 반지름(x). radius보다 크게 주면 넓은 화면을 채우는 납작한 타원 궤도가 된다 */
  radiusX?: number
  /** 무대 기울기(deg, 음수 = 위에서 내려다봄). 책은 이 각을 되돌려 똑바로 선다 */
  tilt?: number
  bookW?: number
  bookH?: number
  thickness?: number
  /** 무대 평면의 세로 위치 — 앞줄 책이 아래 텍스트를 덮지 않도록 페이지가 조절한다 */
  planeY?: string
  /** true인 책은 흐려진다 — 태그 필터용 */
  dimmed?: boolean[]
  onFocusChange?: (index: number) => void
  onOpen?: (index: number) => void
}

const BookOrbit = forwardRef<OrbitHandle, Props>(function BookOrbit(
  { books, radius, radiusX, tilt = -26, bookW = 62, bookH = 90, thickness = 7, planeY = '58%', dimmed, onFocusChange, onOpen }, ref,
) {
  const n = books.length
  const step = n > 0 ? 360 / n : 0
  const rx = radiusX ?? radius

  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const bookRefs = useRef<(HTMLDivElement | null)[]>([])
  const shadowRefs = useRef<(HTMLDivElement | null)[]>([])

  const rot = useRef(0)
  const vel = useRef(AMBIENT)
  const snap = useRef<number | null>(null)
  const snapVel = useRef(0)
  const hovering = useRef(false)
  const dwellUntil = useRef(0)
  const reduced = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const drag = useRef<{ id: number; lastX: number; lastT: number; v: number; moved: number } | null>(null)
  const focus = useRef(-1)

  // 콜백·파생값은 ref로 — rAF 루프가 리렌더에 의존하지 않게 한다
  const dimRef = useRef<boolean[] | undefined>(dimmed)
  dimRef.current = dimmed
  const focusCb = useRef(onFocusChange)
  focusCb.current = onFocusChange
  const openCb = useRef(onOpen)
  openCb.current = onOpen

  /** 현재 각도로 전 항목의 transform을 계산해 DOM에 직접 쓴다 (setState 없음) */
  const paint = useCallback(() => {
    for (let i = 0; i < n; i++) {
      const el = itemRefs.current[i]
      const bk = bookRefs.current[i]
      const sh = shadowRefs.current[i]
      if (!el || !bk || !sh) continue

      const a = (i * step + rot.current) * DEG
      const x = Math.sin(a) * rx
      const z = Math.cos(a) * radius
      const t = (z / radius + 1) / 2                 // 0 = 맨 뒤, 1 = 맨 앞
      const dim = dimRef.current?.[i] ? 1 : 0

      el.style.transform = `translate3d(${x.toFixed(2)}px, 0px, ${z.toFixed(2)}px)`
      // perspective가 크기는 알아서 줄여준다. z-index만 정확히 — 뒷책이 앞책 위로 새는 걸 막는다
      el.style.zIndex = String(Math.round(t * 1000))
      el.style.setProperty('--veil', clamp(0.74 * (1 - t) ** 1.3 + dim * 0.5, 0, 0.92).toFixed(3))
      el.style.setProperty('--sheen', (0.5 + 0.5 * Math.sin(a)).toFixed(3))

      // 링에 접하도록 살짝 틀어 책등·책배를 노출 — 두께가 보이는 순간 '물체'가 된다
      const ry = (x / rx) * 24
      const k = (1 + 0.24 * t ** 5) * (dim ? 0.9 : 1)   // 맨 앞 한 권만 확실히 커진다
      bk.style.transform = `rotateX(${-tilt}deg) rotateY(${ry.toFixed(2)}deg) scale(${k.toFixed(3)})`
      sh.style.opacity = (0.42 * t ** 2.5 * (dim ? 0.35 : 1)).toFixed(3)
    }

    // 정면에 가장 가까운 책 = 포커스. 바뀔 때만 리렌더를 유발한다
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(norm180(i * step + rot.current))
      if (d < bestD) { bestD = d; best = i }
    }
    if (best !== focus.current) {
      focus.current = best
      // ARIA는 리렌더 없이 여기서 갱신 — 매 프레임 setState 하지 않겠다는 원칙과 같은 이유
      rootRef.current?.setAttribute('aria-activedescendant', `orbit-opt-${books[best]?.bookId}`)
      bookRefs.current.forEach((b, j) => b?.setAttribute('aria-selected', String(j === best)))
      focusCb.current?.(best)
    }
  }, [n, step, radius, rx, tilt, books])

  const snapTo = useCallback((i: number) => {
    // 절대 목표각을 '현재 위치에서 최단 경로'로 잡는다 — 한 바퀴 도는 고전 버그 방지
    const target = rot.current + norm180(-i * step - rot.current)
    if (reduced.current) {
      // 모션을 끈 사용자에게도 방향키·클릭은 동작해야 한다 (루프가 없으니 즉시 이동 + 1회 렌더)
      rot.current = target
      snap.current = null
      paint()
      return
    }
    snap.current = target
    snapVel.current = vel.current
  }, [step, paint])

  useImperativeHandle(ref, () => ({ snapTo }), [snapTo])

  useEffect(() => {
    if (n === 0) return
    reduced.current = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced.current) { vel.current = 0; paint(); return }

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)   // 탭 복귀 시 폭주 방지
      last = now
      if (snap.current !== null) {
        const d = snap.current - rot.current
        snapVel.current += (d * SNAP_STIFF - snapVel.current * SNAP_DAMP) * dt
        rot.current += snapVel.current * dt
        if (Math.abs(d) < 0.08 && Math.abs(snapVel.current) < 0.6) {
          rot.current = snap.current
          snap.current = null
          snapVel.current = 0
          vel.current = 0
          dwellUntil.current = now + DWELL_MS
        }
      } else if (!drag.current) {
        // 지수 감쇠 — v *= 0.95 와 달리 프레임레이트에 결과가 좌우되지 않는다
        const target = now < dwellUntil.current ? 0 : hovering.current ? AMBIENT_HOVER : AMBIENT
        vel.current += (target - vel.current) * (1 - Math.exp(-FRICTION * dt))
        rot.current += vel.current * dt
      }
      paint()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [n, paint])

  // radius(리사이즈)·dim(태그 필터)이 바뀌면 즉시 다시 그린다 — reduced-motion에서도 유효
  useEffect(() => { paint() }, [paint, dimmed])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, lastX: e.clientX, lastT: performance.now(), v: 0, moved: 0 }
    snap.current = null
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const now = performance.now()
    const dx = e.clientX - d.lastX
    const dt = Math.max((now - d.lastT) / 1000, 1 / 240)
    const dDeg = dx * DRAG_PER_PX
    rot.current += dDeg
    d.v = d.v * 0.7 + (dDeg / dt) * 0.3   // 스무딩한 순간 속도 = 놓았을 때의 관성
    d.moved += Math.abs(dx)
    d.lastX = e.clientX
    d.lastT = now
  }
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    vel.current = clamp(d.v, -FLING_MAX, FLING_MAX)
    // 클릭 억제 판정을 위해 한 틱 뒤에 비운다
    const moved = d.moved
    drag.current = null
    if (moved > 5) {
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 0)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); snapTo((focus.current + 1) % n) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); snapTo((focus.current - 1 + n) % n) }
    else if (e.key === 'Enter') { e.preventDefault(); openCb.current?.(focus.current) }
  }

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-label="추천 도서 궤도"
      tabIndex={0}
      className="absolute inset-0 outline-none touch-none select-none cursor-grab active:cursor-grabbing"
      style={{ perspective: 1300, perspectiveOrigin: '50% 45%' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => { hovering.current = true }}
      onMouseLeave={() => { hovering.current = false }}
      onWheel={(e) => { snap.current = null; vel.current = clamp(vel.current - e.deltaY * 0.14, -FLING_MAX, FLING_MAX) }}
      onKeyDown={onKeyDown}
    >
      {/* 회전 무대 — 위에서 내려다보는 턴테이블 */}
      <div className="absolute left-1/2" style={{ top: planeY, transformStyle: 'preserve-3d', transform: `rotateX(${tilt}deg)` }}>
        {/* 궤도선 — 기울어진 평면에 누운 원이라 화면에서는 타원으로 보인다.
            '돌고 있다'를 한 프레임만 봐도 알게 해 주는 값싼 단서 */}
        <div style={{
          position: 'absolute', left: -rx, top: -radius, width: rx * 2, height: radius * 2,
          borderRadius: '50%', border: '1px dashed rgba(34,34,74,0.13)', pointerEvents: 'none',
        }} />
        {books.map((book, i) => (
          <div key={book.bookId} ref={(el) => { itemRefs.current[i] = el }}
            className="absolute" style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}>
            {/* 접지 그림자 — 무대 평면에 그대로 누워 있어야 '바닥에 놓인 책'이 된다 */}
            <div ref={(el) => { shadowRefs.current[i] = el }}
              style={{
                position: 'absolute', left: -bookW * 0.66, top: -5, width: bookW * 1.32, height: 11,
                borderRadius: '50%', opacity: 0, pointerEvents: 'none',
                background: 'radial-gradient(50% 50% at 50% 50%, rgba(34,34,74,0.55), rgba(34,34,74,0) 72%)',
              }} />
            {/* 책 — 밑변을 축으로 세워 둔다 */}
            <div ref={(el) => { bookRefs.current[i] = el }}
              id={`orbit-opt-${book.bookId}`}
              role="option"
              aria-selected={false}
              aria-label={`${book.title}${book.author ? ` · ${book.author}` : ''}`}
              onClick={() => {
                if (suppressClick.current) return
                if (focus.current === i) openCb.current?.(i)
                else snapTo(i)
              }}
              style={{
                position: 'absolute', left: -bookW / 2, top: -bookH, width: bookW, height: bookH,
                transformStyle: 'preserve-3d', transformOrigin: '50% 100%', cursor: 'pointer',
              }}>
              <Book3D book={book} w={bookW} h={bookH} t={thickness} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

export default BookOrbit
