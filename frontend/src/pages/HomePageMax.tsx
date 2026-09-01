import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react'
import { api } from '../api/client'
import type { LibraryItem } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { useAuthStore } from '../stores/authStore'
import BookCover from '../components/BookCover'

/** 홈 B안 (맥스) — 궤도형 허브: 추천 덱 표지들이 중앙을 공전하고,
 *  마우스를 따라 무대 전체가 기울며, 메뉴 hover에 중앙 무대가 반응한다.
 *  움직이는 오로라 + 먼지는 랜딩과 같은 혈통 */

type MenuKey = 'recommend' | 'library' | 'dna' | 'search'
const MENU: { key: MenuKey; label: string; to: string; desc: string }[] = [
  { key: 'recommend', label: '추천', to: '/recommend', desc: '오늘의 한 권, 이유와 함께' },
  { key: 'library', label: '내 서재', to: '/library', desc: '읽고 싶은 마음이 쌓이는 곳' },
  { key: 'dna', label: 'BOOK DNA', to: '/dna', desc: '내 취향의 지도' },
  { key: 'search', label: '검색', to: '/search', desc: '205만 권 속에서' },
]

const CSS = `
  @keyframes hub-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes hub-orbit-r { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
  .hub-ring { animation: hub-orbit 52s linear infinite; }
  .hub-ring.fast { animation-duration: 18s; }
  .hub-item { animation: hub-orbit-r 52s linear infinite; }
  .fast .hub-item { animation-duration: 18s; }
  @keyframes hub-blob1 { to { transform: translate(9vw, 7vh) scale(1.15); } }
  @keyframes hub-blob2 { to { transform: translate(-8vw, -6vh) scale(0.88); } }
  .hub-b1 { animation: hub-blob1 24s ease-in-out infinite alternate; }
  .hub-b2 { animation: hub-blob2 30s ease-in-out infinite alternate; }
  @keyframes hub-rise { from { transform: translateY(6vh); } to { transform: translateY(-105vh); } }
  .hub-dust { animation: hub-rise var(--dd) linear infinite; }
  @media (prefers-reduced-motion: reduce) { .hub-ring, .hub-item, .hub-b1, .hub-b2, .hub-dust { animation: none; } }
`

