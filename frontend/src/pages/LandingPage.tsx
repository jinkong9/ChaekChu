import { useState } from 'react'
import LandingAurora from '../features/landing/LandingAurora'
import LandingCover from '../features/landing/LandingCover'
import LandingCoverClassic from '../features/landing/LandingCoverClassic'
import LandingOku from '../features/landing/LandingOku'
import LandingShelf from '../features/landing/LandingShelf'
import LandingTorn from '../features/landing/LandingTorn'

/** 비로그인 랜딩. OAuth 버튼을 랜딩에 직접 배치 (별도 로그인 페이지 없음, 8/28 피드백).
 *  신규 회원(onboarded=false) → 온보딩, 기존 회원 → 홈으로 자동 분기 — 두 시안 공통
 *  (features/landing/landingShared.ts).
 *
 *  시안 토글은 팀 비교용이다 (BOOK DNA·추천·내 서재와 같은 방식). 확정되면 한쪽만 남기고
 *  이 파일과 features/landing 을 정리한다. */
const VARIANTS = [
  { key: 'aurora', label: 'A 오로라 (기존)' },
  { key: 'shelf', label: 'B 표지 지면' },
  { key: 'cover', label: 'C-1 한 권의 표지' },
  { key: 'cover-classic', label: 'C-2 입체 표지' },
  { key: 'oku', label: 'D 에디토리얼' },
  { key: 'torn', label: 'E 찢긴 지면' },
] as const

type Variant = (typeof VARIANTS)[number]['key']

export default function LandingPage() {
  const [variant, setVariant] = useState<Variant>('oku')
  return (
    <>
      {variant === 'aurora' && <LandingAurora />}
      {variant === 'shelf' && <LandingShelf />}
      {variant === 'cover' && <LandingCover />}
      {variant === 'cover-classic' && <LandingCoverClassic />}
      {variant === 'oku' && <LandingOku />}
      {variant === 'torn' && <LandingTorn />}
      {/* 시안 전환은 제품 UI가 아니라 팀용 도구다 — 화면 오른쪽 아래에 조용히 띄워
          랜딩의 로그인 버튼과 자리를 다투지 않게 한다. 랜딩 루트가 position:fixed 라
          그 위로 올라오려면 z-40 이 필요하다 */}
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
    </>
  )
}
