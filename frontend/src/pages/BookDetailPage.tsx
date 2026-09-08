import { useState } from 'react'
import BookDetailPageSpread from './BookDetailPageSpread'
import CardSpreadPage from '../features/card-spread/CardSpreadPage'

/** 도서 상세 시안 토글 (팀 비교용 — 홈·추천·내 서재·BOOK DNA와 같은 방식.
 *  확정되면 한쪽만 남기고 이 파일을 정리한다) */
const VARIANTS = [
  { key: 'spread', label: 'A 편집 지면' },
  { key: 'card', label: 'B 도서 카드' },
] as const

type Variant = (typeof VARIANTS)[number]['key']

export default function BookDetailPage() {
  const [variant, setVariant] = useState<Variant>('card')
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
      {variant === 'spread' && <BookDetailPageSpread />}
      {variant === 'card' && <CardSpreadPage />}
    </div>
  )
}
