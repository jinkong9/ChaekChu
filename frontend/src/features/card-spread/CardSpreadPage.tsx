import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { toBookSummary } from '../../api/books'
import { addToLibrary } from '../../api/library'
import { useFinishModalStore } from '../../stores/finishModalStore'
import type { BookDetail, BookSummary, CoLoansResponse, ShelfStatus } from '../../api/types'
import { coverAtWidth } from '../../lib/coverUrl'
import { trackEvent } from '../../lib/events'
import { ean13Bars, ean13Modules } from './ean13'
import './card-spread.css'

/** BOOK-001 도서 상세 B안 — 도서 카드 펼침면.
 *  A안(BookDetailPageSpread)과 같은 계약을 쓰고 형식만 바꾼다: 왼쪽에 표지와 도서 카드를
 *  나란히 펼치고, 오른쪽에 표제·지표·읽을거리를 세우고, 아래에 세 단으로 이웃 책을 둔다.
 *
 *  계약에 아직 없어 시안용으로 임시 경로를 쓰는 것 셋 (docs/BACKEND_DATA_CONTRACT.md 합의 대기):
 *   - keywords         : 'AI 추천 키워드' — BookDetail의 선택 필드로 가정
 *   - /similar         : 비슷한 책(소개 임베딩)
 *   - /co-loans        : 함께 대출된 책(정보나루)
 *  세 곳 모두 값이 없으면 그 자리를 비우고 왜 비었는지 적는다 — 가짜 데이터를 채우지 않는다. */

/** 시안 단계의 확장 — 계약에 들어가면 api/types.ts로 옮긴다 */
type BookDetailDraft = BookDetail & { keywords?: string[] | null }

const CTA_LABEL: Record<ShelfStatus, string> = { READ: '읽었어요', WISH: '읽고 싶어요' }

/** 카드에 인쇄된 문장 — 책이 아니라 서비스의 말이다 */
const CARD_LINE = '“당신의 오늘도,\n좋은 책과 함께하길.”'

/** 표지가 실제로 그려지는 최대 폭 — coverUrl 판(版) 선택에 쓴다 */
const COVER_W = { spread: 320, tile: 150 }

/** 아이콘은 선 굵기 1.5 하나로 통일한다 (DESIGN.md Shapes — 꼭 필요한 자리에만) */
function Icon({ d, ...rest }: { d: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}><path d={d} /></svg>
  )
}
const PATH = {
  bookmark: 'M4 2h8v12l-4-3-4 3V2z',
  check: 'M3 8.4l3.2 3.1L13 4.8',
  chart: 'M2.5 13.5v-4M6.5 13.5v-8M10.5 13.5v-5M14 13.5v-10',
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z',
  book: 'M2 3.2h4.2c1 0 1.8.8 1.8 1.8v8c0-1-.8-1.8-1.8-1.8H2v-8zM14 3.2H9.8c-1 0-1.8.8-1.8 1.8v8c0-1 .8-1.8 1.8-1.8H14v-8z',
  chevron: 'M4 6l4 4 4-4',
}

/** 카드의 바코드 — ISBN-13을 EAN-13으로 인코딩한다. 읽히지 않는 ISBN이면 렌더하지 않는다 */
function Barcode({ isbn13 }: { isbn13: string | null }) {
  const modules = ean13Modules(isbn13)
  if (!modules) return null
  return (
    <svg className="bd-barcode" viewBox={`0 0 ${modules.length} 30`} preserveAspectRatio="none"
      role="img" aria-label={`ISBN ${isbn13} 바코드`}>
      {ean13Bars(modules).map(([x, w]) => <rect key={x} x={x} y="0" width={w} height="30" />)}
    </svg>
  )
}

/** 표지 넷 — 홈 타일과 같은 리듬(순위 없이 표지·제목·저자) */
function BookTiles({ items }: { items: BookSummary[] }) {
  return (
    <div className="bd-list">
      {items.slice(0, 4).map((bk) => (
        <Link key={bk.bookId} to={`/books/${bk.bookId}`} className="eo-tile">
          {bk.coverUrl
            ? <img className="eo-cover" src={coverAtWidth(bk.coverUrl, COVER_W.tile)!} alt=""
                referrerPolicy="no-referrer" loading="lazy" decoding="async" />
            : <span className="eo-cover-fallback">{bk.title}</span>}
          <span className="eo-tile__title">{bk.title}</span>
          <span className="eo-tile__author">{bk.author}</span>
        </Link>
      ))}
    </div>
  )
}

