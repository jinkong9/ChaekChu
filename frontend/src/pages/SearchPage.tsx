import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { isSearchUnavailable, searchBooks } from '../api/books'
import type { BookSummary } from '../api/types'
import { KDC_MAIN, isValidKdc, kdcLabel } from '../lib/kdc'

/** 검색 위치를 남겨 두는 자리 — 히스토리 항목(location.key)마다 목록 스크롤 offset 하나.
 *  Safari 프라이빗 모드처럼 저장이 막히는 곳에서도 이동은 막히면 안 된다. */
function rememberScroll(key: string, y: number) {
  try { sessionStorage.setItem(key, String(y)) } catch { /* 저장 못 해도 검색은 그대로 */ }
}
function recallScroll(key: string) {
  try { return Number(sessionStorage.getItem(key)) || 0 } catch { return 0 }
}

/** 한 번에 받는 결과 수 — 서버 기본값(20)과 같게 둔다(§4.1: 1~50) */
const PAGE_SIZE = 20
/** 서버 탐색 한도(§4.1) — from+size 가 이를 넘으면 400. size 20 이면 500쪽까지 */
const EXPLORE_LIMIT = 10_000
const MAX_PAGE = Math.floor(EXPLORE_LIMIT / PAGE_SIZE)
/** 페이지 번호 창 — 현재 쪽 좌우로 이만큼 */
const PAGE_WINDOW = 4

/** 검색 결과 행의 표지 — URL 이 깨진 책(네이버 404 등)은 서재·홈과 같은 규칙으로 제목 글자 자리로 바꾼다 */
function RowCover({ book }: { book: BookSummary }) {
  const [broken, setBroken] = useState(false)
  if (!book.coverUrl || broken) return <span className="eo-row__cover" aria-hidden />
  return <img className="eo-row__cover" src={book.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
}

/** 쪽 번호 목록 — 1·끝은 항상, 현재 ±PAGE_WINDOW, 벌어진 곳은 '…'(null) */
function pageNumbers(current: number, last: number): (number | null)[] {
  if (last <= PAGE_WINDOW * 2 + 3) return Array.from({ length: last }, (_, i) => i + 1)
  const set = new Set<number>([1, last])
  for (let p = current - PAGE_WINDOW; p <= current + PAGE_WINDOW; p++) if (p >= 1 && p <= last) set.add(p)
  const sorted = [...set].sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push(null); out.push(p) })
  return out
}

/** EXP-001 통합 검색 — 검색어(q)와 분류 토큰(kdc)을 함께 쓴다. GET /books/search (§4.1).
 *  - 정렬은 서버가 정한다: q 가 있으면 관련도, kdc 만이면 누적 대출순. 정렬 선택 UI 는 두지 않는다(명세).
 *  - 분류는 "필터 패널"이 아니라 검색창 옆 토큰이다 — 사용자에겐 검색어의 일부, 서버엔 정확한 filter.
 *  - 쪽은 URL ?page= (1부터). 서버는 0부터라 보낼 때 -1. 탐색 한도 10,000건 — 그 위는 쪽 번호를 만들지 않고 좁히기를 안내한다.
 *
 *  검색어·분류·쪽은 전부 URL 에 둔다 — 상세로 갔다 뒤로 오면 이 화면은 새로 마운트되므로 state 로는 남지 않는다.
 *  타이핑 중 갱신은 replace(글자마다 히스토리가 쌓이지 않게), 칩·쪽 이동은 push(뒤로가기로 되돌릴 수 있게). */