export default function HomePageMax() {
  const nickname = useAuthStore((s) => s.nickname)
  const [active, setActive] = useState<MenuKey | null>(null)
  const { data: rec } = useRecommendations()
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

  // 마우스 패럴랙스 — 무대 전체가 스프링으로 기울어짐
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 60, damping: 18 })
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), { stiffness: 60, damping: 18 })

  const deck = rec?.items ?? []
  const top = deck[0]
  const all = library ?? []
  const keywords = [...new Set(deck.flatMap((i) => i.tags))].slice(0, 5)

  return (
    <main
      className="relative overflow-hidden"
      style={{ minHeight: 'calc(100vh - 62px)', fontFamily: "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif" }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        mx.set((e.clientX - r.left) / r.width - 0.5)
        my.set((e.clientY - r.top) / r.height - 0.5)
      }}
    >
      <style>{CSS}</style>

      {/* 살아있는 배경 — 오로라 2 + 먼지 */}
      <div className="absolute inset-0 pointer-events-none" style={{ filter: 'blur(70px)', opacity: 0.5 }}>
        <div className="hub-b1 absolute rounded-full" style={{ width: '42vw', height: '42vw', background: '#ffd166', left: '-10vw', top: '-12vw' }} />
        <div className="hub-b2 absolute rounded-full" style={{ width: '36vw', height: '36vw', background: '#ff6b4a', right: '-8vw', bottom: '-10vw', opacity: 0.6 }} />
      </div>
      {Array.from({ length: 14 }, (_, i) => (
        <div key={i} className="hub-dust absolute rounded-full pointer-events-none"
          style={{ width: 2 + (i % 3), height: 2 + (i % 3), background: '#d9a13f', left: `${(i * 7.3) % 100}%`, top: `${60 + (i * 5) % 40}%`,
            opacity: 0.12 + (i % 4) * 0.07, ['--dd' as never]: `${18 + (i % 5) * 4}s`, animationDelay: `${-i * 2.1}s` }} />
      ))}

      <div className="relative h-full grid grid-cols-[1fr_1.1fr] items-center max-w-6xl mx-auto px-8" style={{ minHeight: 'calc(100vh - 62px)' }}>
        {/* ===== 좌: 인사 + 메뉴 ===== */}
        <div>
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-gray-400">
            {nickname ?? '독자'}님, 오늘은 어디로 갈까요
          </motion.p>
          <nav className="mt-5">
            {MENU.map((m, i) => (
              <motion.div key={m.key}
                initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.08 * i, type: 'spring', stiffness: 220, damping: 22 }}>
                <Link to={m.to}
                  onMouseEnter={() => setActive(m.key)} onMouseLeave={() => setActive(null)}
                  className="group block py-3.5 border-b border-primary/15">
                  <motion.span
                    animate={{ x: active === m.key ? 16 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                    className={`inline-block font-extrabold whitespace-nowrap transition-colors ${active === m.key ? 'text-accent' : 'text-primary'}`}
                    style={{ fontSize: 'clamp(36px, 4.6vw, 58px)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                    {m.label}
                  </motion.span>
                  <span className={`ml-4 text-sm transition-opacity ${active === m.key ? 'opacity-100 text-accent' : 'opacity-0'}`}>{m.desc} →</span>
                </Link>
              </motion.div>
            ))}
          </nav>
        </div>

        {/* ===== 우: 궤도 무대 — 표지들이 공전, 중앙은 hover에 반응 ===== */}
        <motion.div className="relative hidden lg:flex items-center justify-center" style={{ rotateX: rx, rotateY: ry, transformPerspective: 900, height: 560 }}>
          {/* 궤도 링 — hover 시 가속 */}
          <div className={`hub-ring absolute ${active ? 'fast' : ''}`} style={{ width: 460, height: 460 }}>
            <div className="absolute inset-0 rounded-full border border-primary/10" />
            {deck.slice(0, 6).map((item, i) => {
              const angle = (i / 6) * 360
              return (
                <div key={item.book.bookId} className="absolute left-1/2 top-1/2"
                  style={{ transform: `rotate(${angle}deg) translateX(230px) rotate(${-angle}deg)` }}>
                  <div className="hub-item -translate-x-1/2 -translate-y-1/2" style={{ animationDelay: 'inherit' }}>
                    <Link to={`/books/${item.book.bookId}?from=rec`} className="block hover:scale-110 transition-transform">
                      <BookCover book={item.book} size="sm" />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 중앙 무대 — 메뉴 hover에 따라 내용 교체 */}
          <div className="relative z-10 w-64 text-center">
            <AnimatePresence mode="wait">
              {(active === 'recommend' || active === null) && top && (
                <motion.div key="c-rec" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }} className="flex flex-col items-center">
                  <BookCover book={top.book} size="lg" />
                  <p className="mt-3 text-sm font-bold">{top.book.title}</p>
                  <p className="text-xs text-gray-400">오늘의 한 권</p>
                </motion.div>
              )}
              {active === 'library' && (
                <motion.div key="c-lib" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
                  <p className="font-extrabold text-primary" style={{ fontSize: 64 }}>{all.length}<span className="text-lg">권</span></p>
                  <p className="text-sm text-gray-500">읽고 싶은 마음이 쌓였어요</p>
                </motion.div>
              )}
              {active === 'dna' && (
                <motion.div key="c-dna" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
                  className="flex flex-wrap gap-2 justify-center">
                  {keywords.map((t, i) => (
                    <motion.span key={t} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 15 }}
                      className={`rounded-full px-3 py-1.5 text-sm font-bold ${i % 2 ? 'bg-primary text-white' : 'border-2 border-accent text-accent'}`}>{t}</motion.span>
                  ))}
                </motion.div>
              )}
              {active === 'search' && (
                <motion.div key="c-search" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}>
                  <p className="font-extrabold text-primary" style={{ fontSize: 44, letterSpacing: '-0.02em' }}>2,050,000</p>
                  <p className="text-sm text-gray-500">권이 기다리고 있어요</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </main>
  )
}
