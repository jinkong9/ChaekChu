import { Link } from 'react-router'
import { useState } from 'react'
import { useAnonymousRecommendations } from '../lib/useRecommendations'
import { SUGGESTED_TAGS } from '../api/types'

/** 비회원 탐색 — 개인 데이터 없이 요청 해시태그와 서버 기본 가중치만으로 추천한다. */
const PUBLIC_TAGS = SUGGESTED_TAGS.filter((tag) =>
  !['#내취향근접', '#같은작가', '#함께대출', '#내또래인기', '#새로운분야'].includes(tag),
)

export default function AnonymousRecommendationPage() {
  const [selectedTags, setSelectedTags] = useState<string[]>(['#소설'])
  const { data, isPending, isError } = useAnonymousRecommendations(selectedTags)

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag)
      ? current.filter((item) => item !== tag)
      : current.length < 5 ? [...current, tag] : current)
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-10 text-primary">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-lg font-bold text-accent">책추책책추</Link>
          <Link to="/" className="text-sm text-gray-500 underline">로그인하기</Link>
        </div>

        <section className="mt-12 max-w-3xl">
          <p className="text-sm font-bold text-accent">로그인 후 추천 탐색</p>
          <h1 className="mt-2 text-4xl font-bold">어떤 결의 책을 찾고 있나요?</h1>
          <p className="mt-3 text-gray-500">선택한 해시태그와 책의 콘텐츠 태그를 바탕으로 추천해요. 나의 조회·좋아요·평점·서재 기록까지 함께 반영할 수 있어요.</p>
        </section>

        <section className="mt-8 rounded-xl border-2 border-primary bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">관심 태그 <span className="text-sm font-normal text-gray-400">최대 5개</span></h2>
            <span className="text-sm text-gray-400">{selectedTags.length}/5</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {PUBLIC_TAGS.map((tag) => {
              const selected = selectedTags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border-2 px-3 py-1.5 text-sm transition-colors ${selected ? 'border-accent bg-accent text-white' : 'border-gray-200 text-gray-500 hover:border-primary'}`}
                  aria-pressed={selected}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-bold">이런 책을 골라봤어요</h2>
              <p className="mt-1 text-sm text-gray-500">로그인한 사용자의 추천 기준을 태그로 조절할 수 있어요.</p>
            </div>
            {data && <span className="text-sm text-gray-400">기준: {data.appliedTags.join(' · ') || '전체 태그'}</span>}
          </div>

          {isPending && <p className="mt-6 text-gray-400">추천을 고르는 중…</p>}
          {isError && <p className="mt-6 text-gray-400">추천을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
          {data && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((item) => (
                <article key={item.book.bookId} className="rounded-xl border-2 border-primary bg-white p-4">
                  <div className="h-40 rounded bg-gray-100" />
                  <p className="mt-3 text-xs font-bold text-accent">#{item.rank} · 태그 적합도 {Math.round(item.score)}점</p>
                  <h3 className="mt-1 text-lg font-bold">{item.book.title}</h3>
                  <p className="text-sm text-gray-500">{item.book.author}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => <span key={tag} className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500">{tag}</span>)}
                  </div>
                  <p className="mt-3 text-sm text-gray-600">{item.reasonText}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="mt-12 text-center text-sm text-gray-500">
          추천 기준을 더 조절하고 싶다면 <Link to="/home" className="font-bold text-accent underline">추천 홈으로 돌아가세요.</Link>
        </p>
      </div>
    </main>
  )
}
