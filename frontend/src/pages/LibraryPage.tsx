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
      {/* 시안 전환은 제품 UI가 아니라 팀용 도구다 — 화면 오른쪽 아래에 조용히 띄워
          각 시안의 머리말·행동 버튼과 자리를 다투지 않게 한다 */}
      <div className="eo-panel fixed bottom-5 right-4 z-40 flex items-center gap-4 px-3.5 py-2 sm:right-7">
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">시안</span>
        {VARIANTS.map((v) => (
          <button key={v.key} onClick={() => setVariant(v.key)} aria-pressed={variant === v.key}
            className={`border-b-2 pb-0.5 text-[11px] transition-colors duration-150 ${
              variant === v.key ? 'border-ink font-bold text-ink' : 'border-transparent text-ink-faint hover:text-ink'
            }`}>
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
