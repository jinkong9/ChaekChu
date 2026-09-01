import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence, type Variants } from 'motion/react'
import { api } from '../api/client'
import type { LibraryItem } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { useAuthStore } from '../stores/authStore'
import BookCover from '../components/BookCover'

/** 홈 = 허브. 거대 타이포 메뉴 4줄이 화면의 전부이고, hover하면 그 섹션의
 *  살아있는 미리보기가 우측에 스프링으로 떠오른다. (대시보드 아님 — 데이터는 프리뷰 재료로만) */

type MenuKey = 'recommend' | 'library' | 'dna' | 'search'
const MENU: { key: MenuKey; no: string; label: string; to: string; desc: string }[] = [
  { key: 'recommend', no: '01', label: '추천', to: '/recommend', desc: '오늘의 한 권, 이유와 함께' },
  { key: 'library', no: '02', label: '내 서재', to: '/library', desc: '읽고 싶은 마음이 쌓이는 곳' },
  { key: 'dna', no: '03', label: 'BOOK DNA', to: '/dna', desc: '내 취향의 지도' },
  { key: 'search', no: '04', label: '검색', to: '/search', desc: '205만 권 속에서' },
]

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }
const rise: Variants = {
  hidden: { opacity: 0, y: 34 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 220, damping: 24 } },
}
const pop = {
  initial: { opacity: 0, y: 18, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 22 } },
  exit: { opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.12 } },
} as const

export default function HomePageSimple() {
  const nickname = useAuthStore((s) => s.nickname)
  const [active, setActive] = useState<MenuKey | null>(null)
  const { data: rec } = useRecommendations()
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

  const top = rec?.items[0]
  const all = library ?? []
  const recent = all.slice(0, 3)
  const keywords = [...new Set((rec?.items ?? []).flatMap((i) => i.tags))].slice(0, 6)

  return (
    <main className="relative overflow-hidden" style={{ minHeight: 'calc(100vh - 62px)', fontFamily: "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', sans-serif" }}>
      {/* 배경 — 랜딩의 오로라 혈통을 아주 옅게 */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(60vw 60vw at 85% 20%, rgba(255,209,102,0.16), transparent 60%), radial-gradient(50vw 50vw at 10% 90%, rgba(255,107,74,0.10), transparent 60%)' }} />

      <div className="relative max-w-5xl mx-auto px-8 py-12 grid grid-cols-[1.25fr_1fr] gap-12 items-center" style={{ minHeight: 'calc(100vh - 62px)' }}>
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.p variants={rise} className="text-sm text-gray-400">
            {nickname ?? '독자'}님, 오늘은 어디로 갈까요
          </motion.p>

          <nav className="mt-6">
            {MENU.map((m) => (
              <motion.div key={m.key} variants={rise}>
                <Link to={m.to}
                  onMouseEnter={() => setActive(m.key)} onMouseLeave={() => setActive(null)}
                  className="group flex items-center gap-5 py-4 border-b border-primary/15">
                  <span className="text-xs text-gray-300 font-mono w-6">{m.no}</span>
                  <motion.span
                    className={`font-extrabold leading-none tracking-tight transition-colors ${active === m.key ? 'text-accent' : 'text-primary'}`}
                    animate={{ x: active === m.key ? 14 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  >
                    <span className="whitespace-nowrap" style={{ fontSize: 'clamp(40px, 5.2vw, 64px)', letterSpacing: '-0.03em' }}>{m.label}</span>
                  </motion.span>
                  <span className={`ml-auto text-sm transition-opacity ${active === m.key ? 'opacity-100 text-accent' : 'opacity-0'}`}>
                    {m.desc} →
                  </span>
                </Link>
              </motion.div>
            ))}
          </nav>
        </motion.div>

        {/* 우측 프리뷰 — hover된 섹션의 살아있는 미리보기 */}
        <div className="relative hidden lg:block">
          <AnimatePresence mode="wait">
            {active === 'recommend' && top && (
              <motion.div key="p-rec" {...pop} className="flex flex-col items-center text-center">
                <motion.div whileHover={{ rotateY: -8, scale: 1.03 }} style={{ perspective: 500 }}>
                  <BookCover book={top.book} size="lg" />
                </motion.div>
                <p className="mt-4 font-bold">{top.book.title}</p>
                <div className="mt-2 flex gap-1.5 flex-wrap justify-center">
                  {top.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full border border-accent/50 text-accent px-2 py-0.5 text-xs">{t}</span>)}
                </div>
              </motion.div>
            )}
            {active === 'library' && recent.length > 0 && (
              <motion.div key="p-lib" {...pop} className="flex flex-col items-center">
                <div className="flex">
                  {recent.map((li, i) => (
                    <motion.div key={li.libraryItemId} initial={{ rotate: 0 }} animate={{ rotate: (i - 1) * 7, y: Math.abs(i - 1) * 6 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 18 }} className={i > 0 ? '-ml-10' : ''}>
                      <BookCover book={li.book} size="md" />
                    </motion.div>
                  ))}
                </div>
                <p className="mt-5 text-sm text-gray-500"><b className="text-primary">{all.length}권</b>이 쌓여 있어요</p>
              </motion.div>
            )}
            {active === 'dna' && (
              <motion.div key="p-dna" {...pop} className="flex flex-wrap gap-2 justify-center content-start">
                {keywords.map((t, i) => (
                  <motion.span key={t} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 16 }}
                    className={`rounded-full px-3 py-1.5 text-sm font-bold ${i % 2 ? 'bg-primary text-white' : 'border-2 border-accent text-accent'}`}>
                    {t}
                  </motion.span>
                ))}
                <p className="w-full text-center mt-4 text-sm text-gray-500">기록이 쌓일수록 선명해져요</p>
              </motion.div>
            )}
            {active === 'search' && (
              <motion.div key="p-search" {...pop} className="text-center">
                <p className="font-extrabold text-primary" style={{ fontSize: 56, letterSpacing: '-0.02em' }}>2,050,000</p>
                <p className="text-sm text-gray-500 mt-1">권의 책이 기다리고 있어요</p>
              </motion.div>
            )}
            {active === null && top && (
              <motion.div key="p-idle" {...pop} className="sticky top-24 pt-10 flex flex-col items-center opacity-70">
                <BookCover book={top.book} size="lg" />
                <p className="mt-3 text-xs text-gray-400">오늘의 한 권 — 메뉴에 올려보세요</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  )
}
