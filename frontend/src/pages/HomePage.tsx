import { useState, type ComponentType } from 'react'
import HomePageOrbit from './HomePageOrbit'

/** 홈 시안 토글 (팀 비교용 — 한 안으로 확정되면 이 파일을 지우고 라우트가 그 안을 직접 가리키게 한다).
 *  시안 추가는 이 배열에 { key, label, Page } 한 줄만 더하면 된다. */
const VARIANTS: { key: string; label: string; Page: ComponentType }[] = [
  { key: 'orbit', label: 'A 궤도', Page: HomePageOrbit },
]

export default function HomePage() {
  const [variant, setVariant] = useState(VARIANTS[0].key)
  const Current = (VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0]).Page

  return (
    <div className="relative flex flex-1 flex-col">
      {/* 시안이 하나뿐이면 고를 게 없어 토글은 장식일 뿐이라 숨긴다. 시안이 늘면 다시 나온다 */}
      {VARIANTS.length > 1 && (
        <div className="absolute right-6 top-4 z-30 flex overflow-hidden rounded-full border-2 border-primary bg-white text-xs">
          {VARIANTS.map((v) => (
            <button key={v.key} onClick={() => setVariant(v.key)}
              className={`px-3 py-1 font-bold ${variant === v.key ? 'bg-primary text-white' : 'text-gray-400'}`}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      <Current />
    </div>
  )
}
