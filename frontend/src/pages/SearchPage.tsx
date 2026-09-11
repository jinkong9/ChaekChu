import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { isSearchUnavailable, searchBooks } from '../api/books'

/** 검색 위치를 남겨 두는 자리 — 히스토리 항목(location.key)마다 목록 스크롤 offset 하나.
 *  Safari 프라이빗 모드처럼 저장이 막히는 곳에서도 이동은 막히면 안 된다. */
function rememberScroll(key: string, y: number) {
  try { sessionStorage.setItem(key, String(y)) } catch { /* 저장 못 해도 검색은 그대로 */ }
}
function recallScroll(key: string) {
  try { return Number(sessionStorage.getItem(key)) || 0 } catch { return 0 }
}

/** EXP-001 통합 검색 — debounce 300ms, 결과 행 → 상세.
 *  GET /books/search 실서버 연결 (§4.1). 응답 변환은 api/books.ts. 첫 페이지만 쓴다(§1.4 — 프론트는 아직 페이지를 넘기지 않는다).
 *
 *  검색어는 컴포넌트 state가 아니라 URL(?q=)에 둔다 — 상세로 갔다 뒤로 오면 이 화면은 새로 마운트되므로
 *  state로는 검색어도 결과도 남지 않는다. URL에 있으면 뒤로가기가 검색어를 그대로 되돌려 주고,
 *  react-query 캐시가 결과를 다시 그린다(아래 gcTime). 타이핑 중 갱신은 replace라 글자마다 히스토리가 쌓이지 않는다. */
export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const q = params.get('q') ?? ''
  const [input, setInput] = useState(q)
  // 히스토리 항목마다 다른 키 — 뒤로 와서 되돌아온 항목은 key가 같아 그때 저장한 위치를 찾는다
  const scrollKey = `search-scroll:${location.key}`

  useEffect(() => {
    const next = input.trim()
    if (next === q) return
    const t = setTimeout(() => setParams(next ? { q: next } : {}, { replace: true }), 300)
    return () => clearTimeout(t)
  }, [input, q, setParams])

  const { data, isFetching, error } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchBooks(q),
    enabled: q.length >= 1 && q.length <= 100,
    // 503(검색 엔진 불가)·400 은 다시 보내도 같다 — 재시도 없이 바로 안내. 그 외(네트워크)는 한 번만
    retry: (count, err) => !isSearchUnavailable(err) && count < 1,
    staleTime: 60_000,
    // 상세를 오래 보다 돌아와도 목록이 비어 보이지 않도록 캐시를 기본(5분)보다 길게 붙든다
    gcTime: 30 * 60_000,
  })

  const items = data?.items ?? []
  const empty = q !== '' && data != null && data.total === 0 && !isFetching
  const tooLong = input.trim().length > 100

  // 목록이 처음 그려질 때 한 번만 — 표지는 크기가 고정(46px)이라 이미지 로딩과 무관하게 높이가 맞는다
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || items.length === 0) return
    restored.current = true
    const y = recallScroll(scrollKey)
    if (y > 0) window.scrollTo(0, y)
  }, [items.length, scrollKey])

  return (
    <main className="eo-page">
      <div className="eo-shell eo-shell--reading">
        <header className="eo-pagehead">
          <p className="eo-eyebrow">Search</p>
          <h1 className="eo-headline">도서 검색</h1>
        </header>

        {/* 검색은 이 화면의 유일한 입력 — 상자 대신 밑줄 한 줄로 둔다.
            돌아온 화면(?q= 있음)에서는 포커스를 뺏지 않는다 — 입력창으로 스크롤이 끌려가 읽던 자리를 잃는다 */}
        <input
          autoFocus={q === ''}
          className="eo-field mt-7 w-full"
          placeholder="제목·저자·출판사로 검색 (예: 데미안, ISBN)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="제목 또는 저자"
          maxLength={120}
        />

        {/* 결과 개수는 목록 위에 고정 높이로 예약 — 타이핑 중 목록이 위아래로 흔들리지 않게 */}
        <p className="eo-utility mt-3.5 min-h-[1.2em]">
          {tooLong
            ? '검색어는 100자까지예요.'
            : q && <>&ldquo;{q}&rdquo; · {data?.total?.toLocaleString() ?? 0}건{isFetching && ' · 검색 중'}</>}
        </p>

        {items.length > 0 && (
          <ul className="eo-rows mt-2">
            {items.map((bk) => (
              <li key={bk.bookId}>
                <Link
                  to={`/books/${bk.bookId}`}
                  className="eo-row"
                  onClick={() => rememberScroll(scrollKey, window.scrollY)}
                >
                  {bk.coverUrl
                    ? <img className="eo-row__cover" src={bk.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    : <span className="eo-row__cover" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{bk.title}</span>
                    <span className="eo-utility mt-1 block truncate">
                      {[bk.author, bk.publisher, bk.publicationYear].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {empty && (
          <div className="eo-empty mt-2">
            <p className="eo-body">&ldquo;{q}&rdquo;와 맞는 책을 찾지 못했어요. 제목 일부나 저자 이름만으로도 찾을 수 있어요.</p>
            <button className="eo-text-button" onClick={() => setInput('')}>검색어 지우기</button>
          </div>
        )}

        {error && !isFetching && (
          <div className="eo-empty mt-2" role="alert">
            <p className="eo-body">
              {isSearchUnavailable(error)
                ? '검색 서비스를 잠시 사용할 수 없어요. 조금 뒤에 다시 시도해 주세요.'
                : '검색 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
