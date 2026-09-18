import { useState } from 'react'
import { useNavigate } from 'react-router'
import { MAX_RECOMMEND_TAGS } from '../lib/useRecommendations'
import { useTags } from '../lib/useTags'
import { useTuneStore } from '../stores/tuneStore'

const MAX_TAGS = MAX_RECOMMEND_TAGS

/** REC-002 추천 기준 조절 — 관심 태그를 골라 추천에 반영한다.
 *  적용하면 추천 화면이 `GET /recommendations?tags=` 로 서버에서 덱을 다시 받는다(§5.1).
 *  칩은 서버 태그 사전(`GET /tags?kind=GENRE`)에서 온다 — 서버가 실제로 아는 태그만 보여 준다.
 *  (예전 미리보기 패널은 현재 덱을 클라이언트에서 재정렬한 것이라 서버 결과와 달라 뺐다.) */
export default function TunePage() {
  const navigate = useNavigate()
  const saved = useTuneStore((s) => s.tags)
  const setTags = useTuneStore((s) => s.setTags)
  const [selected, setSelected] = useState<string[]>(saved)
  const { data: tags, isPending } = useTags('GENRE')

  // 고를 수 있는 태그 = 사전에서 selectable 인 것. 서버에는 라벨('#소설')을 그대로 보낸다(§3.3·§5.1 둘 다 라벨을 받는다)
  const options = (tags ?? []).filter((t) => t.selectable).map((t) => t.label)
  const full = selected.length >= MAX_TAGS

  const toggle = (t: string) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : prev.length < MAX_TAGS ? [...prev, t] : prev))

  const apply = () => {
    setTags(selected)
    navigate('/recommend')
  }

  return (
    <main className="eo-page">
      <div className="eo-shell eo-shell--reading">
        <header className="eo-pagehead">
          <h1 className="eo-headline">어떤 결의 책이 먼저 보이면 좋을까요?</h1>
          {/* 읽기 폭(720px) 안에서는 한 줄로 흐른다 — 52ch 로 묶으면 「안 / 골라도」에서 끊겼다 */}
          <p className="eo-body mt-4">
            끌리는 태그를 고르면 그 결의 책이 위로 올라와요 — 최대 {MAX_TAGS}개, 안 골라도 괜찮아요.
          </p>
        </header>

        <section className="eo-section mt-8">
          <div className="eo-section__header">
            <h2 className="eo-title">관심 태그</h2>
            <span>{selected.length} / {MAX_TAGS}</span>
          </div>

          {isPending ? (
            <p className="eo-body">태그를 불러오는 중</p>
          ) : options.length === 0 ? (
            <p className="eo-body">고를 수 있는 태그가 아직 없어요. 지금은 서재 기록만으로 추천해요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {options.map((t) => {
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
          )}

          <p className="eo-body mt-6 max-w-[58ch] text-[11px]">
            적용하면 이 태그로 추천을 다시 골라요. 아무것도 고르지 않으면 온보딩 때 고른 관심 장르로 추천해요.
          </p>

          {/* 이 화면의 결정적 행동 하나만 캡슐형 — 해제는 밑줄 버튼으로 낮춘다 */}
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2">
            <button className="eo-button" onClick={apply}>이 태그로 추천받기</button>
            <button className="eo-link" onClick={() => setSelected([])} disabled={selected.length === 0}>모두 해제</button>
          </div>
        </section>
      </div>
    </main>
  )
}
