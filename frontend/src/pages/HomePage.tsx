import { useState } from 'react'
import HomePageSimple from './HomePageSimple'
import HomePageMax from './HomePageMax'

/** 홈 시안 토글 (팀 비교용 — 확정되면 한쪽만 남기고 이 파일 정리) */
export default function HomePage() {
  const [variant, setVariant] = useState<'simple' | 'max'>('simple')
  return (
    <div className="relative">
      <div className="absolute right-6 top-4 z-30 flex border-2 border-primary rounded-full overflow-hidden text-xs bg-white">
        <button className={`px-3 py-1 font-bold ${variant === 'simple' ? 'bg-primary text-white' : 'text-gray-400'}`} onClick={() => setVariant('simple')}>A 심플</button>
        <button className={`px-3 py-1 font-bold ${variant === 'max' ? 'bg-primary text-white' : 'text-gray-400'}`} onClick={() => setVariant('max')}>B 맥스</button>
      </div>
      {variant === 'simple' ? <HomePageSimple /> : <HomePageMax />}
    </div>
  )
}
