import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { toBookSummary } from '../../api/books'
import type { BookDetail, BookSummary, CoLoansResponse, SimilarResponse } from '../../api/types'
import ShelfActions from '../../components/ShelfActions'
import { coverAtWidth } from '../../lib/coverUrl'
import { trackEvent } from '../../lib/events'
import { ean13Bars, ean13Modules } from './ean13'
import './card-spread.css'

/** BOOK-001 도서 상세 — 도서 카드 펼침면(확정안). 왼쪽에 표지와 도서 카드를
 *  나란히 펼치고, 오른쪽에 표제·지표·읽을거리를 세우고, 아래에 두 단으로 이웃 책을 둔다.
 *
 *  「이 책을 빌린 사람들」(연령대별 대출)은 뺐다 — 정보나루 loan_grps 수집률이 낮아 적재하지 않기로 했고(API_SPEC §4.4),
 *  화면에는 늘 「기록이 아직 없습니다」 한 줄만 서 있었다. BookDetail.loanByAge 는 계약에 남으니 값이 붙으면 되살린다.
 *
 *  /similar(§4.5) · /co-loans(§4.6) 는 계약에 들어왔다. 아직 임시인 것은 keywords 하나다
 *  ('AI 추천 키워드' — BookDetail 의 선택 필드로 가정, docs/BACKEND_DATA_CONTRACT.md 합의 대기).
 *  세 자리 모두 값이 없으면 비우고 왜 비었는지 적는다 — 가짜 데이터를 채우지 않는다.
 *  /similar 는 임베딩 적재가 진행 중이라 빈 배열이 잦다(§4.5). 그것도 정상 응답이다. */

/** 시안 단계의 확장 — 계약에 들어가면 api/types.ts로 옮긴다 */
type BookDetailDraft = BookDetail & { keywords?: string[] | null }


/** 카드에 인쇄된 문장 — 책이 아니라 서비스의 말이다 */
const CARD_LINE = '“당신의 오늘도,\n좋은 책과 함께하길.”'

/** 표지가 실제로 그려지는 최대 폭 — coverUrl 판(版) 선택에 쓴다 */
const COVER_W = { spread: 320, tile: 150 }

/** 원본을 몇 배까지 늘려 걸 것인가.
 *  표지 원본은 책마다 폭이 다르다 — 알라딘 cover500 은 「있으면 500」이라, 원본이 작은 책은
 *  같은 주소로 200 이나 85 짜리가 온다. 원본 크기 그대로 걸면 그런 책은 250px 짜리 흰 대지 한가운데
 *  우표만 하게 붙어 「왜 나만 작지」로 보이고, 대지를 꽉 채우면 3배로 늘어나 뭉갠다.
 *  1.5배까지만 늘리고 그 위로는 원본을 지킨다 — 작은 책도 자리는 차지하되 문질러지지는 않는다. */
const COVER_MAX_UPSCALE = 1.5

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
}

/** 지표 아이콘은 값의 성격을 따른다 — 별점은 별, 대출 횟수는 책, 순위처럼 분포를 읽는 값은 막대.
 *  서버가 보내는 이름(API_SPEC §4.4)으로 고르고, 모르는 이름이면 막대로 둔다 */
