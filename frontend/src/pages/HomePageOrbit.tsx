import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../api/client'
import { useRecommendations } from '../lib/useRecommendations'
import { trackEvent } from '../lib/events'
import { useAuthStore } from '../stores/authStore'
import BookOrbit, { type OrbitHandle } from '../components/BookOrbit'

/** 홈 C안 — 궤도 허브. 추천 덱이 중앙을 공전하고, 정면에 온 책이 곧 화면의 주인공이 된다.
 *  레퍼런스(CLOU Architects)의 구조를 그대로: 링은 목록, 가운데는 지금 보고 있는 것 하나.
 *
 *  움직이는 것은 궤도 하나뿐이다 — 랜딩의 오로라·먼지를 여기 겹치지 않는 것도 설계 결정.
 *  배경까지 같이 움직이면 궤도가 눈에 안 들어온다. */

const MENU = [
  { to: '/recommend', label: '추천' },
  { to: '/library', label: '내 서재' },
  { to: '/dna', label: 'BOOK DNA' },
  { to: '/search', label: '검색' },
]

const GNB_H = 62

/** 화면 크기에 맞춘 궤도 반지름 — 세로가 좁으면 링이 먼저 줄어야 가운데 타이포가 산다 */
function useOrbitSize() {
  const [size, setSize] = useState(() => ({ w: 1280, h: 800 }))
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight - GNB_H })
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  // 깊이(z)는 세로 여백이, 가로(x)는 화면 폭이 결정한다 — 넓은 모니터에서 링이 옆으로 퍼지게
  const radius = Math.max(200, Math.min(size.w * 0.30, size.h * 0.34, 360))
  const radiusX = Math.max(radius, Math.min(size.w * 0.34, 520))
  const bookW = Math.round(radius * 0.30)
  return { radius, radiusX, bookW, bookH: Math.round(bookW * 1.45), h: size.h }
}

export default function HomePageOrbit() {
  const nickname = useAuthStore((s) => s.nickname)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isPending } = useRecommendations()
  const orbit = useRef<OrbitHandle>(null)
  const { radius, radiusX, bookW, bookH, h } = useOrbitSize()

  const [focus, setFocus] = useState(0)
  const [tag, setTag] = useState<string | null>(null)
  const [wished, setWished] = useState<number[]>([])

  const items = useMemo(() => data?.items ?? [], [data])
  const books = useMemo(() => items.map((it) => it.book), [items])
  const tags = useMemo(() => [...new Set(items.flatMap((it) => it.tags))].slice(0, 6), [items])
  // 태그를 고르면 안 맞는 책이 안개 속으로 물러난다 — 레퍼런스의 'sector 정렬'을 필터로 옮긴 것
  const dimmed = useMemo(() => (tag ? items.map((it) => !it.tags.includes(tag)) : undefined), [items, tag])

  const current = items[focus]

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
    setWished((w) => [...w, current.book.bookId])
    api.post('/library', { bookId: current.book.bookId, status: 'WISH' })
      .then(() => qc.invalidateQueries({ queryKey: ['library'] }))
      .catch(() => setWished((w) => w.filter((id) => id !== current.book.bookId)))
  }

  const stage = { height: `calc(100vh - ${GNB_H}px)`, minHeight: 620 }
  const font = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif"

  if (isPending) {
    return <main className="grid place-items-center text-gray-400" style={stage}>추천을 불러오는 중…</main>
  }
  if (books.length === 0) {
    return <main className="grid place-items-center text-gray-400" style={stage}>아직 보여 드릴 책이 없어요.</main>
  }

  return (
    <main className="relative overflow-hidden" style={{ ...stage, fontFamily: font }}>
      {/* 배경 — 정지된 한 겹. 궤도가 유일한 움직임이어야 한다 */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(70% 55% at 50% 34%, rgba(255,209,102,0.20), transparent 70%), radial-gradient(50% 40% at 50% 100%, rgba(255,107,74,0.10), transparent 70%)',
      }} />

      <BookOrbit ref={orbit} books={books} radius={radius} radiusX={radiusX} bookW={bookW} bookH={bookH}
        thickness={Math.max(5, Math.round(bookW * 0.11))} planeY="56%" dimmed={dimmed}
        onFocusChange={setFocus} onOpen={open} />

      {/* ===== 상단 — 인사 + 태그(섹터) 필터 ===== */}
      <div className="pointer-events-none absolute left-0 top-0 z-20 max-w-[48%] px-8 pt-6">
        <p className="text-sm text-gray-400">{nickname ?? '독자'}님, 오늘의 궤도예요</p>
        <div className="pointer-events-auto mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                tag === t ? 'border-accent bg-accent font-bold text-white' : 'border-primary/20 text-gray-500 hover:border-accent hover:text-accent'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 가운데 — 정면에 온 책의 이름. 뒷줄 책들 '위'에 두어 겹치지 않게 한다.
           서 있는 책은 밑변보다 위로 한참 올라오므로 링 안쪽 여백은 생각보다 좁다 ===== */}
      <div className="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center px-8 text-center"
        style={{ top: h < 760 ? '11%' : '13%' }}>
        <AnimatePresence mode="wait">
          {current && (
            <motion.div key={current.book.bookId}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className="flex flex-col items-center">
              <span className="rounded-full border-2 border-primary px-2.5 py-0.5 text-[11px] font-bold tracking-wider">
                TOP {current.rank}
              </span>
              <h1 className="mt-3 max-w-[18ch] font-extrabold leading-[1.1] text-primary"
                style={{ fontSize: 'clamp(30px, 4vw, 52px)', letterSpacing: '-0.035em' }}>
                {current.book.title}
              </h1>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {current.tags.map((t) => (
                  <span key={t} className="rounded-full border border-accent/45 bg-cream/70 px-2 py-0.5 text-xs text-accent">{t}</span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ===== 하단 — 서지 + 추천 이유 + 행동. 링 앞줄 아래라 표지에 가리지 않는다 ===== */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-8 pb-6">
        <AnimatePresence mode="wait">
          {current && (
            <motion.div key={current.book.bookId}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
              className="flex flex-col items-center gap-1">
              <p className="text-xs text-gray-400">
                {current.book.author}
                {current.book.publisher ? ` · ${current.book.publisher}` : ''}
                {current.book.publicationYear ? ` · ${current.book.publicationYear}` : ''}
                {current.book.pageCount ? ` · ${current.book.pageCount}쪽` : ''}
              </p>
              <p className="max-w-xl text-center text-sm leading-relaxed text-gray-600">{current.reasonText}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2">
          <button onClick={() => open(focus)}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5">
            상세 보기
          </button>
          <button onClick={wish} disabled={!current || wished.includes(current.book.bookId)}
            className="rounded-full border-2 border-primary bg-cream px-6 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 disabled:border-primary/25 disabled:text-gray-400 disabled:hover:translate-y-0">
            {current && wished.includes(current.book.bookId) ? '찜했어요' : '찜하기'}
          </button>
        </div>

        <nav className="flex items-center gap-5 text-xs tracking-wide text-gray-400">
          {MENU.map((m) => (
            <Link key={m.to} to={m.to} className="transition-colors hover:text-accent">{m.label}</Link>
          ))}
          <span className="text-gray-300">·</span>
          <span className="text-[11px] text-gray-300">드래그해서 돌려보세요 · ← →</span>
        </nav>
      </div>
    </main>
  )
}
