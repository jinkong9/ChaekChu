/** DNA-001 내 BOOK DNA — 시안 검증용 mock.
 *  정식 구현 시 페르소나 전환을 제거하고 user_library 집계 API로 교체한다. */
import { useState } from 'react'
import DnaMockPage from '../features/dna/DnaMockPage'
import DnaReportPage from '../features/dna/DnaReportPage'

/** BOOK DNA 시안 토글 (팀 비교용 — 홈·추천·내 서재와 같은 방식. 확정되면 한쪽만 남기고 이 파일 정리) */
const VARIANTS = [
  { key: 'spectrum', label: 'A 취향 스펙트럼' },
  { key: 'report', label: 'B 분석 리포트' },
] as const

type Variant = (typeof VARIANTS)[number]['key']

export default function DnaPage() {
  const [variant, setVariant] = useState<Variant>('report')
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
      {variant === 'spectrum' && <DnaMockPage />}
      {variant === 'report' && <DnaReportPage />}
    </div>
  )
}