export default function CardSpreadPage() {
  const { bookId } = useParams()
  const [params] = useSearchParams()
  const fromRec = params.get('from') === 'rec' // 추천 경유 시에만 이유 문구 노출

  const qc = useQueryClient()
  const openFinish = useFinishModalStore((s) => s.open)
  const { data: book, isPending, isError, refetch } = useQuery({
    queryKey: ['book', bookId],
    queryFn: async () => (await api.get<BookDetailDraft>(`/books/${bookId}`)).data,
  })
  // 이웃 책은 상세와 별개로 온다 — 실패해도 상세 화면은 그대로 뜬다
  const similar = useQuery({
    queryKey: ['book', bookId, 'similar'],
    queryFn: async () => (await api.get<{ items: BookSummary[] }>(`/books/${bookId}/similar`)).data.items,
    retry: false,
  })
  const coLoans = useQuery({
    queryKey: ['book', bookId, 'co-loans'],
    // 서버는 {book, rank} 로 준다(§4.6) — 타일은 책만 그리므로 검색과 같은 어댑터로 화면 타입에 맞춘다
    queryFn: async () => (await api.get<CoLoansResponse>(`/books/${bookId}/co-loans`)).data.items.map((i) => toBookSummary(i.book)),
    retry: false,
  })

  // 로그인 사용자의 개인화 입력 — 같은 도서를 반복 조회해도 세션당 한 번만 전송한다.
  const viewedBookId = useRef<number | null>(null)
  useEffect(() => {
    if (book && viewedBookId.current !== book.bookId) {
      viewedBookId.current = book.bookId
      trackEvent('BOOK_VIEW', { bookId: book.bookId })
    }
  }, [book])

  if (isError) {
    return (
      <main className="eo-page bd-page">
        <div className="eo-state">
          <p className="eo-body eo-body--ink">책을 불러오지 못했습니다.</p>
          <button className="eo-link" onClick={() => refetch()}>다시 시도</button>
        </div>
      </main>
    )
  }

  if (isPending || !book) {
    return (
      <main className="eo-page bd-page">
        <div className="eo-state">
          <span className="eo-progress" />
          <p className="eo-body">책을 불러오는 중</p>
        </div>
      </main>
    )
  }

  const save = (status: ShelfStatus) => {
    // 읽음은 완독 모달을 거친다(별점·한줄평·완독일). 이미 서재에 있으면 그 기록을 채워 열어 수정이 된다
    if (status === 'READ') {
      openFinish({ bookId: book.bookId, title: book.title, libraryItemId: book.my?.libraryItemId,
        rating: book.my?.rating, reviewText: book.my?.reviewText, finishedDate: book.my?.status === 'READ' ? book.my.finishedDate : undefined })
      return
    }
    trackEvent('WISH', { bookId: book.bookId })
    addToLibrary(book.bookId, status)
      .then(() => { qc.invalidateQueries({ queryKey: ['library'] }); qc.invalidateQueries({ queryKey: ['book', bookId] }) })
      .catch(() => {})
  }

  const loans = book.loanByAge ?? []
  // 막대는 값이 아니라 서로의 비율이 읽혀야 한다 — 최댓값을 100%로 잡는다
  const peakRatio = Math.max(...loans.map((a) => a.ratio), 1)
  const keywords = book.keywords ?? []
  // 카드의 항목 — 값이 없는 줄은 카드에 인쇄하지 않는다
  const cardRows: [string, string][] = [
    ['제목', book.title],
    ['지은이', book.author ?? ''],
    ['출판사', book.publisher ?? ''],
    ['출판연도', book.publicationYear ? String(book.publicationYear) : ''],
    ['쪽수', book.pageCount ? `${book.pageCount}쪽` : ''],
    ['분류', book.category ?? ''],
  ]
  // 출처별 지표 — 카드에 없는 것만. 분류는 카드에 적혀 있으므로 여기서 빼고 출처·기준일을 붙인다
  const facts = book.metrics.map((m, i) => ({
    key: `${m.source}-${m.name}`, name: m.name, value: m.value,
    source: `${m.source} · ${m.asOf}`, icon: i === 0 ? PATH.chart : PATH.star,
  }))

  return (
    <main className="eo-page bd-page">
      <div className="bd-shell">
        <div className="bd-top">
          {/* ---- 왼쪽: 펼친 지면(표지 + 도서 카드)과 그 아래 행동 ---- */}
          <section>
            <div className="bd-spread">
              <div className="bd-mount">
                {book.coverUrl
                  ? <img src={coverAtWidth(book.coverUrl, COVER_W.spread)!} alt={`${book.title} 표지`}
                      referrerPolicy="no-referrer" decoding="async" />
                  : <span>{book.title}</span>}
              </div>

              <article className="bd-card">
                <header className="bd-card__head">
                  <p className="bd-card__brand">책추책책추<em>Library</em></p>
                  <p className="bd-card__stamp">A book<br />for a brighter you</p>
                </header>

                <dl className="bd-card__rows">
                  {cardRows.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd title={v}>{v}</dd>
                    </div>
                  ))}
                </dl>

                <p className="bd-card__quote">{CARD_LINE}</p>

                <Barcode isbn13={book.isbn13} />
                <p className="bd-card__isbn">Bookchu Library</p>
              </article>
            </div>

            {/* 행동은 이 둘뿐이다 — 서재 2단(READ/WISH)과 하나씩 짝이 맞는다.
                라벨은 상태에 따라 바뀌지 않고, 기록된 쪽에 체크가 붙어 지금 무엇이 담겨 있는지 알린다 */}
            <div className="bd-cta">
              <button className="eo-button" onClick={() => save('READ')} aria-pressed={book.my?.status === 'READ'}>
                {book.my?.status === 'READ' && <Icon d={PATH.check} />}
                {CTA_LABEL.READ}
              </button>
              <button className="bd-button-ghost" onClick={() => save('WISH')} aria-pressed={book.my?.status === 'WISH'}>
                <Icon d={book.my?.status === 'WISH' ? PATH.check : PATH.bookmark} />
                {CTA_LABEL.WISH}
              </button>
            </div>
          </section>

          {/* ---- 오른쪽: 표제·지표·읽을거리 ---- */}
          <section>
            {/* 카드에 적힌 서지(지은이·출판사·출판연도·쪽수·분류·ISBN)는 여기서 되풀이하지 않는다.
                제목만 예외로 둔다 — 지면의 표제이자 이 화면의 h1이라 카드의 제목 칸과 겹쳐도 값이 있다 */}
            <p className="bd-eyebrow">
              {fromRec ? '추천으로 들어왔을 때만 보이는 이유 한 줄' : '조금 더 나은 나를 위한 한 권'}
            </p>
            <h1 className="bd-headline">{book.title}</h1>

            {facts.length > 0 && (
              <dl className="bd-facts">
                {facts.map((f) => (
                  <div key={f.key}>
                    <dt>{f.name}<em>{f.source}</em></dt>
                    <dd><span title={f.value}>{f.value}</span><Icon d={f.icon} width="16" height="16" /></dd>
                  </div>
                ))}
              </dl>
            )}

            {book.description && (
              <section className="bd-block">
                <div className="bd-block__head">
                  <h2 className="eo-title">책 소개</h2>
                  <span>카카오 / YES24</span>
                </div>
                <p className="bd-prose">{book.description}</p>
              </section>
            )}

            {book.toc && (
              <details className="bd-block">
                <summary className="bd-block__head">
                  <h2 className="eo-title">목차</h2>
                  <span>펼쳐보기<Icon d={PATH.chevron} width="13" height="13" /></span>
                </summary>
                <p className="bd-toc">{book.toc}</p>
              </details>
            )}

            <section className="bd-block">
              <div className="bd-block__head">
                <h2 className="eo-title">이런 분께 추천해요</h2>
                <span>AI 추천 키워드</span>
              </div>
              {keywords.length > 0
                ? <div className="bd-tags">{keywords.map((k) => <span key={k} className="eo-tag">{k}</span>)}</div>
                : <p className="bd-note">이 책의 AI 추천 키워드가 아직 없습니다. 소개·목차 임베딩 키워드가 붙으면 이 자리에 들어갑니다.</p>}
            </section>
          </section>
        </div>

        {/* ---- 아래쪽 세 단 ---- */}
        <div className="bd-bottom">
          <section>
            <div className="bd-block__head">
              <h2 className="eo-title">이 책을 빌린 사람들</h2>
              <span>정보나루</span>
            </div>
            {loans.length > 0
              ? (
                <div className="bd-ages">
                  {loans.map((a) => (
                    <div key={a.ageGroup}>
                      <b>{Math.round(a.ratio)}%</b>
                      <i style={{ height: `${(a.ratio / peakRatio) * 100}%` }} />
                      <small>{a.ageGroup}</small>
                    </div>
                  ))}
                </div>
              )
              : <p className="bd-list__empty">이 책의 연령대별 대출 기록이 아직 없습니다.</p>}
          </section>

          <section>
            <div className="bd-block__head">
              <h2 className="eo-title">비슷한 책</h2>
              <span>소개 임베딩</span>
            </div>
            {similar.data?.length
              ? <BookTiles items={similar.data} />
              : <p className="bd-list__empty">소개 임베딩 색인이 붙으면 이 자리가 채워집니다.</p>}
          </section>

          <section>
            <div className="bd-block__head">
              <h2 className="eo-title">함께 대출된 책</h2>
              <span>정보나루</span>
            </div>
            {coLoans.data?.length
              ? <BookTiles items={coLoans.data} />
              : <p className="bd-list__empty">정보나루 함께 대출 데이터가 붙으면 이 자리가 채워집니다.</p>}
          </section>
        </div>
      </div>
    </main>
  )
}
