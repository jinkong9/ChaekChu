import { useState } from 'react'
import LibraryPageShelf from './LibraryPageShelf'
import LibraryPageB from './LibraryPageB'
import LibraryPageArchive from './LibraryPageArchive'

/** 내 서재 시안 토글 (팀 비교용 — 홈·추천과 같은 방식. 확정되면 한쪽만 남기고 이 파일 정리) */
const VARIANTS = [
  { key: 'shelf', label: 'A 선반' },
  { key: 'book', label: 'B 나의 책' },
  { key: 'archive', label: 'C 완독 기록' },
] as const

type Variant = (typeof VARIANTS)[number]['key']

export default function LibraryPage() {
  const [variant, setVariant] = useState<Variant>('book')
  return (
    <div className="relative flex flex-1 flex-col">
      <div className="absolute right-6 top-4 z-40 flex overflow-hidden rounded-full border-2 border-primary bg-white text-xs">
        {VARIANTS.map((v) => (
          <button key={v.key} onClick={() => setVariant(v.key)}
            className={`px-3 py-1 font-bold ${variant === v.key ? 'bg-primary text-white' : 'text-gray-400'}`}>
            {v.label}
          </button>
        ))}
      </div>
      {variant === 'shelf' && <LibraryPageShelf />}
      {variant === 'book' && <LibraryPageB />}
      {variant === 'archive' && <LibraryPageArchive />}
    </div>
  )
}
