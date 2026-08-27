import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { BookDetail } from '../api/types'
import { trackEvent } from '../lib/events'

/** BOOK-001 도서 상세 — 통합 서지 + 출처별 지표 + 이유 카드(추천 경유 시) + 연령 분포 */
export default function BookDetailPage() {
  const { bookId } = useParams()
  const [params] = useSearchParams()
  const fromRec = params.get('from') === 'rec' // 추천 경유 시에만 이유 카드 노출

  const qc = useQueryClient()
  const { data: book, isPending } = useQuery({
    queryKey: ['book', bookId],
    queryFn: async () => (await api.get<BookDetail>(`/books/${bookId}`)).data,
  })

  if (isPending || !book) return <main className="p-8 text-gray-400">불러오는 중…</main>

  const save = (status: 'WISH' | 'READING' | 'READ') => {
    trackEvent('book_save', { bookId: book.bookId, status })
    api.post('/library', { bookId: book.bookId, status }).then(() => qc.invalidateQueries({ queryKey: ['library'] })).catch(() => {})
  }

  return (
    <main className="p-8 max-w-5xl flex gap-8">
      <div className="w-52 flex-shrink-0">
        <div className="w-52 h-72 bg-gray-200 rounded" />
        <div className="mt-4 flex flex-col gap-2">
          <button className="bg-primary text-white rounded-lg py-2.5 font-bold" onClick={() => save('WISH')}>찜하기</button>
          <button className="border-2 border-primary rounded-lg py-2.5" onClick={() => save('READING')}>읽는 중으로 담기</button>
          <button className="border-2 border-primary rounded-lg py-2.5" onClick={() => save('READ')}>완독 표시</button>
        </div>
      </div>

      <div className="flex-1">
        <h1 className="text-2xl font-bold">{book.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{book.publisher} · {book.publicationYear} · {book.pageCount}쪽{book.isbn13 && ` · ISBN ${book.isbn13}`}</p>

        {/* 출처별 지표 — 결측 항목은 렌더 안 함 */}
        <div className="mt-3 flex gap-3 flex-wrap">
          {book.metrics.map((m) => (
            <div key={m.name} className="border-2 border-primary rounded-lg px-3 py-2 text-sm">
              <span className="font-bold">{m.value}</span> <span className="text-gray-400 text-xs">{m.name} · {m.source} · {m.asOf}</span>
            </div>
          ))}
          {book.category && <div className="border-2 border-primary rounded-lg px-3 py-2 text-sm">{book.category} <span className="text-gray-400 text-xs">국립중앙도서관</span></div>}
        </div>

        {fromRec && (
          <div className="mt-4 border border-accent rounded-lg p-4 text-sm">
            <span className="font-bold text-accent">추천으로 들어왔을 때만 보이는 이유 카드</span> — 직접 검색 진입 시 이 섹션은 렌더되지 않음
          </div>
        )}

        {book.description && (
          <section className="mt-5 border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold">책 소개 <span className="text-xs font-normal text-gray-400">카카오 / YES24</span></h2>
            <p className="mt-2 text-sm leading-relaxed">{book.description}</p>
          </section>
        )}
        {book.toc && (
          <details className="mt-3 border-2 border-primary rounded-xl bg-white p-5">
            <summary className="font-bold cursor-pointer">목차 <span className="text-xs font-normal text-gray-400">YES24 · 펼치기</span></summary>
            <pre className="mt-2 text-sm whitespace-pre-line font-sans">{book.toc}</pre>
          </details>
        )}

        {book.loanByAge && (
          <section className="mt-3 border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold">이 책을 빌린 사람들 <span className="text-xs font-normal text-gray-400">정보나루 — 데이터 없으면 섹션 숨김</span></h2>
            <div className="mt-3 flex items-end gap-3 h-28">
              {book.loanByAge.map((a) => (
                <div key={a.ageGroup} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-gray-300 rounded-t" style={{ height: `${a.ratio * 2.4}px` }} />
                  <span className="text-xs text-gray-400">{a.ageGroup}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <section className="border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold text-sm">이 책과 비슷한 책 <span className="text-xs font-normal text-gray-400">내용 기반</span></h2>
            <div className="mt-2 flex gap-2">{[1, 2, 3, 4].map((i) => <div key={i} className="w-14 h-20 bg-gray-200 rounded" />)}</div>
          </section>
          <section className="border-2 border-primary rounded-xl bg-white p-5">
            <h2 className="font-bold text-sm">함께 대출된 책 <span className="text-xs font-normal text-gray-400">행동 기반 · 정보나루</span></h2>
            <div className="mt-2 flex gap-2">{[1, 2, 3, 4].map((i) => <div key={i} className="w-14 h-20 bg-gray-200 rounded" />)}</div>
          </section>
        </div>
      </div>
    </main>
  )
}