export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const q = params.get('q') ?? ''
  const kdcParam = params.get('kdc')
  const kdc = isValidKdc(kdcParam) ? kdcParam : ''
  const pageParam = Number(params.get('page') ?? 1)
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? Math.min(pageParam, MAX_PAGE) : 1
  const [input, setInput] = useState(q)
  // 히스토리 항목마다 다른 키 — 뒤로 와서 되돌아온 항목은 key 가 같아 그때 저장한 위치를 찾는다
  const scrollKey = `search-scroll:${location.key}`

  /** URL 갱신 한 곳 — 비어 있는 값은 빼고, 1쪽은 ?page= 를 생략해 주소를 짧게 둔다 */
  const update = (next: { q?: string; kdc?: string; page?: number }, replace = false) => {
    const nq = next.q ?? q
    const nk = next.kdc ?? kdc
    const np = next.page ?? 1
    const sp: Record<string, string> = {}
    if (nq) sp.q = nq
    if (nk) sp.kdc = nk
    if (np > 1) sp.page = String(np)
    setParams(sp, { replace })
  }

  useEffect(() => {
    const next = input.trim()
    if (next === q) return
    // 검색어가 바뀌면 1쪽으로 — 분류 토큰은 유지한다
    const t = setTimeout(() => {
      const sp: Record<string, string> = {}
      if (next) sp.q = next
      if (kdc) sp.kdc = kdc
      setParams(sp, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [input, q, kdc, setParams])

  const tooLong = input.trim().length > 100
  const enabled = (q.length >= 1 && q.length <= 100) || kdc !== ''

  const { data, isFetching, error } = useQuery({
    queryKey: ['search', q, kdc, page],
    queryFn: () => searchBooks(q, page - 1, PAGE_SIZE, kdc || undefined),
    enabled,
    // 쪽을 넘길 때 이전 결과를 잠깐 유지해 목록이 깜빡 비지 않게 한다
    placeholderData: keepPreviousData,
    // 503(검색 엔진 불가)·400 은 다시 보내도 같다 — 재시도 없이 바로 안내. 그 외(네트워크)는 한 번만
    retry: (count, err) => !isSearchUnavailable(err) && count < 1,
    staleTime: 60_000,
    // 상세를 오래 보다 돌아와도 목록이 비어 보이지 않도록 캐시를 기본(5분)보다 길게 붙든다
    gcTime: 30 * 60_000,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const explorable = Math.min(total, EXPLORE_LIMIT)
  const lastPage = Math.max(1, Math.ceil(explorable / PAGE_SIZE))
  const empty = enabled && data != null && total === 0 && !isFetching
  const from = (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, explorable)

  // 목록이 처음 그려질 때 한 번만 — 표지는 크기가 고정(46px)이라 이미지 로딩과 무관하게 높이가 맞는다
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || items.length === 0) return
    restored.current = true
    const y = recallScroll(scrollKey)
    if (y > 0) window.scrollTo(0, y)
  }, [items.length, scrollKey])

  const goPage = (p: number) => {
    if (p < 1 || p > lastPage || p === page) return
    update({ page: p })
    window.scrollTo({ top: 0 })
  }
  const toggleKdc = (code: string) => update({ kdc: kdc === code ? '' : code, page: 1 })

  const summary = [q && `“${q}”`, kdc && `#${kdcLabel(kdc)}`].filter(Boolean).join(' · ')

  return (
    <main className="eo-page">
      <div className="eo-shell eo-shell--reading">
        <header className="eo-pagehead">
          <p className="eo-eyebrow">Search</p>
          <h1 className="eo-headline">도서 검색</h1>
        </header>

        {/* 검색창 — 상자 대신 밑줄 한 줄. 분류 토큰이 검색어 앞에 붙어 "검색어의 일부"로 읽힌다.
            돌아온 화면(?q= 있음)에서는 포커스를 뺏지 않는다 — 입력창으로 스크롤이 끌려가 읽던 자리를 잃는다 */}
        <div className="mt-7 flex items-center gap-2.5 border-b border-rule focus-within:border-ink">
          {kdc && (
            <button type="button" className="eo-tag is-on shrink-0" onClick={() => toggleKdc(kdc)} aria-label={`${kdcLabel(kdc)} 분류 해제`}>
              #{kdcLabel(kdc)}<span className="ml-1.5 opacity-70">×</span>
            </button>
          )}
          <input
            autoFocus={q === '' && kdc === ''}
            className="eo-field min-w-0 flex-1" style={{ border: 0 }}
            placeholder={kdc ? `${kdcLabel(kdc)} 안에서 찾기 — 비우면 대출 많은 순` : '제목·저자·출판사로 검색 (예: 데미안, ISBN) — 또는 아래 분류를 골라 시작'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="제목 또는 저자"
            maxLength={120}
          />
        </div>

        {/* 대분류 칩 — 검색어가 없어도 누르면 그 분류의 대출 많은 책이 나온다(서버 정렬 §4.1). 활성은 잉크 반전 */}
        <div className="mt-3.5 flex flex-wrap gap-2" role="group" aria-label="분류">
          {KDC_MAIN.map((k) => (
            <button key={k.code} type="button" className={`eo-tag ${kdc === k.code ? 'is-on' : ''}`}
              aria-pressed={kdc === k.code} onClick={() => toggleKdc(k.code)}>
              {k.label}
            </button>
          ))}
        </div>

        {/* 결과 개수는 목록 위에 고정 높이로 예약 — 타이핑 중 목록이 위아래로 흔들리지 않게 */}
        <p className="eo-utility mt-4 flex min-h-[1.2em] items-baseline justify-between gap-3 tabular-nums">
          <span>
            {tooLong
              ? '검색어는 100자까지예요.'
              : enabled && <>
                  {summary} · {total.toLocaleString()}건
                  {total > EXPLORE_LIMIT && ` · ${kdc && !q ? '대출순 ' : ''}상위 ${EXPLORE_LIMIT.toLocaleString()}건 표시`}
                  {isFetching && ' · 검색 중'}
                </>}
          </span>
          {enabled && total > 0 && <span>{page} / {lastPage}쪽</span>}
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
                  <RowCover book={bk} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{bk.title}</span>
                    <span className="eo-utility mt-1 block truncate">
                      {[bk.author, bk.publisher, bk.publicationYear, bk.category].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* 쪽 번호 — 1·끝 고정, 현재 ±4, 벌어진 곳은 … . 활성 쪽은 굵기·밑줄(새 색 없음). 탐색 한도 위의 쪽은 만들지 않는다 */}
        {enabled && total > 0 && lastPage > 1 && (
          <nav className="mt-6 flex flex-wrap items-center justify-center gap-1 text-[12px] tabular-nums" aria-label="쪽 이동">
            <button type="button" className="eo-link min-w-[30px] text-center disabled:opacity-30" disabled={page === 1} onClick={() => goPage(page - 1)} aria-label="이전 쪽">←</button>
            {pageNumbers(page, lastPage).map((p, i) =>
              p === null
                ? <span key={`gap-${i}`} className="min-w-[30px] text-center text-ink-faint">…</span>
                : <button key={p} type="button" onClick={() => goPage(p)} aria-current={p === page ? 'page' : undefined}
                    className={`min-h-[30px] min-w-[30px] border-b-2 px-1 transition-colors duration-150 ${
                      p === page ? 'border-ink font-bold text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
                    {p}
                  </button>)}
            <button type="button" className="eo-link min-w-[30px] text-center disabled:opacity-30" disabled={page === lastPage} onClick={() => goPage(page + 1)} aria-label="다음 쪽">→</button>
            <span className="eo-utility ml-3">{from.toLocaleString()}–{to.toLocaleString()} / {explorable.toLocaleString()}</span>
          </nav>
        )}
        {enabled && total > EXPLORE_LIMIT && page === lastPage && (
          <p className="eo-utility mt-3 text-center">
            여기까지가 한 번에 볼 수 있는 범위예요. {q ? '분류를 고르거나 검색어를 더 구체적으로' : '검색어를 넣어'} 좁혀 보세요.
          </p>
        )}

        {empty && (
          <div className="eo-empty mt-2">
            <p className="eo-body">
              {kdc && q
                ? <>{kdcLabel(kdc)} 분류 안에서는 &ldquo;{q}&rdquo;와 맞는 책이 없어요.</>
                : <>&ldquo;{q}&rdquo;와 맞는 책을 찾지 못했어요. 제목 일부나 저자 이름만으로도 찾을 수 있어요.</>}
            </p>
            {kdc && q
              ? <button className="eo-text-button" onClick={() => toggleKdc(kdc)}>분류 없이 찾기</button>
              : <button className="eo-text-button" onClick={() => setInput('')}>검색어 지우기</button>}
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
