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
  const full = selected.length >= MAX_TAGS

  const toggle = (t: string) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : prev.length < MAX_TAGS ? [...prev, t] : prev))

  // 미리보기 — 겹치는 태그 수 내림차순, 동률이면 원래 rank
  const preview = [...(data?.items ?? [])]
    .map((i) => ({ book: i.book, hit: i.tags.filter((t) => selected.includes(t)).length, rank: i.rank }))
    .sort((a, b) => b.hit - a.hit || a.rank - b.rank)
    .slice(0, 3)

  const apply = () => {
    setTags(selected)
    navigate('/recommend')
  }

  return (
    <main className="eo-page">
      <div className="eo-shell">
        <header className="eo-pagehead">
          <p className="eo-eyebrow">Tune</p>
          <h1 className="eo-headline">어떤 결의 책이<br />먼저 보이면 좋을까요?</h1>
          <p className="eo-body mt-4 max-w-[52ch]">
            끌리는 태그를 고르면 그 결의 책이 위로 올라와요 — 최대 {MAX_TAGS}개, 안 골라도 괜찮아요.
          </p>
        </header>

        <div className="mt-8 grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-x-12">
          <section className="eo-section">
            <div className="eo-section__header">
              <h2 className="eo-title">관심 태그</h2>
              <span>{selected.length} / {MAX_TAGS}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {allTags.map((t) => {
                const on = selected.includes(t)
                return (
                  // 고를 수 있는 자리가 남지 않으면 새 태그는 비활성 — 왜 안 눌리는지 title로 알린다
                  <button key={t} type="button" onClick={() => toggle(t)} disabled={!on && full}
                    aria-pressed={on} title={!on && full ? `${MAX_TAGS}개까지 고를 수 있어요` : undefined}
                    className={`eo-tag eo-tag--lg ${on ? 'is-on' : ''} ${!on && full ? 'opacity-35' : ''}`}>
                    {t}
                  </button>
                )
              })}
            </div>
            <p className="eo-body mt-6 max-w-[58ch] text-[11px]">
              태그는 추천 후보를 새로 계산하지 않고, 이미 준비된 추천을 재정렬해요.
              다음 추천부터는 태그가 후보 선정에도 반영됩니다.
            </p>
          </section>

          <section className="eo-section">
            <div className="eo-section__header">
              <h2 className="eo-title">미리보기</h2>
              <span>상위 3권</span>
            </div>
            {preview.length === 0 ? (
              <p className="eo-body">추천 덱을 불러오면 여기에서 순서가 어떻게 바뀌는지 볼 수 있어요.</p>
            ) : (
              <ol className="border-b border-rule-soft">
                {preview.map((b, i) => (
                  <li key={b.book.bookId} className="flex items-center gap-3.5 border-t border-rule-soft py-3">
                    <span className="w-4 shrink-0 text-[10px] tabular-nums text-ink-faint">{i + 1}</span>
                    {b.book.coverUrl
                      ? <img className="eo-row__cover" src={b.book.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                      : <span className="eo-row__cover" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">{b.book.title}</span>
                      <span className="mt-1 block text-[10px] tabular-nums text-ink-faint">
                        {b.hit > 0 ? `태그 ${b.hit}개 일치` : '태그 일치 없음'}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {/* 이 화면의 결정적 행동 하나만 캡슐형 — 해제는 밑줄 버튼으로 낮춘다 */}
            <div className="mt-7 flex flex-col items-start gap-2">
              <button className="eo-button w-full" onClick={apply}>이 태그로 추천받기</button>
              <button className="eo-link" onClick={() => setSelected([])} disabled={selected.length === 0}>모두 해제</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
