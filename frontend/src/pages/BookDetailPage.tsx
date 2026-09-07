import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { BookDetail, ShelfStatus } from '../api/types'
import { trackEvent } from '../lib/events'

const MY_STATUS_LABEL: Record<ShelfStatus, string> = { WISH: '찜', READ: '읽음' }

/** BOOK-001 도서 상세 — 통합 서지 + 출처별 지표 + 이유 카드(추천 경유 시) + 연령 분포 + 내 기록.
 *  '다음에 읽을 책'(BOOK-002)은 별도 페이지 대신 하단 비슷한 책/함께 대출 섹션으로 흡수 */
export default function BookDetailPage() {
  const { bookId } = useParams()
  const [params] = useSearchParams()
  const fromRec = params.get('from') === 'rec' // 추천 경유 시에만 이유 카드 노출

  const qc = useQueryClient()
  const { data: book, isPending } = useQuery({
    queryKey: ['book', bookId],
    queryFn: async () => (await api.get<BookDetail>(`/books/${bookId}`)).data,
  })

  // 로그인 사용자의 개인화 입력 — 같은 도서를 반복 조회해도 세션당 한 번만 전송한다.
  const viewedBookId = useRef<number | null>(null)
  useEffect(() => {
    if (book && viewedBookId.current !== book.bookId) {
      viewedBookId.current = book.bookId
      trackEvent('BOOK_VIEW', { bookId: book.bookId })
    }
  }, [book])

  if (isPending || !book) {
    return (
      <main className="eo-page">
        <div className="eo-state">
          <span className="eo-progress" />
          <p className="eo-body">책을 불러오는 중</p>
        </div>
      </main>
    )
  }

  const save = (status: ShelfStatus) => {
    if (status === 'WISH') trackEvent('WISH', { bookId: book.bookId })
    api.post('/library', { bookId: book.bookId, status })
      .then(() => { qc.invalidateQueries({ queryKey: ['library'] }); qc.invalidateQueries({ queryKey: ['book', bookId] }) })
      .catch(() => {})
  }

  const bibliography = [book.publisher, book.publicationYear, book.pageCount && `${book.pageCount}쪽`].filter(Boolean).join(' · ')
  // 연령 분포는 값이 아니라 서로의 비율이 읽혀야 한다 — 최댓값을 100%로 잡는다
  const peakRatio = Math.max(...(book.loanByAge ?? []).map((a) => a.ratio), 1)

  return (
    <main className="eo-page">
      <div className="eo-shell">
        {/* 제목은 폭 전체를 가로질러 먼저 온다 — 좁은 화면에서 표지가 첫 화면을 다 먹지 않도록,
            그 아래에 표지·행동 레일과 읽을거리 단을 나란히 둔다 */}
        <header className="eo-pagehead">
          <h1 className="eo-headline">{book.title}</h1>
          <p className="eo-body mt-3">
            {book.author}
            {bibliography && <span className="eo-faint"> · {bibliography}</span>}
          </p>
          {book.isbn13 && <p className="eo-utility mt-1.5">ISBN {book.isbn13}</p>}
        </header>

        <div className="mt-8 flex flex-col gap-9 md:flex-row md:gap-12">
          <div className="w-[148px] shrink-0 md:w-[196px]">
            {book.coverUrl
              ? <img className="eo-cover" src={book.coverUrl} alt={book.title} referrerPolicy="no-referrer" decoding="async" />
              : <span className="eo-cover-fallback">{book.title}</span>}
            <div className="mt-5 flex flex-col items-start gap-3.5">
              <button className="eo-button w-full" onClick={() => save('WISH')}>찜하기</button>
              <button className="eo-text-button text-[13px]" onClick={() => save('READ')}>완독 표시</button>
            </div>

            {/* 내 기록 — 계약 §6: 본인 것만, 비로그인·타인은 null */}
            {book.myLibraryStatus && (
              <section className="mt-7 border-t border-rule pt-4">
                <h2 className="eo-label">내 기록</h2>
                <p className="eo-body mt-2">
                  {MY_STATUS_LABEL[book.myLibraryStatus]}
                  {book.myRating != null && ` · 별점 ${book.myRating}`}
                </p>
                {book.myReviewText && <p className="eo-body eo-body--ink mt-2">{book.myReviewText}</p>}
                <Link to="/library" className="eo-link mt-3">서재에서 수정</Link>
              </section>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {/* 출처별 지표 — 결측 항목은 렌더 안 함. 상자 대신 규칙선으로 끊는다 */}
            {(book.metrics.length > 0 || book.category) && (
              <dl className="border-b border-rule-soft">
                {[
                  ...book.metrics.map((m) => ({ key: `${m.source}-${m.name}`, name: m.name, value: m.value, source: `${m.source} · ${m.asOf}` })),
                  ...(book.category ? [{ key: 'category', name: '분류', value: book.category, source: '국립중앙도서관' }] : []),
                ].map((row) => (
                  <div key={row.key} className="flex items-baseline gap-4 border-t border-rule-soft py-3">
                    <dt className="w-20 shrink-0 text-[10px] leading-tight text-ink-muted">{row.name}</dt>
                    <dd className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                      <span className="truncate text-[15px] font-semibold tabular-nums">{row.value}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{row.source}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {fromRec && (
              <p className="mt-6 border-l-2 border-ink pl-4 text-[13px] leading-relaxed">
                <span className="font-bold">추천으로 들어왔을 때만 보이는 이유 카드</span>
                <span className="eo-faint"> — 직접 검색 진입 시 이 섹션은 렌더되지 않음</span>
              </p>
            )}

            {book.description && (
              <section className="eo-section mt-8">
                <div className="eo-section__header">
                  <h2 className="eo-title">책 소개</h2>
                  <span>카카오 / YES24</span>
                </div>
                <p className="eo-body eo-body--ink max-w-[62ch] text-[13px]">{book.description}</p>
              </section>
            )}

            {book.toc && (
              <details className="eo-section">
                <summary className="eo-section__header cursor-pointer list-none">
                  <h2 className="eo-title">목차</h2>
                  <span>YES24 · 펼치기</span>
                </summary>
                <pre className="eo-body eo-body--ink max-w-[62ch] whitespace-pre-line font-sans text-[13px]">{book.toc}</pre>
              </details>
            )}

            {book.loanByAge && (
              <section className="eo-section">
                <div className="eo-section__header">
                  <h2 className="eo-title">이 책을 빌린 사람들</h2>
                  <span>정보나루</span>
                </div>
                {/* 막대는 값이 아니라 서로의 비율을 읽는 자리 — 폭은 좁게 두고 여백이 비교를 돕게 한다 */}
                <div className="flex h-24 max-w-[380px] items-end gap-6">
                  {book.loanByAge.map((a) => (
                    <div key={a.ageGroup} className="flex h-full flex-1 flex-col justify-end gap-2">
                      <span className="eo-utility text-center">{Math.round(a.ratio)}%</span>
                      <div className="mx-auto w-6 bg-ink" style={{ height: `${(a.ratio / peakRatio) * 100}%` }} />
                      <span className="eo-utility text-center">{a.ageGroup}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-0 sm:grid-cols-2 sm:gap-x-12">
              <section className="eo-section">
                <div className="eo-section__header">
                  <h2 className="eo-title">비슷한 책</h2>
                  <span>소개 임베딩</span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((i) => <span key={i} className="eo-cover-fallback eo-skeleton" />)}
                </div>
              </section>
              <section className="eo-section">
                <div className="eo-section__header">
                  <h2 className="eo-title">함께 대출된 책</h2>
                  <span>정보나루</span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((i) => <span key={i} className="eo-cover-fallback eo-skeleton" />)}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
