import { useState } from 'react'
import { useNavigate } from 'react-router'
import { computeFit, FEATURE_LABELS, PRESET_LABELS, type FeatureKey, type PresetKey } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { trackEvent } from '../lib/events'

const PRESET_WEIGHTS: Record<PresetKey, Record<FeatureKey, number>> = {
  balanced: { taste: 35, coLoan: 25, trending: 15, steady: 10, newField: 15 },
  myTaste: { taste: 55, coLoan: 20, trending: 5, steady: 10, newField: 10 },
  discovery: { taste: 15, coLoan: 15, trending: 20, steady: 10, newField: 40 },
  safe: { taste: 25, coLoan: 30, trending: 5, steady: 35, newField: 5 },
}

/** REC-002 추천 기준 조절 — 프리셋(베타) + 슬라이더(W3~4 오픈).
 *  슬라이더 조정 = 캐시된 덱을 가중합으로 재정렬 (후보 재생성 아님) → 미리보기가 즉시 갱신되는 이유 */
export default function TunePage() {
  const { data } = useRecommendations()
  const navigate = useNavigate()
  const [preset, setPreset] = useState<PresetKey>('balanced')
  const [weights, setWeights] = useState(PRESET_WEIGHTS.balanced)

  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  const preview = (data?.items ?? [])
    .map((i) => ({ title: i.book.title, fit: computeFit(i.featureScores, weights) }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 3)

  const pickPreset = (p: PresetKey) => {
    setPreset(p)
    setWeights(PRESET_WEIGHTS[p])
    trackEvent('preset_select', { preset: p })
  }

  return (
    <main className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold">추천 기준을 직접 조절하세요</h1>
      <p className="text-sm text-gray-500 mt-1">프리셋으로 시작해도 충분합니다. 슬라이더는 원할 때만 만지세요.</p>

      <div className="mt-5 grid grid-cols-3 gap-6">
        <div className="col-span-2">
          {/* 프리셋 — 베타 노출 범위 */}
          <section className="border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold text-sm text-gray-500">프리셋 <span className="font-normal">먼저 골라보세요</span></h2>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {(Object.keys(PRESET_LABELS) as PresetKey[]).map((p) => (
                <button key={p} onClick={() => pickPreset(p)}
                  className={`rounded-lg p-3 text-left border-2 ${preset === p ? 'border-primary bg-gray-100' : 'border-gray-300'}`}>
                  <p className="font-bold">{PRESET_LABELS[p].name}</p>
                  <p className="text-xs text-gray-500">{PRESET_LABELS[p].desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* 슬라이더 — W3~4 오픈 예정 (베타에서는 숨김 처리 예정) */}
          <section className="mt-4 border-2 border-primary rounded-xl bg-white p-5">
            <div className="flex justify-between text-sm text-gray-500"><h2 className="font-bold">가중치</h2><span>0~100 · 값을 올린 기준이 결과에 더 반영됩니다</span></div>
            {(Object.keys(weights) as FeatureKey[]).map((k) => (
              <div key={k} className="mt-4">
                <div className="flex justify-between"><span>{FEATURE_LABELS[k]}</span><span className="font-bold">{weights[k]}</span></div>
                <input type="range" min={0} max={100} value={weights[k]} className="w-full"
                  onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
              </div>
            ))}
            <div className="mt-4 flex justify-between border-t pt-3">
              <span className="font-bold">합계</span>
              <span className={`font-bold ${total !== 100 ? 'text-accent' : ''}`}>{total} / 100</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">합계 100 강제 여부는 결정 대기 — 현재는 서버 정규화 가정</p>
          </section>
        </div>

        <div>
          {/* 미리보기 — 덱 재정렬 (computeFit) */}
          <section className="border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold text-sm text-gray-500">미리보기 상위 3권 <span className="font-normal">슬라이더를 움직이면 갱신</span></h2>
            <ol className="mt-3 space-y-3">
              {preview.map((b, i) => (
                <li key={b.title} className="flex items-center gap-3">
                  <span className="text-gray-400">{i + 1}</span>
                  <div className="w-8 h-11 bg-gray-200 rounded" />
                  <span className="flex-1 truncate text-sm">{b.title}</span>
                  <span className="font-bold">{Math.round(b.fit)}</span>
                </li>
              ))}
            </ol>
          </section>
          <button
            className="mt-4 w-full bg-primary text-white rounded-lg py-3 font-bold"
            onClick={() => { trackEvent('weight_apply', { preset }); navigate('/') }}
          >
            이 기준으로 추천받기
          </button>
          <button className="mt-2 w-full border-2 border-primary rounded-lg py-2" onClick={() => pickPreset('balanced')}>기본값으로 되돌리기</button>
        </div>
      </div>
    </main>
  )
}
