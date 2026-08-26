import { useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { FEATURE_LABELS, PRESET_LABELS, type FeatureKey, type RecommendationItem } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { trackEvent } from '../lib/events'

/** REC-001 추천 홈 — 이유는 페이지 이동 없이 카드 안에서 인라인 확장 (REC-004 흡수) */
export default function HomePage() {
  const qc = useQueryClient()
  const { data, isPending, isError } = useRecommendations()
  const [topOpen, setTopOpen] = useState(false)
  const [openCards, setOpenCards] = useState<Set<number>>(new Set())

  if (isPending) return <main className="p-8 text-gray-400">추천을 불러오는 중…</main>
  if (isError || !data) return <main className="p-8 text-gray-400">추천을 불러오지 못했어요.</main>

  const [top, ...rest] = data.items
  const save = (bookId: number, rank: number, status: 'WISH' | 'READING') => {
    trackEvent('book_save', { bookId, recommendationId: data.recommendationId, rank, status })
    api.post('/library', { bookId, status }).then(() => qc.invalidateQueries({ queryKey: ['library'] })).catch(() => {})
  }
  const viewReason = (item: RecommendationItem) =>
    trackEvent('recommendation_reason_view', { bookId: item.book.bookId, recommendationId: data.recommendationId, rank: item.rank })

  // 기여도 = 원점수 × 가중치 / Σ(유효 가중치) — 정보 없음 기준은 분모 제외, 목록 맨 아래
  const contributions = (item: RecommendationItem) => {
    const den = item.featureScores.reduce((acc, s) => (s.rawScore === null ? acc : acc + data.weights[s.key]), 0)
    return item.featureScores
      .map((s) => ({ key: s.key, label: FEATURE_LABELS[s.key], raw: s.rawScore,
        value: s.rawScore === null || den === 0 ? null : Math.round(((s.rawScore * data.weights[s.key]) / den) * 10) / 10 }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  }
  const toggleCard = (item: RecommendationItem) => {
    const next = new Set(openCards)
    if (next.has(item.book.bookId)) next.delete(item.book.bookId)
    else { next.add(item.book.bookId); viewReason(item) }
    setOpenCards(next)
  }

  return (
    <main className="p-8 max-w-5xl">
      <h1 className="text-3xl">오늘은 이 책을 권합니다</h1>
      <p className="text-sm text-gray-500 mt-1">
        {data.fallback ? '아직 취향을 몰라서 인기 도서로 시작해요 — 찜하면 더 정확해져요.' : `최근 기록한 ${data.basedOnCount}권을 반영했어요`}
      </p>

      <div className="mt-4 flex items-center gap-2 border-2 border-primary rounded-lg bg-white px-4 py-2 text-sm">
        <span className="font-bold">적용 중인 기준 · {PRESET_LABELS[data.preset].name}</span>
        {(Object.entries(data.weights) as [FeatureKey, number][]).map(([k, w]) => (
          <span key={k} className="border rounded-full px-2 py-0.5 text-gray-500">{FEATURE_LABELS[k].replace(' 책', '')} {w}</span>
        ))}
        <Link to="/tune" className="ml-auto font-bold underline">기준 조절하기 ›</Link>
      </div>

      {/* TOP 1 히어로 */}
      <section className="mt-5 border-2 border-primary rounded-xl bg-white p-6">
        <div className="flex gap-6">
          <div className="w-40 h-56 bg-gray-200 rounded flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs font-bold border-2 border-primary rounded px-2 py-0.5">TOP 1</span>
            <h2 className="text-2xl mt-2">
              <Link to={`/books/${top.book.bookId}?from=rec`} className="hover:underline"
                onClick={() => trackEvent('recommendation_click', { bookId: top.book.bookId, recommendationId: data.recommendationId, rank: top.rank })}>
                {top.book.title}
              </Link>
              <span className="text-base text-gray-500 font-sans"> {top.book.author}</span>
            </h2>
            <p className="text-sm text-gray-500">{top.book.pageCount}쪽 · {top.book.publicationYear}</p>
            <p className="text-4xl font-display mt-2 text-accent">{top.fitScore}<span className="text-sm font-sans text-gray-400"> 적합도 / 100</span></p>
            <div className="mt-3 border border-accent rounded-lg p-3">
              <p>{top.reasonText}</p>
              <button className="text-sm text-accent underline mt-1"
                onClick={() => { if (!topOpen) viewReason(top); setTopOpen(!topOpen) }}>
                {topOpen ? '기여도 접기 ▴' : '기여도 자세히 ▾'}
              </button>
              {topOpen && (
                <div className="mt-3 border-t border-accent/30 pt-3 space-y-1.5">
                  {contributions(top).map((r) => (
                    <div key={r.key} className={`flex items-center gap-3 text-sm ${r.value === null ? 'text-gray-300' : ''}`}>
                      <span className="w-36 flex-shrink-0">{r.label}</span>
                      <div className="flex-1 bg-gray-100 rounded h-2"><div className="bg-primary rounded h-2" style={{ width: `${r.value ?? 0}%` }} /></div>
                      <span className="w-14 text-right font-bold">{r.value ?? '정보 없음'}</span>
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 pt-1">적합도 = Σ(원점수×가중치)/Σ(가중치) · 점수 없는 기준은 계산에서 제외</p>
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button className="bg-primary text-white rounded-lg px-5 py-2 font-bold" onClick={() => save(top.book.bookId, top.rank, 'WISH')}>찜하기</button>
              <button className="border-2 border-primary rounded-lg px-5 py-2" onClick={() => save(top.book.bookId, top.rank, 'READING')}>서재에 담기</button>
              <button className="border rounded-lg px-5 py-2 text-gray-500" onClick={() => trackEvent('not_interested', { bookId: top.book.bookId, recommendationId: data.recommendationId, rank: top.rank })}>관심 없어요</button>
            </div>
          </div>
        </div>
      </section>

      {/* 나머지 추천 그리드 — 이유는 카드 안에서 펼침 */}
      <h3 className="text-xl mt-8">이 책도 잘 맞아요 <span className="text-sm text-gray-400 font-sans">이유는 접혀 있어요 · 카드에서 펼치기</span></h3>
      <div className="mt-3 grid grid-cols-5 gap-4 items-start">
        {rest.map((item) => {
          const open = openCards.has(item.book.bookId)
          return (
            <div key={item.book.bookId} className="border-2 border-primary rounded-lg bg-white p-3">
              <Link to={`/books/${item.book.bookId}?from=rec`}
                onClick={() => trackEvent('recommendation_click', { bookId: item.book.bookId, recommendationId: data.recommendationId, rank: item.rank })}>
                <div className="h-36 bg-gray-200 rounded" />
                <p className="mt-2 font-bold truncate">{item.book.title}</p>
              </Link>
              <div className="flex justify-between text-sm mt-1">
                <span className="font-display text-accent">{item.fitScore}</span>
                <button className="text-gray-400 hover:text-accent" onClick={() => toggleCard(item)}>
                  {open ? '접기 ▴' : '이유 보기 ▾'}
                </button>
              </div>
              {open && <p className="mt-2 text-xs border-t pt-2 text-gray-600">{item.reasonText}</p>}
            </div>
          )
        })}
      </div>
    </main>
  )
}
