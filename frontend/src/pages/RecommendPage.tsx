import { useState } from 'react'
import RecommendPageBasic from './RecommendPageBasic'
import RecommendPageLetter from './RecommendPageLetter'
import RecommendPageArchive from './RecommendPageArchive'

/** 추천 시안 토글 (팀 비교용 — 홈과 같은 방식. 확정되면 한쪽만 남기고 이 파일 정리) */
const VARIANTS = [
  { key: 'basic', label: 'A 기본' },
  { key: 'letter', label: 'B 편지' },
  { key: 'archive', label: 'C 우표첩' },
] as const

type Variant = (typeof VARIANTS)[number]['key']

export default function RecommendPage() {
  const [variant, setVariant] = useState<Variant>('archive')
  return (
    <div className="relative">
      <div className="absolute right-6 top-4 z-40 flex overflow-hidden rounded-full border-2 border-primary bg-white text-xs">
        {VARIANTS.map((v) => (
          <button key={v.key} onClick={() => setVariant(v.key)}
            className={`px-3 py-1 font-bold ${variant === v.key ? 'bg-primary text-white' : 'text-gray-400'}`}>
            {v.label}
          </button>
        ))}
      </div>
      {variant === 'basic' && <RecommendPageBasic />}
      {variant === 'letter' && <RecommendPageLetter />}
      {variant === 'archive' && <RecommendPageArchive />}
    </div>
  )
}
