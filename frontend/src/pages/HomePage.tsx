import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { RecommendationItem } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { useTuneStore } from '../stores/tuneStore'
import { trackEvent } from '../lib/events'

/** REC-001 추천 홈 — 8/27 결정 반영: 적합도 수치·기여도 분해 제거,
 *  이유 = 해시태그 칩 + 한 문장. 태그 조절 시 덱 재정렬(재계산 아님) */
export default function HomePage() {
  const qc = useQueryClient()
  const { data, isPending, isError } = useRecommendations()
  const myTags = useTuneStore((s) => s.tags)

  // 노출 이벤트 — 덱(recommendationId)당 1회
  const impressed = useRef<string | null>(null)
  useEffect(() => {
    if (data && impressed.current !== data.recommendationId) {
      impressed.current = data.recommendationId
      trackEvent('IMPRESSION', { recommendationId: data.recommendationId })
    }
  }, [data])

  if (isPending) return <main className="p-8 text-gray-400">추천을 불러오는 중…</main>
  if (isError || !data) return <main className="p-8 text-gray-400">추천을 불러오지 못했어요.</main>

  // 태그 선택 시 캐시된 덱을 겹치는 태그 수로 재정렬 — 후보 재생성 없음 (덱 구조 원칙)
  const overlap = (item: RecommendationItem) => item.tags.filter((t) => myTags.includes(t)).length
  const items = myTags.length === 0 ? data.items : [...data.items].sort((a, b) => overlap(b) - overlap(a) || a.rank - b.rank)
  const [top, ...rest] = items
  const appliedTags = myTags.length > 0 ? myTags : data.appliedTags

  const save = (bookId: number, rank: number, status: 'WISH' | 'READING') => {
    if (status === 'WISH') trackEvent('WISH', { bookId, recommendationId: data.recommendationId, rank })
    api.post('/library', { bookId, status }).then(() => qc.invalidateQueries({ queryKey: ['library'] })).catch(() => {})
  }
  const click = (item: RecommendationItem) =>
    trackEvent('CLICK', { bookId: item.book.bookId, recommendationId: data.recommendationId, rank: item.rank })

  const Tag = ({ t }: { t: string }) => (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${myTags.includes(t) ? 'border-accent text-accent font-bold' : 'border-gray-300 text-gray-500'}`}>{t}</span>
  )

  return (
    <main className="p-8 max-w-5xl">
      <h1 className="text-3xl">오늘은 이 책을 권합니다</h1>
      <p className="text-sm text-gray-500 mt-1">
        {data.fallback ? '아직 취향을 몰라서 인기 도서로 시작해요 — 찜하면 더 정확해져요.' : `최근 기록한 ${data.basedOnCount}권을 반영했어요`}
      </p>

      {/* 적용 중인 관심 태그 — 수치 가중치 대신 해시태그 (8/27) */}
      <div className="mt-4 flex items-center gap-2 border-2 border-primary rounded-lg bg-white px-4 py-2 text-sm flex-wrap">
        <span className="font-bold">관심 태그</span>
        {appliedTags.length === 0
          ? <span className="text-gray-400">아직 없어요 — 태그를 고르면 그 결이 먼저 올라와요</span>
          : appliedTags.map((t) => <Tag key={t} t={t} />)}
        <Link to="/tune" className="ml-auto font-bold underline">기준 조절하기 ›</Link>
      </div>

      {/* TOP 1 히어로 */}
      <section className="mt-5 border-2 border-primary rounded-xl bg-white p-6">
        <div className="flex gap-6">
          <div className="w-40 h-56 bg-gray-200 rounded flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs font-bold border-2 border-primary rounded px-2 py-0.5">TOP 1</span>
            <h2 className="text-2xl mt-2">
              <Link to={`/books/${top.book.bookId}?from=rec`} className="hover:underline" onClick={() => click(top)}>
                {top.book.title}
              </Link>
              <span className="text-base text-gray-500 font-sans"> {top.book.author}</span>
            </h2>
            <p className="text-sm text-gray-500">{top.book.pageCount}쪽 · {top.book.publicationYear}</p>
            <div className="mt-3 flex gap-1.5 flex-wrap">{top.tags.map((t) => <Tag key={t} t={t} />)}</div>
            {/* reasonText 계약 스펙: 내 서재의 구체 근거(책 제목·별점)를 반드시 포함, 일반론 금지.
                태그=분류, 문장=증거 — 그리드 카드에는 문장 없음(태그가 요약 이유) */}
            <div className="mt-3 border border-accent rounded-lg p-3">
              <p>{top.reasonText}</p>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="bg-primary text-white rounded-lg px-5 py-2 font-bold" onClick={() => save(top.book.bookId, top.rank, 'WISH')}>찜하기</button>
              <button className="border-2 border-primary rounded-lg px-5 py-2" onClick={() => save(top.book.bookId, top.rank, 'READING')}>서재에 담기</button>
              {/* '관심 없어요'는 이벤트 축소로 보류 — not_interested 부활 시 여기 복원 */}
            </div>
          </div>
        </div>
      </section>

      {/* 나머지 추천 그리드 — 이유는 카드 안에서 펼침 */}
      <h3 className="text-xl mt-8">이 책도 잘 맞아요 <span className="text-sm text-gray-400 font-sans">태그가 곧 이유예요 · 자세한 건 카드를 눌러서</span></h3>
      <div className="mt-3 grid grid-cols-5 gap-4">
        {rest.map((item) => (
          <Link key={item.book.bookId} to={`/books/${item.book.bookId}?from=rec`} onClick={() => click(item)}
            className="border-2 border-primary rounded-lg bg-white p-3 flex flex-col hover:shadow-md transition-shadow">
            <div className="h-36 bg-gray-200 rounded" />
            <p className="mt-2 font-bold truncate">{item.book.title}</p>
            {/* 태그 영역 고정 높이(2줄 수용) — 카드 높이 정렬 */}
            <div className="mt-1.5 h-14 flex gap-1 flex-wrap content-start">{item.tags.slice(0, 2).map((t) => <Tag key={t} t={t} />)}</div>
          </Link>
        ))}
      </div>
    </main>
  )
}