function factIcon(name: string) {
  if (name.includes('별점')) return PATH.star
  if (name.includes('대출') && !name.includes('순위')) return PATH.book
  return PATH.chart
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

/** 이웃 책은 한 단에 여섯 권 — 연령대 단이 빠지며 넓어진 단 폭을 표지 크기가 아니라 권수로 받는다 */
const NEIGHBOR_COUNT = 6

/** 불러오는 동안 타일 자리를 지킨다 — 비었다는 문구를 먼저 보여주면 「없다」로 읽힌다.
 *  유사도 계산이 AI 왕복이라 1초 안팎 걸리는데, 그 사이 「임베딩이 붙으면 채워집니다」가 떴다가
 *  결과가 와서 바뀌면 화면이 두 번 말을 바꾸는 셈이다. */
function TileSkeletons() {
  return (
    <div className="bd-list" aria-hidden="true">
      {Array.from({ length: NEIGHBOR_COUNT }, (_, i) => (
        <div key={i} className="eo-tile">
          <span className="eo-cover eo-skeleton" />
          <span className="bd-tile__line eo-skeleton" />
          <span className="bd-tile__line bd-tile__line--short eo-skeleton" />
        </div>
      ))}
    </div>
  )
}

/** 표지 여섯 — 홈 타일과 같은 리듬(순위 없이 표지·제목·저자) */
function BookTiles({ items }: { items: BookSummary[] }) {
  return (
    <div className="bd-list">
      {items.slice(0, NEIGHBOR_COUNT).map((bk) => (
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
  const { data: book, isPending, isError, refetch } = useQuery({
    queryKey: ['book', bookId],
    queryFn: async () => (await api.get<BookDetailDraft>(`/books/${bookId}`)).data,
  })
  // 이웃 책은 상세와 별개로 온다 — 실패해도 상세 화면은 그대로 뜬다
  const similar = useQuery({
    queryKey: ['book', bookId, 'similar'],
    // 서버는 {book, reason, score} 로 준다(§4.5) — 타일은 책만 그리므로 co-loans 와 같은 어댑터로 화면 타입에 맞춘다.
    // size 는 BookTiles 가 그리는 수와 같게 둔다(기본 8 을 받아 둘을 버리지 않는다).
    queryFn: async () => (await api.get<SimilarResponse>(`/books/${bookId}/similar`, { params: { size: NEIGHBOR_COUNT } }))
      .data.items.map((i) => toBookSummary(i.book)),
    retry: false,
  })
  const coLoans = useQuery({
    queryKey: ['book', bookId, 'co-loans'],
    // 서버는 {book, rank} 로 준다(§4.6) — 타일은 책만 그리므로 검색과 같은 어댑터로 화면 타입에 맞춘다
    queryFn: async () => (await api.get<CoLoansResponse>(`/books/${bookId}/co-loans`, { params: { size: NEIGHBOR_COUNT } }))
      .data.items.map((i) => toBookSummary(i.book)),
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
  // 출처별 지표 — 카드에 없는 것만. 분류는 카드에 적혀 있으므로 여기서 빼고 출처·기준일을 붙인다.
  // 지금 서버가 보내는 넷(순위·누적 대출·최근 3개월 대출·소장 도서관)이 한 줄에 나란히 선다
  const facts = book.metrics.map((m) => ({
    key: `${m.source}-${m.name}`, name: m.name, value: m.value,
    source: `${m.source} · ${m.asOf}`, icon: factIcon(m.name),
  }))

  return (
    <main className="eo-page bd-page">
      <div className="bd-shell">
        <div className="bd-top">
          {/* ---- 왼쪽: 펼친 지면(표지 + 도서 카드)과 그 아래 행동 ---- */}
          <section className="bd-object">
            <div className="bd-spread">
              <div className="bd-mount">
                {book.coverUrl
                  /* key 로 책마다 새 <img> 를 받는다 — 같은 노드를 돌려 쓰면 앞 책의 상한이
                     새 표지가 뜨기 전까지 남아 큰 표지가 잠깐 작게 걸린다 */
                  ? <img key={book.coverUrl} src={coverAtWidth(book.coverUrl, COVER_W.spread)!} alt={`${book.title} 표지`}
                      referrerPolicy="no-referrer" decoding="async"
                      /* 받아 보기 전에는 원본이 몇 px 인지 알 수 없다 — 떠야 알 수 있으므로 그때 상한을 적어 준다 */
                      onLoad={(e) => e.currentTarget.style.setProperty(
                        '--bd-cover-cap', `${Math.round(e.currentTarget.naturalWidth * COVER_MAX_UPSCALE)}px`)} />
                  : <span>{book.title}</span>}
              </div>

              <article className="bd-card">
                <header className="bd-card__head">
                  <p className="bd-card__brand">Library Card</p>
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

            {/* 행동은 이 둘뿐이다 — 서재 2단(READ/WISH)과 하나씩 짝이 맞는다. 버튼 한 벌은 components/ShelfActions —
                가챠·월드컵 결과도 같은 것을 쓴다. 서재가 바뀌면 이 책의 `my` 도 바뀌므로 상세 캐시를 함께 비운다 */}
            <ShelfActions className="bd-cta-wrap" bookId={book.bookId} title={book.title} my={book.my}
              onChanged={() => qc.invalidateQueries({ queryKey: ['book', bookId] })} />
          </section>

          {/* ---- 오른쪽 위: 표제 ----
              좁은 폭에서는 이 머리만 펼침면 위로 올라간다(card-spread.css .bd-top).
              표지 한 장과 도서 카드 한 장이 각각 한 화면을 차지하는 탓에,
              한 단으로 누우면 책 제목을 보려고 두 번 쓸어내려야 했다.
              지표까지 함께 올리지는 않는다 — 네 칸이 세로로 눕는 폭에서는 그것만 450px 라,
              제목 다음에 숫자 넉 줄을 지나야 표지가 나온다. 숫자는 책을 본 뒤에 읽는 것이다. */}
          <header className="bd-lead">
            {/* 카드에 적힌 서지(지은이·출판사·출판연도·쪽수·분류·ISBN)는 여기서 되풀이하지 않는다.
                제목만 예외로 둔다 — 지면의 표제이자 이 화면의 h1이라 카드의 제목 칸과 겹쳐도 값이 있다 */}
            <p className="bd-eyebrow">
              {fromRec ? '추천으로 들어왔을 때만 보이는 이유 한 줄' : '조금 더 나은 나를 위한 한 권'}
            </p>
            <h1 className="bd-headline">{book.title}</h1>
          </header>

          {/* ---- 오른쪽 아래: 지표와 읽을거리 ----
              두 단일 때는 바로 위 표제에 붙어 지금까지와 같은 자리에 선다 */}
          <section className="bd-read">
            {facts.length > 0 && (
              <dl className="bd-facts">
                {facts.map((f) => (
                  <div key={f.key}>
                    <dt>{f.name}<em>{f.source}</em></dt>
                    <dd><span title={f.value}>{f.value}</span><Icon d={f.icon} width="13" height="13" /></dd>
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

            {/* 두 절 사이의 늘어나는 여백 — 왼쪽 펼침면이 더 길 때 그 차이를 여기서 받아
                두 단이 같은 선에서 끝난다. 56px 까지만 벌어지므로, 소개가 아주 짧은 책에서
                절 사이에 구멍이 뚫리지는 않는다(그때는 예전처럼 그냥 어긋난 채로 둔다). */}
            <span className="bd-slack" aria-hidden="true" />

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

        {/* ---- 아래쪽 두 단 ---- */}
        <div className="bd-bottom">
          <section aria-busy={similar.isPending}>
            <div className="bd-block__head">
              <h2 className="eo-title">비슷한 책</h2>
              <span>소개 임베딩</span>
            </div>
            {similar.isPending
              ? <TileSkeletons />
              : similar.data?.length
                ? <BookTiles items={similar.data} />
                : <p className="bd-list__empty">이 책과 닮은 책을 아직 찾지 못했어요. 소개 임베딩 색인이 넓어지면 채워집니다.</p>}
          </section>

          <section aria-busy={coLoans.isPending}>
            <div className="bd-block__head">
              <h2 className="eo-title">함께 대출된 책</h2>
              <span>정보나루</span>
            </div>
            {coLoans.isPending
              ? <TileSkeletons />
              : coLoans.data?.length
                ? <BookTiles items={coLoans.data} />
                : <p className="bd-list__empty">이 책과 함께 빌린 기록이 아직 없어요.</p>}
          </section>
        </div>
      </div>
    </main>
  )
}
