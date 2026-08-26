import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { SearchResponse } from '../api/types'

/** EXP-001 통합 검색 — debounce 300ms, 결과 카드 → 상세 */
export default function SearchPage() {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300)
    return () => clearTimeout(t)
  }, [input])

  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: async () => (await api.get<SearchResponse>('/books/search', { params: { q } })).data,
    enabled: q.length >= 1,
  })

  return (
    <main className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold">도서 검색</h1>
      <input
        autoFocus
        className="mt-4 w-full border-2 border-primary rounded-lg px-4 py-3"
        placeholder="제목·저자로 검색 (예: 데미안)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {q && (
        <p className="mt-4 text-gray-500">"{q}" 검색 결과 {data?.total ?? 0}건 {isFetching && '· 검색 중…'}</p>
      )}
      <ul className="mt-3 space-y-3">
        {(data?.items ?? []).map((bk) => (
          <li key={bk.bookId}>
            <Link to={`/books/${bk.bookId}`} className="flex gap-4 items-center border-2 border-primary rounded-xl bg-white p-4">
              <div className="w-12 h-[68px] bg-gray-200 rounded flex-shrink-0" />
              <div>
                <p className="font-bold">{bk.title}</p>
                <p className="text-sm text-gray-500">{bk.author} · {bk.publisher} · {bk.publicationYear}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {q && data && data.total === 0 && !isFetching && (
        <div className="mt-6 border-2 border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-400">
          검색 결과가 없어요 — 다른 제목이나 저자로 찾아보세요
        </div>
      )}
    </main>
  )
}
