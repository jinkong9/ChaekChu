import { useState } from 'react'
import type { BookSummary } from '../api/types'
import { coverPalette } from '../lib/coverPalette'

/** 공용 표지 카드 — coverUrl 있으면 이미지(핫링크), 없거나 깨지면 색 커버 폴백.
 *  서재·홈·추천이 공유. (LibraryPage의 내장 Cover는 추후 이걸로 통합) */
const SIZES = {
  lg: 'w-[150px] h-[214px]',
  md: 'w-[92px] h-[132px]',
  sm: 'w-12 h-[68px]',
} as const

export default function BookCover({ book, size = 'md' }: { book: BookSummary; size?: keyof typeof SIZES }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(book.bookId)
  const shadow = 'shadow-[3px_5px_14px_rgba(34,34,74,0.3)]'
  if (book.coverUrl && !broken) {
    return <img src={book.coverUrl} alt={book.title} referrerPolicy="no-referrer" loading="lazy"
      onError={() => setBroken(true)} className={`${SIZES[size]} ${shadow} object-cover rounded-r-md rounded-l-sm`} />
  }
  return (
    <div className={`${SIZES[size]} ${shadow} rounded-r-md rounded-l-sm flex flex-col justify-between p-1.5`}
      style={{ background: c.bg, color: c.fg }}>
      <span className={`font-bold leading-snug ${size === 'lg' ? 'text-sm line-clamp-5' : size === 'md' ? 'text-[11px] line-clamp-4' : 'text-[7px] line-clamp-3'}`}>{book.title}</span>
      {size !== 'sm' && <span className="text-[9px] opacity-80 truncate">{book.author}</span>}
    </div>
  )
}
