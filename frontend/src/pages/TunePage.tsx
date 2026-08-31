import { useState } from 'react'
import { useNavigate } from 'react-router'
import { SUGGESTED_TAGS } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { useTuneStore } from '../stores/tuneStore'

const MAX_TAGS = 5

/** REC-002 추천 기준 조절 — 해시태그를 선택해 사용자에게 원하는 기준을 표현한다.
 *  태그 선택 = 캐시된 덱을 태그 겹침 순으로 재정렬 (후보 재생성·서버 재계산 없음).
 *  서버의 최종 추천은 태그 기반 taste와 feature 가중치를 함께 사용한다. */
export default function TunePage() {
  const { data } = useRecommendations()
  const navigate = useNavigate()
  const saved = useTuneStore((s) => s.tags)
  const setTags = useTuneStore((s) => s.setTags)
  const [selected, setSelected] = useState<string[]>(saved)

  // 선택 가능 태그 = 제안 목록 ∪ 이번 덱에 실제로 붙은 태그
  const deckTags = [...new Set((data?.items ?? []).flatMap((i) => i.tags))]
  const allTags = [...new Set([...SUGGESTED_TAGS, ...deckTags])]

  const toggle = (t: string) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : prev.length < MAX_TAGS ? [...prev, t] : prev))

  // 미리보기 — 겹치는 태그 수 내림차순, 동률이면 원래 rank
  const preview = [...(data?.items ?? [])]
    .map((i) => ({ title: i.book.title, hit: i.tags.filter((t) => selected.includes(t)).length, rank: i.rank, tags: i.tags }))
    .sort((a, b) => b.hit - a.hit || a.rank - b.rank)
    .slice(0, 3)

  const apply = () => {
    setTags(selected)
    navigate('/recommend')
  }

  return (
    <main className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold">어떤 결의 책이 먼저 보이면 좋을까요?</h1>
      <p className="text-sm text-gray-500 mt-1">끌리는 태그를 고르면 그 결의 책이 위로 올라와요 — 최대 {MAX_TAGS}개, 안 골라도 괜찮아요.</p>

      <div className="mt-5 grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <section className="border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold text-sm text-gray-500">관심 태그 <span className="font-normal">{selected.length} / {MAX_TAGS}</span></h2>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {allTags.map((t) => (
                <button key={t} onClick={() => toggle(t)}
                  className={`rounded-full px-4 py-2 border-2 text-sm ${selected.includes(t) ? 'bg-primary text-white border-primary' : 'border-gray-300'}`}>
                  {t}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">
              태그는 추천 후보를 새로 계산하지 않고, 이미 준비된 추천을 재정렬해요. 다음 추천부터는 태그가 후보 선정에도 반영됩니다.
            </p>
          </section>
        </div>

        <div>
          <section className="border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold text-sm text-gray-500">미리보기 상위 3권 <span className="font-normal">태그를 고르면 갱신</span></h2>
            <ol className="mt-3 space-y-3">
              {preview.map((b, i) => (
                <li key={b.title} className="flex items-center gap-3">
                  <span className="text-gray-400">{i + 1}</span>
                  <div className="w-8 h-11 bg-gray-200 rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{b.title}</p>
                    {b.hit > 0 && <p className="text-xs text-accent">태그 {b.hit}개 일치</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <button className="mt-4 w-full bg-primary text-white rounded-lg py-3 font-bold" onClick={apply}>
            이 태그로 추천받기
          </button>
          <button className="mt-2 w-full border-2 border-primary rounded-lg py-2" onClick={() => setSelected([])}>모두 해제</button>
        </div>
      </div>
    </main>
  )
}
