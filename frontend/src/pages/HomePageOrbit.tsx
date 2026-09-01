import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../api/client'
import { useRecommendations } from '../lib/useRecommendations'
import { trackEvent } from '../lib/events'
import { useAuthStore } from '../stores/authStore'
import BookOrbit, { type OrbitHandle } from '../components/BookOrbit'
import BookCover from '../components/BookCover'

/** 홈 C안 — 궤도 허브. 추천 덱이 흰 무대 위를 공전하고, 가운데에는 서비스 이름만 남는다.
 *  레퍼런스(CLOU Architects)의 구조 그대로: 링은 목록, 가운데는 고정 워드마크,
 *  링 바깥 라벨이 섹터(우리는 추천 태그) 필터. 화면 안 메뉴는 두지 않는다 — GNB와 중복이다.
 *
 *  움직이는 것은 궤도 하나뿐이다 — 랜딩의 오로라·먼지를 여기 겹치지 않는 것도 설계 결정.
 *  배경까지 같이 움직이면 궤도가 눈에 안 들어온다. */

const GNB_H = 62
const PERSPECTIVE = 1300   // BookOrbit 과 같은 값 — 라벨·워드마크 위치를 여기서 역산한다
const PLANE_Y = 0.44       // 링 중심의 세로 위치

/** 화면 크기에 맞춘 궤도 기하.
 *  링은 크게, 책은 작게 — 그래야 가운데에 워드마크가 들어갈 구멍이 생긴다 (레퍼런스 구도).
 *  파생값(앞줄 밑변·뒷줄 밑변·구멍 중앙)까지 같이 계산해서 화면 요소를 거기에 맞춘다. */
function useOrbitGeometry() {
  const [size, setSize] = useState(() => ({ w: 1280, h: 800 }))
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight - GNB_H })
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const { w, h } = size
  const radiusX = Math.max(240, Math.min(w * 0.34, 520))
  const radiusY = Math.round(radiusX * 0.36)
  const depth = Math.max(180, Math.min(radiusX * 0.62, 340))
  const bookW = Math.round(Math.max(44, Math.min(radiusX * 0.13, h * 0.105)))
  const bookH = Math.round(bookW * 1.45)

  const near = PERSPECTIVE / (PERSPECTIVE - depth)   // 맨 앞 배율
  const far = PERSPECTIVE / (PERSPECTIVE + depth)    // 맨 뒤 배율
  const plane = h * PLANE_Y
  const frontTop = plane + radiusY * near - bookH * near * 1.24  // 앞줄 책 꼭대기
  const backBase = plane - radiusY * far                          // 뒷줄 책 밑변
  return {
    w, h, radiusX, radiusY, depth, bookW, bookH, plane, near, far,
    holeCenter: (backBase + frontTop) / 2,   // 워드마크·미리보기가 들어갈 자리
    holeHeight: frontTop - backBase,
  }
}

