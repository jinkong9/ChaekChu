import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import type { RecommendationItem } from '../api/types'
import BookCover from './BookCover'
import { glassine, GLASS_LINE } from '../lib/glassine'

/** 2위 이하 추천 한 통 — 표지를 그대로 늘어놓는 대신 '아직 뜯지 않은 편지'로 세운다.
 *  봉투는 유산지라 안에 든 표지가 흐릿하게 비치고, hover(=봉투를 집는 순간)에 그 표지가 또렷해지며 위로 솟는다.
 *  z축은 열린 플랩(뒤) < 표지 < 봉투 앞면 순서로 고정 — 앞면이 반투명이라 '가려짐'이 아니라 '비침'이 된다. */

const INK = '#2b3a86'

export default function Envelope({ item, onClick }: { item: RecommendationItem; onClick?: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <Link to={`/books/${item.book.bookId}?from=rec`} onClick={onClick}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      className="block outline-none">
      <motion.div className="relative" animate={{ y: open ? -6 : 0 }} transition={{ type: 'spring', stiffness: 280, damping: 22 }}>
        {/* 열린 플랩 — 봉투 위로 젖혀진 삼각형 (z0) */}
        <div style={{ height: 30, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)', ...glassine(0.5), filter: 'drop-shadow(0 1px 1px rgba(34,34,74,0.2))' }} />

        <div className="relative" style={{ aspectRatio: '1.18 / 1' }}>
          {/* 안에 든 표지 (z10) — 평소엔 유산지 너머로 흐릿하게, hover에 위로 솟아 또렷해진다 */}
          <motion.div className="absolute left-1/2 bottom-2 z-10 -translate-x-1/2"
            animate={{ y: open ? '-52%' : '0%', filter: open ? 'blur(0px)' : 'blur(3px)' }}
            transition={{ type: 'spring', stiffness: 220, damping: 24 }}>
            <BookCover book={item.book} size="md" />
          </motion.div>

          {/* 봉투 앞면 (z20) — 유산지 한 겹. 아래 접힘 한 장과 양옆 접힌 선만 남긴 간결한 면 */}
          <div className="absolute inset-0 z-20 rounded-[3px] overflow-hidden"
            style={{
              ...glassine(0.62),
              boxShadow: open
                ? `0 14px 24px -12px rgba(34,34,74,0.3), 0 0 0 1px ${GLASS_LINE} inset`
                : `0 6px 14px -10px rgba(34,34,74,0.26), 0 0 0 1px ${GLASS_LINE} inset`,
            }}>
            <svg viewBox="0 0 100 85" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
              {/* 아래 접힘 — 종이가 한 겹 더 겹친 만큼만 밝게 */}
              <path d="M0 85 L50 44 L100 85 Z" fill="rgba(255,255,255,0.45)" />
              <path d="M0 0 L50 44 L100 0" fill="none" stroke={GLASS_LINE} strokeWidth="0.5" />
              <path d="M0 85 L50 44 L100 85" fill="none" stroke={GLASS_LINE} strokeWidth="0.5" />
            </svg>
            {/* 앞면 여백에 손글씨로 적은 제목 — 봉투에 적힌 수신인 자리 */}
            <p className="font-hand absolute left-3 right-3 text-center leading-tight line-clamp-2"
              style={{ color: INK, fontSize: 15, top: '18%' }}>
              {item.book.title}
            </p>
            {/* 밀랍 인장 = 순위 (네 접힘이 만나는 자리) */}
            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full font-bold text-[11px] text-white"
              style={{ top: '52%', width: 24, height: 24, background: 'var(--color-accent)', boxShadow: '0 1px 3px rgba(34,34,74,0.4)' }}>
              {item.rank}
            </span>
          </div>
        </div>
      </motion.div>

      {/* 태그 = 이 편지의 요약 이유 (2줄 수용 고정 높이로 카드 높이 정렬) */}
      <div className="mt-2 h-11 flex gap-1 flex-wrap content-start justify-center">
        {item.tags.slice(0, 2).map((t) => (
          <span key={t} className="rounded-full border border-primary/25 px-2 py-0.5 text-[11px] text-gray-500">{t}</span>
        ))}
      </div>
    </Link>
  )
}
