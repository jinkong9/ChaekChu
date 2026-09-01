import { useState } from 'react'
import HomePageSimple from './HomePageSimple'
import HomePageMax from './HomePageMax'
import HomePageOrbit from './HomePageOrbit'

/** 홈 시안 토글 (팀 비교용 — 확정되면 한쪽만 남기고 이 파일 정리) */
const VARIANTS = [
  { key: 'simple', label: 'A 심플' },
  { key: 'max', label: 'B 맥스' },
  { key: 'orbit', label: 'C 궤도' },
] as const

type Variant = (typeof VARIANTS)[number]['key']

export default function HomePage() {
  const [variant, setVariant] = useState<Variant>('orbit')
  return (
    <div className="relative">
      <div className="absolute right-6 top-4 z-30 flex overflow-hidden rounded-full border-2 border-primary bg-white text-xs">
        {VARIANTS.map((v) => (
          <button key={v.key} onClick={() => setVariant(v.key)}
            className={`px-3 py-1 font-bold ${variant === v.key ? 'bg-primary text-white' : 'text-gray-400'}`}>
            {v.label}
          </button>
        ))}
      </div>
      {variant === 'simple' && <HomePageSimple />}
      {variant === 'max' && <HomePageMax />}
      {variant === 'orbit' && <HomePageOrbit />}
    </div>
  )
}