export default function HomePageOrbit() {
  const nickname = useAuthStore((s) => s.nickname)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isPending } = useRecommendations()
  const orbit = useRef<OrbitHandle>(null)
  const { w, radiusX, radiusY, depth, bookW, bookH, plane, holeCenter, holeHeight } = useOrbitGeometry()

  const [focus, setFocus] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [wished, setWished] = useState<number[]>([])

  const items = useMemo(() => data?.items ?? [], [data])
  const books = useMemo(() => items.map((it) => it.book), [items])
  // 섹터 라벨 = 태그 + 권수. 레퍼런스의 "Retail & Leisure (67)" 자리
  const sectors = useMemo(() => {
    const count = new Map<string, number>()
    items.forEach((it) => it.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)))
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [items])
  // 태그를 고르면 안 맞는 책이 안개 속으로 물러난다 — 레퍼런스의 sector 정렬을 필터로 옮긴 것
  const dimmed = useMemo(() => (tag ? items.map((it) => !it.tags.includes(tag)) : undefined), [items, tag])

  // 마우스를 올린 책이 있으면 그 책이 주인공, 없으면 정면에 온 책
  const activeIdx = hovered ?? focus
  const current = items[activeIdx]

  // 태그를 고르면 해당하는 첫 책을 정면으로 돌려 준다 (필터 결과를 바로 보여 주기)
  useEffect(() => {
    if (!tag) return
    const i = items.findIndex((it) => it.tags.includes(tag))
    if (i >= 0) orbit.current?.snapTo(i)
  }, [tag, items])

  const open = (i: number) => {
    const it = items[i]
    if (!it || !data) return
    trackEvent('CLICK', { bookId: it.book.bookId, recommendationId: data.recommendationId, rank: it.rank })
    navigate(`/books/${it.book.bookId}?from=home`)
  }

  const wish = () => {
    if (!current || !data) return
    trackEvent('WISH', { bookId: current.book.bookId, recommendationId: data.recommendationId, rank: current.rank })
    setWished((list) => [...list, current.book.bookId])
    api.post('/library', { bookId: current.book.bookId, status: 'WISH' })
      .then(() => qc.invalidateQueries({ queryKey: ['library'] }))
      .catch(() => setWished((list) => list.filter((id) => id !== current.book.bookId)))
  }

  const stage = { height: `calc(100vh - ${GNB_H}px)`, minHeight: 620 }
  const font = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif"

  if (isPending) {
    return <main className="grid place-items-center bg-white text-gray-400" style={stage}>추천을 불러오는 중…</main>
  }
  if (books.length === 0) {
    return <main className="grid place-items-center bg-white text-gray-400" style={stage}>아직 보여 드릴 책이 없어요.</main>
  }

  /** 섹터 라벨 — 그 각도에 선 책의 바로 위·바깥. 링 '윗쪽 호'에만 건다
   *  (아래쪽 호에는 서 있는 책과 하단 텍스트가 있어 자리가 없다). */
  const labelPos = (k: number, total: number) => {
    const deg = total === 1 ? 180 : 90 + (k / (total - 1)) * 180
    const a = (deg * Math.PI) / 180
    const sc = PERSPECTIVE / (PERSPECTIVE - Math.cos(a) * depth)
    return {
      left: w / 2 + Math.sin(a) * (radiusX * sc + 42),
      top: plane + Math.cos(a) * radiusY * sc - bookH * sc - 26,
    }
  }

  return (
    <main className="relative overflow-hidden bg-white"
      style={{ ...stage, fontFamily: font, ['--veil-color' as string]: '#ffffff' }}>

      <BookOrbit ref={orbit} books={books}
        radiusX={radiusX} radiusY={radiusY} depth={depth}
        bookW={bookW} bookH={bookH} thickness={Math.max(4, Math.round(bookW * 0.11))}
        planeY={`${PLANE_Y * 100}%`} dimmed={dimmed}
        onFocusChange={setFocus} onHoverChange={setHovered} onOpen={open} />

      {/* ===== 가운데 — 평소엔 워드마크, 책에 마우스를 올리면 그 책의 미리보기.
           레퍼런스의 'central preview image' 자리다. 링은 목록, 가운데는 지금 보는 것 하나 ===== */}
      {/* 워드마크와 미리보기를 같은 그리드 칸에 겹쳐 둔다 — mode="wait"로 순차 전환하면
          hover 반응이 한 박자 늦어 손이 느리게 느껴진다. 겹쳐서 교차 페이드 */}
      {/* inset-x-0 로 화면 폭을 다 쓴다 — left-1/2 로 두면 절대배치 요소가 오른쪽 절반만
          쓸 수 있어 좁은 화면에서 미리보기 카드의 글줄이 한 글자씩 끊긴다 */}
      <div className="pointer-events-none absolute inset-x-0 z-10 grid -translate-y-1/2 place-items-center px-8"
        style={{ top: holeCenter }}>
        <AnimatePresence>
          {hovered == null || !current ? (
            <motion.p key="wordmark"
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="col-start-1 row-start-1 whitespace-nowrap font-extrabold text-primary"
              style={{ fontSize: 'clamp(40px, 6.2vw, 92px)', letterSpacing: '-0.045em' }}>
              책추책책추
            </motion.p>
          ) : (
            <motion.div key={`preview-${current.book.bookId}`}
              initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="col-start-1 row-start-1 flex w-full max-w-[620px] items-center gap-6 rounded-2xl bg-white/95 px-7 py-6 shadow-[0_20px_60px_rgba(34,34,74,0.13)]">
              <div className="shrink-0">
                <BookCover book={current.book} size={holeHeight > 250 ? 'lg' : 'md'} />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[11px] font-bold tracking-wider text-accent">TOP {current.rank}</p>
                <h2 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight text-primary">{current.book.title}</h2>
                <p className="mt-1 text-xs text-gray-400">
                  {current.book.author}
                  {current.book.publisher ? ` · ${current.book.publisher}` : ''}
                  {current.book.publicationYear ? ` · ${current.book.publicationYear}` : ''}
                  {current.book.pageCount ? ` · ${current.book.pageCount}쪽` : ''}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {current.tags.map((t) => (
                    <span key={t} className="rounded-full border border-accent/45 px-2 py-0.5 text-[11px] text-accent">{t}</span>
                  ))}
                </div>
                <p className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-gray-600">{current.reasonText}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ===== 섹터 라벨 — 링 바깥. 고른 태그는 강조, 정면 책이 가진 태그는 잉크색 ===== */}
      {sectors.map(([t, n], k) => {
        const pos = labelPos(k, sectors.length)
        const isOn = tag === t
        const inCurrent = current?.tags.includes(t)
        return (
          <button key={t} onClick={() => setTag(isOn ? null : t)}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[13px] transition-colors ${
              isOn ? 'font-bold text-accent underline underline-offset-4'
                : inCurrent ? 'text-primary underline decoration-primary/30 underline-offset-4'
                : 'text-gray-400 hover:text-primary'
            }`}
            style={{ left: pos.left, top: pos.top }}>
            {t} <sup className="text-[10px] text-gray-400">({n})</sup>
          </button>
        )
      })}

      {/* ===== 좌상단 — 인사 한 줄. 나머지 내비게이션은 GNB가 이미 갖고 있다 ===== */}
      <p className="pointer-events-none absolute left-8 top-6 z-20 text-sm text-gray-400">
        {nickname ?? '독자'}님, 오늘의 궤도예요
      </p>

      {/* ===== 하단 — 정면 책의 이름·이유·행동 ===== */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-8 pb-10">
        <AnimatePresence mode="wait">
          {current && hovered == null && (
            <motion.div key={current.book.bookId}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="flex flex-col items-center gap-1">
              <p className="flex items-baseline gap-2">
                <span className="rounded-full border border-primary px-2 py-0.5 text-[10px] font-bold tracking-wider">TOP {current.rank}</span>
                <span className="text-lg font-bold text-primary">{current.book.title}</span>
                <span className="text-xs text-gray-400">
                  {current.book.author}
                  {current.book.publicationYear ? ` · ${current.book.publicationYear}` : ''}
                  {current.book.pageCount ? ` · ${current.book.pageCount}쪽` : ''}
                </span>
              </p>
              <p className="max-w-xl text-center text-sm leading-relaxed text-gray-500">{current.reasonText}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2">
          <button onClick={() => open(activeIdx)}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5">
            상세 보기
          </button>
          <button onClick={wish} disabled={!current || wished.includes(current.book.bookId)}
            className="rounded-full border-2 border-primary bg-white px-6 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 disabled:border-primary/25 disabled:text-gray-400 disabled:hover:translate-y-0">
            {current && wished.includes(current.book.bookId) ? '찜했어요' : '찜하기'}
          </button>
        </div>
      </div>
    </main>
  )
}
