import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import { useFinishModalStore } from '../stores/finishModalStore'
import { coverPalette } from '../lib/coverPalette'
import { coverAtWidth } from '../lib/coverUrl'
import LibraryList from '../components/LibraryList'
import bookArchiveTitle from '../assets/book-archive-title.webp'
import './LibraryPage.css'

/** LIB-001 내 서재 — 완독 기록을 한 권의 책으로 엮어 보이는 메인 화면.
 *
 *  팀에서 'D안'으로 부르던 시안이 확정돼 이 페이지가 됐다 — 비교용이던
 *  A 선반·B 나의 책·C 완독 기록은 같이 지웠다. 화면의 짜임은 이렇다:
 *
 *    왼쪽 위  읽음 / 찜 — 무엇을 볼지 고르는 자리
 *    오른쪽 위 책 기록 수정 — 고치는 자리는 서랍 하나로 모은다 (LibraryList)
 *    읽음     펼친 책 — 0장 속표지·목차, 이후 한 권이 한 장
 *             (왼쪽 면 = 표지, 오른쪽 면 = 제목과 평가)
 *    찜       선반 — 장르별로 나눠 꽂는다
 *
 *  책·표지·종이·넘김 물리는 LibraryPage.css 앞부분에 모여 있다. */

type Direction = -1 | 1
type Mode = 'read' | 'wish'

interface TurnState {
  direction: Direction
  progress: number
}

interface MotionState {
  direction: Direction | null
  progress: number
  target: number
  velocity: number
  lastTime: number
  frame: number
}

type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>

/** 한 면(--book-h)에 들어가는 목차 줄 수. 판면이 em 이라 책 크기가 변해도 이 값은 그대로다. */
const TOC_MAX = 11

/** 목차가 차지하는 장 수. 0장은 왼쪽이 속표지라 오른쪽 한 면(TOC_MAX 줄)뿐이고,
 *  그래도 남으면 양면(TOC_MAX*2)을 쓰는 목차 장이 이어진다.
 *  장 번호 ↔ 완독 순번을 옮기는 곳은 전부 이 값을 써야 한다 — 연표가 1로 고정해 두어,
 *  완독이 11권을 넘어 목차가 두 장이 되면 표지를 눌렀을 때 한 장씩 밀린 곳이 열렸다. */
const tocSheetCount = (readCount: number) =>
  1 + Math.max(0, Math.ceil((readCount - TOC_MAX) / (TOC_MAX * 2)))

/** 눈금으로 세울 수 있는 장 수. 넘으면 눈금 없이 화살표와 쪽수만 둔다 —
 *  스무 개가 넘는 눈금은 세어지지도, 눌러지지도 않는다. */
const TICK_MAX = 12

const ordinal = (n: number) => String(n).padStart(2, '0')

/** 분류 2단계의 마지막 세그먼트 ("문학 > 한국소설" → "한국소설") */
const categoryKey = (li: LibraryItem) => {
  const parts = (li.book.category ?? '').split(' > ').filter(Boolean)
  return parts[1] ?? parts[0] ?? '미분류'
}

const ymd = (d: string | null) => {
  if (!d) return null
  const [y, m, day] = d.split('-')
  return `${y}년 ${Number(m)}월 ${Number(day)}일`
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reduced
}

type BookMeta = { title: string; year: number; count: number; pages: number; rating: string | null }

/* ══════════════════ 지면 — 책 안에 들어가는 네 종류의 면 ══════════════════ */

/** 속표지 (0장 왼쪽) — 조용해야 맞은편 목차가 읽힌다 */
function FrontFace({ meta }: { meta: BookMeta }) {
  return (
    <div className="libd-face libd-front">
      <span className="libd-front__label">읽은 책으로 만든</span>
      <span className="libd-front__title">{meta.title}</span>
      <span className="libd-front__mark" />
      <dl className="libd-front__stats">
        <div><dt>완독</dt><dd>{meta.count}권</dd></div>
        {meta.pages > 0 && <div><dt>쪽수</dt><dd>{meta.pages.toLocaleString()}쪽</dd></div>}
        {meta.rating && <div><dt>평균 별점</dt><dd>★ {meta.rating}</dd></div>}
        <div><dt>엮은 해</dt><dd>{meta.year}</dd></div>
      </dl>
    </div>
  )
}

/** 목차 한 면 — read 의 from 번째부터 TOC_MAX 줄. 줄을 누르면 그 장으로 넘어간다.
 *  한 면에 다 못 담으면 다음 목차 장이 이어받는다 (ArchiveBook 의 tocSheets). */
function TocFace({ read, from, onPick }: {
  read: LibraryItem[]; from: number; onPick: (bookIndex: number) => void
}) {
  const shown = read.slice(from, from + TOC_MAX)
  // 마지막 목차 장의 남는 면 — 머리말만 덩그러니 놓지 않고 빈 지면으로 둔다
  if (read.length > 0 && shown.length === 0) return null


  return (
    <div className="libd-face">
      <span className="libd-face__eyebrow">{from === 0 ? '목차' : '목차 (이어서)'}</span>

      {read.length === 0 ? (
        <div className="libd-empty">
          <p className="libd-empty__title">아직 한 장도 없어요</p>
          <p className="libd-empty__body">완독한 책 한 권이<br />이 책의 한 장이 됩니다</p>
          <span className="libd-empty__links">
            <Link to="/recommend">추천 보러 가기</Link>
            <Link to="/search">책 검색</Link>
          </span>
        </div>
      ) : (
        <ul className="libd-toc">
          {shown.map((li, k) => {
            const i = from + k
            return (
              <li key={li.libraryItemId}>
                <button type="button" className="libd-toc__row" onClick={() => onPick(i)}>
                  <span className="libd-toc__no">{ordinal(i + 1)}</span>
                  <span className="libd-toc__title">{li.book.title}</span>
                  <span className="libd-toc__leader" />
                  <span className="libd-toc__rate">{li.rating != null ? `★ ${li.rating}` : '—'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** 한 권의 왼쪽 면 — 표지가 지면을 채우고, 그 아래 한 줄이 상세로 나간다.
 *  쪽번호 자리에 완독일을 적었었는데, 맞은편이 같은 날짜를 다시 말하고 있었다. */
function TitleFace({ li }: { li: LibraryItem }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 360) : null

  return (
    <div className="libd-face libd-face--cover">
      <span className="libd-title__cover" style={{ background: c.bg, color: c.fg }}>
        {url ? (
          <img src={url} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <span className="libd-title__cover-fallback">
            <b>{li.book.title}</b>
            <span>{li.book.author}</span>
          </span>
        )}
      </span>
      <Link className="libd-cover__detail" to={`/books/${li.book.bookId}`}>
        책 상세 보기<ArrowIcon direction="right" />
      </Link>
    </div>
  )
}

/** 한 권의 오른쪽 면 — 평가. 서재에 이미 있는 필드만 쓴다 (별점 · 완독일 · 감상평 · 분류 · 쪽수). */
function RateFace({ li, no }: { li: LibraryItem; no: number }) {
  const rating = li.rating ?? 0
  return (
    <div className="libd-face libd-face--record">
      <span className="libd-face__eyebrow">완독 기록</span>
      <span className="libd-title__name" title={li.book.title}>{li.book.title}</span>
      <span className="libd-title__by">
        {li.book.author}{li.book.publisher ? ` · ${li.book.publisher}` : ''}
      </span>
      <span className="libd-rate__rule" />

      {li.rating != null ? (
        <span className="libd-rate__stars">
          {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= rating ? 'is-on' : ''}>★</i>)}
          <b>{rating}.0</b>
        </span>
      ) : (
        <span className="libd-rate__none">아직 별점을 남기지 않았어요</span>
      )}

      <span className="libd-rate__when">
        {li.finishedDate ? `${ymd(li.finishedDate)} 완독` : '서비스를 만나기 전에 읽은 책'}
      </span>

      {li.reviewText ? (
        <p className="libd-rate__review">{li.reviewText}</p>
      ) : (
        <p className="libd-rate__blank">
          이 면은 아직 비어 있어요.<br />오른쪽 위 ‘책 기록 수정’에서 한 줄 남기면 여기에 적힙니다.
        </p>
      )}

      <span className="libd-rate__meta">
        <span className="libd-rate__tag">{categoryKey(li)}</span>
        {li.book.pageCount != null && <span className="libd-rate__pages">{li.book.pageCount}쪽</span>}
      </span>
      <span className="libd-face__folio libd-face__folio--right">{ordinal(no)}</span>
    </div>
  )
}

/* ══════════════════ 책 — 넘김 물리에 위 지면을 태운다 ══════════════════ */

/** 장 한 개. 0 = 속표지 + 목차, 1.. = 완독한 책 한 권. (표지는 isClosed 가 맡는다) */
type Sheet =
  | { kind: 'toc'; leftFrom: number | null; rightFrom: number }
  | { kind: 'book'; li: LibraryItem; no: number }

/** 펼친 책의 한 면. 지면을 누르면 그쪽으로 넘어간다 — 넘김 판을 위에 덮으면
 *  지면 안의 목차 줄·링크가 눌리지 않아서, 넘김을 지면 자신이 맡는다.
 *  (그 판이 목차를 가로막던 것이 LIB 목차 클릭 버그였다.) */
function BlankPage({ side, onTurn, children }: {
  side: 'left' | 'right'; onTurn: () => void; children?: ReactNode
}) {
  return (
    <span
      className={`libd-book__static-page libd-book__static-page--${side}`}
      onClick={(event) => {
        // 지면 위의 제 할 일이 있는 것(목차 줄·링크)은 그 일을 하게 두고, 그 밖은 넘김이다
        if ((event.target as HTMLElement).closest('button, a')) return
        onTurn()
      }}
    >
      <span className="libd-book__paper-light" aria-hidden="true" />
      {children}
    </span>
  )
}

function TurningPage({ progress, direction, front, back }: {
  progress: number; direction: Direction; front: ReactNode; back: ReactNode
}) {
  const turnEnvelope = Math.sin(Math.PI * progress)
  const landingDistance = direction === 1 ? 1 - progress : progress
  const landingRatio = Math.max(0, Math.min(1, landingDistance / 0.1))
  const landingOpacity = landingRatio * landingRatio * (3 - 2 * landingRatio)
  const pageStyle = {
    '--page-turn': `${-180 * progress}deg`,
    '--page-lift': `${18 * turnEnvelope}px`,
    '--page-tilt': `${-0.8 * turnEnvelope}deg`,
    '--page-squeeze': 1 - 0.018 * turnEnvelope,
    '--turn-envelope': turnEnvelope,
    '--landing-opacity': landingOpacity,
  } as StyleWithVars

  // 90도를 넘기면 앞면은 등을 돌린다. 그때 앞면의 내용을 비워야 한다 —
  // 두 면은 overflow:hidden 이라 평탄화되고, 그러면 그 위에 올린 내용에는
  // backface-visibility 가 걸리지 않아 글자가 뒷면에 거울처럼 비친다.
  const flipped = progress >= 0.5

  return (
    <span className="libd-book__turning-page" style={pageStyle} aria-hidden="true">
      <span className="libd-book__turn-face libd-book__turn-face--front">{flipped ? null : front}</span>
      <span className="libd-book__turn-face libd-book__turn-face--back">{flipped ? back : null}</span>
      <span className="libd-book__paper-edge" />
    </span>
  )
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`libd-arrow-icon ${direction === 'right' ? 'is-right' : ''}`}>
      <path d="M15 18 9 12l6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArchiveBook({ read, meta, index: currentIndex, onIndex, isClosed, onClosed }: {
  read: LibraryItem[]
  meta: BookMeta
  index: number
  onIndex: (i: number) => void
  isClosed: boolean
  onClosed: (closed: boolean) => void
}) {
  const reducedMotion = useReducedMotion()
  const [turn, setTurn] = useState<TurnState | null>(null)
  const indexRef = useRef(currentIndex)
  // 넘김 루프는 한 번 만들어 두고 계속 도는 콜백이라 최신 onIndex 를 ref 로 집는다
  const onIndexRef = useRef(onIndex)
  onIndexRef.current = onIndex
  const motionRef = useRef<MotionState>({
    direction: null,
    progress: 0,
    target: 0,
    velocity: 0,
    lastTime: 0,
    frame: 0,
  })

  // 목차는 한 면에 TOC_MAX 줄. 0장은 왼쪽이 속표지라 오른쪽 한 면뿐이고,
  // 그래도 남으면 양면을 쓰는 목차 장을 잇는다 — 모든 책이 목차에서 닿는다.
  const tocSheets: Extract<Sheet, { kind: 'toc' }>[] = Array.from(
    { length: tocSheetCount(read.length) },
    (_, k) => k === 0
      ? { kind: 'toc', leftFrom: null, rightFrom: 0 }
      : { kind: 'toc', leftFrom: TOC_MAX * (2 * k - 1), rightFrom: TOC_MAX * 2 * k },
  )
  const sheets: Sheet[] = [
    ...tocSheets,
    ...read.map((li, i) => ({ kind: 'book' as const, li, no: i + 1 })),
  ]
  // 장은 내용이 있는 만큼만 있고, 끝에서 처음으로 돌지 않는다.
  const lastRef = useRef(sheets.length - 1)
  lastRef.current = sheets.length - 1

  useEffect(() => {
    indexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => () => cancelAnimationFrame(motionRef.current.frame), [])

  // 완독한 책이 지워지면 커서가 목록 밖으로 나갈 수 있다
  const cursor = Math.min(currentIndex, sheets.length - 1)

  const settleTurn = useCallback((timestamp: number) => {
    const motion = motionRef.current
    const elapsed = motion.lastTime === 0 ? 1 / 60 : Math.min(0.032, (timestamp - motion.lastTime) / 1000)
    motion.lastTime = timestamp

    // Near-critical spring: the page carries momentum without bouncing like rubber.
    const stiffness = 72
    const damping = 17
    const acceleration = (motion.target - motion.progress) * stiffness - motion.velocity * damping
    motion.velocity += acceleration * elapsed
    motion.progress += motion.velocity * elapsed

    if (Math.abs(motion.target - motion.progress) < 0.001 && Math.abs(motion.velocity) < 0.006) {
      motion.progress = motion.target
      const direction = motion.direction
      const completed = direction === 1 ? motion.target === 1 : motion.target === 0

      if (direction && completed) {
        const nextIndex = Math.max(0, Math.min(lastRef.current, indexRef.current + direction))
        indexRef.current = nextIndex
        onIndexRef.current(nextIndex)
      }

      motion.direction = null
      motion.velocity = 0
      motion.lastTime = 0
      setTurn(null)
      return
    }

    if (motion.direction) {
      setTurn({
        direction: motion.direction,
        progress: Math.max(0, Math.min(1, motion.progress)),
      })
      motion.frame = requestAnimationFrame(settleTurn)
    }
  }, [])

  const requestTurn = useCallback((direction: Direction) => {
    if (isClosed) return
    const at = indexRef.current
    if (direction === 1 ? at >= lastRef.current : at <= 0) return

    if (reducedMotion) {
      indexRef.current = at + direction
      onIndexRef.current(at + direction)
      return
    }

    const motion = motionRef.current
    if (motion.direction) {
      motion.target = direction === motion.direction
        ? (motion.direction === 1 ? 1 : 0)
        : (motion.direction === 1 ? 0 : 1)
      return
    }

    motion.direction = direction
    motion.progress = direction === 1 ? 0 : 1
    motion.target = direction === 1 ? 1 : 0
    motion.velocity = direction * 0.08
    motion.lastTime = 0
    setTurn({ direction, progress: motion.progress })
    motion.frame = requestAnimationFrame(settleTurn)
  }, [isClosed, reducedMotion, settleTurn])

  const closeBook = useCallback(() => {
    if (!turn) onClosed(true)
  }, [turn, onClosed])

  /** 목차 줄 → 그 책의 장. 책은 목차 장 다음부터 놓인다 */
  const pickBook = (bookIndex: number) => jumpTo(tocSheets.length + bookIndex)

  /** 목차에서 곧장 그 장으로 — 넘기는 중에는 받지 않는다 */
  const jumpTo = (sheetIndex: number) => {
    if (turn) return
    const next = Math.max(0, Math.min(lastRef.current, sheetIndex))
    indexRef.current = next
    onIndex(next)
  }

  const leftOf = (s: Sheet | undefined): ReactNode =>
    !s ? null
      : s.kind === 'book' ? <TitleFace li={s.li} />
      : s.leftFrom === null ? <FrontFace meta={meta} />
      : <TocFace read={read} from={s.leftFrom} onPick={pickBook} />
  const rightOf = (s: Sheet | undefined): ReactNode =>
    !s ? null
      : s.kind === 'book' ? <RateFace li={s.li} no={s.no} />
      : <TocFace read={read} from={s.rightFrom} onPick={pickBook} />

  // 넘어가는 종이 한 장의 앞면은 먼저 놓인 장(A)의 오른쪽 면, 뒷면은 나중 장(B)의 왼쪽 면이다.
  // 그래서 -180도까지 돌면 B의 왼쪽 면이 왼쪽에 내려앉고, 미리 깔아 둔 B의 오른쪽 면이 드러난다.
  const iA = turn ? (turn.direction === 1 ? cursor : cursor - 1) : cursor
  const iB = turn ? (turn.direction === 1 ? cursor + 1 : cursor) : cursor
  const sheetA = sheets[iA]
  const sheetB = sheets[iB]

  // 넘어가는 장은 착지 직전 10% 동안 사라진다 (--landing-opacity). 그때 그 아래가
  // 아직 떠나온 장이면 옛 지면이 한 번 비친다. 그래서 90도를 넘겨 장이 그 면을 덮은
  // 뒤에는, 착지할 쪽 지면을 미리 도착할 장으로 바꿔 둔다 — 장에 가려 보이지 않는다.
  const covered = turn ? (turn.direction === 1 ? turn.progress > 0.5 : turn.progress < 0.5) : false
  const leftSheet = covered && turn?.direction === 1 ? sheetB : sheetA
  const rightSheet = covered && turn?.direction === -1 ? sheetA : sheetB


  return (
    <div
      className="libd__interaction"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          if (!isClosed) requestTurn(-1)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          if (!isClosed) requestTurn(1)
        }
      }}
    >
      {!isClosed && (
        <button
          type="button"
          className="libd__backdrop-close"
          aria-label="책 바깥 여백을 눌러 책 덮기"
          onClick={closeBook}
          disabled={Boolean(turn)}
        />
      )}
      <div className="libd__book-trigger">
        <span className={`libd__world ${isClosed ? 'is-closed' : ''}`}>
          <span className="libd-book">
            <span className="libd-book__back-cover libd-book__back-cover--left" />
            <span className="libd-book__back-cover libd-book__back-cover--right" />
            <span className="libd-book__page-block libd-book__page-block--left" />
            <span className="libd-book__page-block libd-book__page-block--right" />
            <BlankPage side="left" onTurn={() => requestTurn(-1)}>{leftOf(leftSheet)}</BlankPage>
            <BlankPage side="right" onTurn={() => requestTurn(1)}>{rightOf(rightSheet)}</BlankPage>
            {turn && (
              <TurningPage
                progress={turn.progress}
                direction={turn.direction}
                front={rightOf(sheetA)}
                back={leftOf(sheetB)}
              />
            )}
            <span className="libd-book__front-cover" aria-hidden="true">
              <span className="libd-book__front-cover-face libd-book__front-cover-face--outside">
                <small>BOOK EXPERIENCE</small>
                <img
                  className="libd-book__cover-title"
                  src={bookArchiveTitle}
                  alt=""
                />
                <span>PAGE · {ordinal(cursor + 1)}</span>
              </span>
              <span className="libd-book__front-cover-face libd-book__front-cover-face--inside" />
            </span>
            <span className="libd-book__gutter" />
            {isClosed && (
              <button
                type="button"
                className="libd-book__hit libd-book__hit--cover"
                aria-label="표지를 눌러 책 펼치기"
                onClick={() => onClosed(false)}
              />
            )}
          </span>
        </span>
      </div>

      <div className={`libd__controls ${isClosed ? 'is-hidden' : ''}`} aria-label="책 페이지 넘기기">
        <button type="button" className="libd__arrow" onClick={() => requestTurn(-1)}
          aria-label="이전 장" disabled={cursor <= 0}>
          <ArrowIcon direction="left" />
        </button>
        {sheets.length <= TICK_MAX && (
          <span className="libd__ticks">
            {sheets.map((s, i) => (
              <button
                key={s.kind === 'toc' ? `toc-${s.rightFrom}` : s.li.libraryItemId}
                type="button"
                className={`libd__tick ${i === cursor ? 'is-on' : ''}`}
                aria-label={s.kind === 'toc' ? '목차로' : `${s.li.book.title} 장으로`}
                aria-current={i === cursor || undefined}
                onClick={() => jumpTo(i)}
              />
            ))}
          </span>
        )}
        <span className="libd__folio"><b>{ordinal(cursor + 1)}</b> / {ordinal(sheets.length)}</span>
        <button type="button" className="libd__arrow" onClick={() => requestTurn(1)}
          aria-label="다음 장" disabled={cursor >= sheets.length - 1}>
          <ArrowIcon direction="right" />
        </button>
      </div>
    </div>
  )
}

/* ══════════════════ 완독 연표 — 책 아래 한 띠 ══════════════════ */

/** 책등 두께는 쪽수를 따른다 — 두꺼운 책이 띠에서도 더 넓은 자리를 차지한다.
 *  쪽수를 모르면 보통 두께로 둔다. */
const spineWidth = (pages?: number | null) =>
  Math.round(Math.min(34, Math.max(15, 15 + (pages ?? 260) / 45)))

/** 책등 — 쪽수만큼 두껍고, 표지의 책등 쪽 끝을 눌러 담지 않고 그대로 보인다.
 *  누르면 그 기록을 펼친다. */
function TimelineCover({ li, on, onPick }: { li: LibraryItem; on: boolean; onPick: () => void }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 140) : null
  const style: StyleWithVars = { background: c.bg, '--spine-w': `${spineWidth(li.book.pageCount)}px` }

  return (
    <button type="button" onClick={onPick}
      title={`${li.book.title}${li.book.pageCount ? ` · ${li.book.pageCount}쪽` : ''}`}
      aria-label={`${li.book.title} 장으로 넘기기`}
      className={`libd-timeline__cover ${on ? 'is-on' : ''}`}
      style={style}>
      {url
        ? <img key={li.libraryItemId} src={url} alt="" referrerPolicy="no-referrer"
            loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
        : <span key={li.libraryItemId} style={{ color: c.fg }}>{li.book.title}</span>}
    </button>
  )
}

/** 완독한 모든 책을 압축한 표지로 나란히 꽂는다. */
function TimelineMonth({ books, current, onJump }: {
  books: { li: LibraryItem; i: number }[]; current: number; onJump: (bookIndex: number) => void
}) {
  return (
    <div className="libd-timeline__slot">
      <div className="libd-timeline__spines">
        {books.map(({ li, i }) => (
          <TimelineCover key={li.libraryItemId} li={li} on={i === current} onPick={() => onJump(i)} />
        ))}
      </div>
    </div>
  )
}

/** 캘린더 대신 열두 달의 띠. 완독일만으로 그려지고, 표지를 누르면 그 장으로 넘어간다.
 *  (월 캘린더는 넣지 않는다: 서재에는 하루 단위 기록이 없어 31칸 중 한두 칸만 찬다) */
function Timeline({ read, year, current, onJump }: {
  read: LibraryItem[]; year: number; current: number; onJump: (bookIndex: number) => void
}) {
  const recorded = read.map((li) => Number(li.finishedDate?.slice(0, 4))).filter(Boolean)
  const newest = recorded.length ? Math.max(...recorded) : year
  const oldest = recorded.length ? Math.min(...recorded) : year
  // 기록이 있는 가장 이른 해부터 올해까지 — 중간에 빈 해가 있어도 건너뛰지 않는다.
  // 갈 해가 하나뿐이면 화살표를 아예 두지 않는다 (눌리지 않는 버튼은 고장처럼 보인다).
  const last = Math.max(newest, year)
  const years = Array.from({ length: last - oldest + 1 }, (_, k) => last - k)
  // 처음 펼칠 때는 가장 최근에 완독한 해로 — 올해 기록이 아직 없으면 빈 격자로 열리면 안 된다
  const [picked, setPicked] = useState(newest)
  const at = Math.max(0, years.indexOf(picked))
  const shown = years[at] ?? newest
  const thisMonth = new Date().getFullYear() === shown ? new Date().getMonth() + 1 : 0
  const inYear = read.filter((li) => li.finishedDate?.startsWith(String(shown))).length

  return (
    <section className="libd-timeline">
      <div className="libd-timeline__head">
        <h3>완독 연표</h3>
        {years.length > 1 ? (
          <div className="libd-timeline__years">
            <button type="button" aria-label="이전 해"
              onClick={() => setPicked(years[at + 1])} disabled={at >= years.length - 1}>
              <ArrowIcon direction="left" />
            </button>
            <b>{shown}</b>
            <button type="button" aria-label="다음 해"
              onClick={() => setPicked(years[at - 1])} disabled={at <= 0}>
              <ArrowIcon direction="right" />
            </button>
          </div>
        ) : (
          <div className="libd-timeline__years"><b>{shown}</b></div>
        )}
        <p>
          {inYear > 0
            ? '그 달에 완독한 책이 놓입니다 — 표지를 누르면 그 장으로 넘어가요'
            : `${shown}년에는 완독 기록이 없어요`}
        </p>
      </div>
      <div className="libd-timeline__grid">
        {Array.from({ length: 12 }, (_, k) => k + 1).map((m) => {
          const spines = read
            .map((li, i) => ({ li, i }))
            .filter(({ li }) => li.finishedDate?.startsWith(`${shown}-${String(m).padStart(2, '0')}`))
          return (
            <div className="libd-timeline__month" key={m}>
              <TimelineMonth books={spines} current={current} onJump={onJump} />
              <div className={`libd-timeline__label ${m === thisMonth ? 'is-now' : ''}`}>{m}월</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ══════════════════ 찜 — 선반을 이 무대 위로 ══════════════════ */

function ShelfCover({ li }: { li: LibraryItem }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 180) : null
  if (url) {
    return (
      <img className="libd-cover" src={url} alt={li.book.title} referrerPolicy="no-referrer"
        loading="lazy" decoding="async" onError={() => setBroken(true)} />
    )
  }
  return (
    <span className="libd-cover libd-cover--fallback" style={{ background: c.bg, color: c.fg }}>
      <b>{li.book.title}</b>
      <span>{li.book.author}</span>
    </span>
  )
}

/** 표지에 마우스를 올리면 뜨는 기록 쪽지. 책 → 쪽지로 마우스가 건너갈 시간을 주려고 닫기는 지연한다. */
function ShelfPop({ li, x, y, onEnter, onLeave }: {
  li: LibraryItem; x: number; y: number; onEnter: () => void; onLeave: () => void
}) {
  return (
    <div className="libd-pop" style={{ left: x, top: y }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <b>{li.book.title}</b>
      <small>{li.book.author} · {categoryKey(li)}</small>
      {li.reviewText && <p>{li.reviewText}</p>}
      <Link to={`/books/${li.book.bookId}`}>상세 보기</Link>
    </div>
  )
}

function WishShelves({ wish }: { wish: LibraryItem[] }) {
  const [pop, setPop] = useState<{ li: LibraryItem; x: number; y: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current) }, [])

  const showPop = (li: LibraryItem, el: HTMLElement) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    const r = el.getBoundingClientRect()
    setPop({ li, x: Math.max(128, Math.min(window.innerWidth - 128, r.left + r.width / 2)), y: r.top })
  }
  const hidePop = () => { hideTimer.current = setTimeout(() => setPop(null), 150) }
  const holdPop = () => { if (hideTimer.current) clearTimeout(hideTimer.current) }

  // 장르별로 나눠 꽂는다. 많이 꽂힌 선반이 위로 온다.
  const byGenre = [...wish.reduce((m, li) => {
    const k = categoryKey(li)
    m.set(k, [...(m.get(k) ?? []), li])
    return m
  }, new Map<string, LibraryItem[]>())].sort((a, b) => b[1].length - a[1].length)

  if (wish.length === 0) {
    return (
      <div className="libd-shelf">
        <div className="libd-shelf__empty">
          <p>찜한 책이 아직 없어요 — 오늘의 추천에서 한 권 꽂아 보세요.</p>
          <span className="libd-empty__links">
            <Link to="/recommend">추천 보러 가기</Link>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="libd-shelf">
      {byGenre.map(([genre, books]) => (
        <section className="libd-shelf__row" key={genre}>
          <div className="libd-shelf__head">
            <h3>{genre}</h3>
            <span>{books.length}권</span>
          </div>
          <div className="libd-shelf__display">
            <div className="libd-shelf__books">
              {books.map((li) => (
                <div key={li.libraryItemId} className="libd-shelf__book"
                  onMouseEnter={(e) => showPop(li, e.currentTarget)} onMouseLeave={hidePop}>
                  <Link to={`/books/${li.book.bookId}`} aria-label={`${li.book.title} 상세 보기`}
                    onFocus={(e) => showPop(li, e.currentTarget)} onBlur={hidePop}>
                    <ShelfCover li={li} />
                  </Link>
                </div>
              ))}
            </div>
          </div>
          <div className="libd-shelf__ledge" aria-hidden="true" />
          <i aria-hidden="true" />
        </section>
      ))}
      {pop && <ShelfPop li={pop.li} x={pop.x} y={pop.y} onEnter={holdPop} onLeave={hidePop} />}
    </div>
  )
}

/* ══════════════════ 고치는 자리 — 서랍 하나로 ══════════════════ */

const SORTS = [
  { key: 'recent', label: '최신순' },
  { key: 'rating', label: '별점순' },
] as const

type SortKey = (typeof SORTS)[number]['key']

/** 완독일이 빠른 순. 완독일이 없는 책(찜)은 뒤로 밀고, 그 안에서는 최근 고친 것부터(계약 §6 정렬 기준).
 *  libraryItemId 는 서버에서 문자열이라 뺄셈으로 순서를 매기지 않는다. */
const byRecent = (x: LibraryItem, y: LibraryItem) =>
  (y.finishedDate ?? '').localeCompare(x.finishedDate ?? '') || (y.updatedAt ?? '').localeCompare(x.updatedAt ?? '')

/** 별점이 높은 순. 별점이 없으면 맨 뒤 — 0점과 '아직 안 매김'은 다르다. */
const byRating = (x: LibraryItem, y: LibraryItem) =>
  (y.rating ?? -1) - (x.rating ?? -1) || byRecent(x, y)

/** 어느 쪽을 보는가 — 서재 탭(읽음/찜)에서 들어온 그대로 시작한다 */
type ShelfFilter = 'READ' | 'WISH'
/** 필터는 목록의 이름이라 명사로 — 서재 탭(읽음/찜)과 같은 것을 가리킨다. 모달의 상태 세그먼트(읽었어요/읽고 싶어요)는 행동이라 동사다 */
const FILTERS: { key: ShelfFilter; label: string }[] = [
  { key: 'READ', label: '읽은 책' },
  { key: 'WISH', label: '찜한 책' },
]

function RecordScreen({ items, initialFilter, onClose }: { items: LibraryItem[]; initialFilter: ShelfFilter; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [filter, setFilter] = useState<ShelfFilter>(initialFilter)

  useEffect(() => {
    // 완독 모달이 이 화면 위에 떠 있으면 ESC 는 모달 몫이다 — 둘이 같이 window 에서 듣고 있어서
    // 양보하지 않으면 한 번의 ESC 로 모달과 편집 화면이 함께 닫힌다
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useFinishModalStore.getState().target) onClose()
    }
    window.addEventListener('keydown', onKey)
    // 뒤에 깔린 서재가 같이 스크롤되면 닫았을 때 엉뚱한 자리에 가 있다
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = scroll
    }
  }, [onClose])

  const needle = query.trim().toLowerCase()
  const inFilter = items.filter((li) => li.status === filter)
  const shown = inFilter
    .filter((li) => !needle || `${li.book.title} ${li.book.author ?? ''}`.toLowerCase().includes(needle))
    .sort(sort === 'rating' ? byRating : byRecent)

  return createPortal(
    <div className="libd-record eo-page" role="dialog" aria-modal="true" aria-label="독서 기록 수정">
      {/* 들어올 때 누른 '책 기록 수정'과 같은 자리, 같은 버튼 */}
      <button type="button" className="eo-button libd-record__back" onClick={onClose}>서재로 돌아가기</button>
      <div className="eo-shell">
        <div>
          <p className="eo-eyebrow">Library</p>
          <h1 className="eo-headline">독서 기록 수정</h1>
        </div>

        {/* 툴바 — 왼쪽 검색, 오른쪽에 목록 필터(칩) · 정렬 · 권수.
            툴바 안에는 밑줄을 하나도 두지 않는다: 검색 밑줄·정렬 밑줄이 바로 아래 첫 행의 rule과 겹쳐 선이 세 겹으로 보였다.
            검색은 칩과 같은 1px 테두리 박스로, 정렬은 밑줄 없이 굵기·농도만으로 고른 쪽을 표시한다.
            위계: 필터 칩(고른 쪽 잉크 반전)이 유일한 검은 덩어리, 정렬은 텍스트로 한 단 낮다.
            상태는 행마다 셀렉트로 두던 것을 여기 필터 하나로 올렸다: 행에서는 안 바꾸고(모달에서) 지금 무엇을 보는지만 고른다 */}
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-rule pt-4">
          <label className="flex h-9 w-full items-center gap-2 border border-rule-soft px-3 transition-colors focus-within:border-ink sm:w-[260px]">
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" className="shrink-0 text-ink-faint">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
              placeholder="제목 · 저자로 찾기" aria-label="서재에서 책 검색" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-1.5" role="group" aria-label="목록">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                  className={`eo-tag ${filter === f.key ? 'is-on' : ''}`}>{f.label}</button>
              ))}
            </div>
            <span aria-hidden className="hidden sm:block" style={{ width: 1, height: 14, background: 'var(--eo-rule-soft)' }} />
            <div className="flex items-center gap-4" role="group" aria-label="정렬">
              {SORTS.map((s) => (
                <button key={s.key} type="button" onClick={() => setSort(s.key)} aria-pressed={sort === s.key}
                  className={`text-[13px] whitespace-nowrap transition-colors ${
                    sort === s.key ? 'font-bold text-ink' : 'text-ink-faint hover:text-ink'}`}>{s.label}</button>
              ))}
            </div>
            <span aria-hidden className="hidden sm:block" style={{ width: 1, height: 14, background: 'var(--eo-rule-soft)' }} />
            <p className="eo-utility whitespace-nowrap tabular-nums">
              {needle ? `찾은 책 ${shown.length}권` : `총 ${inFilter.length}권`}
            </p>
          </div>
        </div>

        {shown.length > 0 ? (
          <div className="mt-4"><LibraryList items={shown} /></div>
        ) : (
          <div className="eo-empty">
            <p className="eo-body">
              {/* 조사(와/과)는 검색어 받침에 따라 달라진다 — 문구에서 아예 뺀다 */}
              {needle
                ? `‘${query.trim()}’ — ${filter === 'READ' ? '읽은 책' : '찜한 책'} 중에서 찾지 못했어요.`
                : filter === 'READ' ? '아직 읽었다고 기록한 책이 없어요.' : '아직 찜한 책이 없어요.'}
            </p>
            <Link to="/search" className="eo-button">책 찾으러 가기</Link>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ══════════════════ 페이지 ══════════════════ */

export default function LibraryPage() {
  const nickname = useAuthStore((s) => s.nickname)
  // 탭은 주소가 기억한다 — 찜에서 상세로 갔다 뒤로 오면 찜으로 돌아와야 한다.
  // replace 라 탭 전환 자체는 뒤로 가기 단계를 만들지 않는다.
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const mode: Mode = params.get('tab') === 'wish' ? 'wish' : 'read'
  const setMode = (next: Mode) =>
    setParams(next === 'wish' ? { tab: 'wish' } : {}, { replace: true })
  // 편집 화면은 주소(?edit=1)에 둔다 — state 로만 들고 있으면 뒤로가기가 편집을 닫는 게 아니라 서재를 떠난다.
  // DNA 의 가챠·월드컵(?play=)과 같은 패턴: 우리가 push 했으면 뒤로가기로 걷어내고, 링크로 바로 들어왔으면 replace 로 지운다
  const editing = params.get('edit') === '1'
  const pushedEdit = useRef(false)
  const openEditing = () => {
    const next = new URLSearchParams(params)
    next.set('edit', '1')
    pushedEdit.current = true
    setParams(next)
  }
  const closeEditing = useCallback(() => {
    if (pushedEdit.current) {
      pushedEdit.current = false
      navigate(-1)
      return
    }
    const next = new URLSearchParams(params)
    next.delete('edit')
    setParams(next, { replace: true })
  }, [navigate, params, setParams])
  // 책의 장·덮힘은 연표에서도 움직여야 해서 페이지가 들고 있는다. 0 = 속표지 + 목차.
  const [index, setIndex] = useState(0)
  const [isClosed, setIsClosed] = useState(true)

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

  const all = data ?? []
  // 완독은 오래된 순 — 그 순서가 곧 이 책의 장 순서다.
  // 완독일만 비교하면 같은 날 기록한 책들은 비교값이 0 이고, Array.sort 는 stable 이라
  // 서버가 준 순서(updatedAt 내림차순, §6.1)가 그대로 남는다 — A·B·C 로 기록한 날이 C·B·A 로 뒤집혔다.
  // 그래서 담은 순서(createdAt)를 2차 기준으로 둔다. mock 응답에 createdAt 이 없던 때를 위해 id 를 최종 폴백으로 남긴다.
  const read = all.filter((li) => li.status === 'READ')
    .sort((x, y) =>
      (x.finishedDate ?? '').localeCompare(y.finishedDate ?? '')
      || (x.createdAt ?? '').localeCompare(y.createdAt ?? '')
      || (x.libraryItemId - y.libraryItemId))
  const wish = all.filter((li) => li.status === 'WISH')
  // 장 번호 = 목차 장 수 + 완독 순번. 연표도 책과 같은 셈을 써야 눌렀을 때 그 책이 열린다.
  const tocCount = tocSheetCount(read.length)

  const meta: BookMeta = {
    title: `${nickname ?? '나'}의 책`,
    year: new Date().getFullYear(),
    count: read.length,
    pages: read.reduce((s, li) => s + (li.book.pageCount ?? 0), 0),
    rating: (() => {
      const rated = read.filter((li) => li.rating != null)
      return rated.length
        ? (rated.reduce((s, li) => s + (li.rating ?? 0), 0) / rated.length).toFixed(1)
        : null
    })(),
  }

  return (
    <section className={`libd-page libd-page--book libd-page--scroll ${mode === 'wish' ? 'libd-page--wish' : ''}`} aria-labelledby="libd-title">
      {/* 버튼은 홈과 같은 것을 쓴다 — 밑줄 세그먼트로 고르고, 잉크 알약이 행동을 맡는다 */}
      <div className="libd__topbar">
        <div className="eo-segments">
          <button type="button" className={`eo-segment ${mode === 'read' ? 'is-on' : ''}`}
            aria-pressed={mode === 'read'} onClick={() => setMode('read')}>
            읽음 <span className="eo-segment__count">{read.length}</span>
          </button>
          <button type="button" className={`eo-segment ${mode === 'wish' ? 'is-on' : ''}`}
            aria-pressed={mode === 'wish'} onClick={() => setMode('wish')}>
            찜 <span className="eo-segment__count">{wish.length}</span>
          </button>
        </div>
        <button type="button" className="eo-button" onClick={openEditing}>
          책 기록 수정
        </button>
      </div>

      <header className={`libd__intro ${mode === 'wish' ? 'libd__intro--flow' : ''}`}>
        <p>{mode === 'read' ? 'READING ARCHIVE' : 'WISH LIST'}</p>
        <h2 id="libd-title">
          {mode === 'read' ? '나만의 책 한 권'
            : <>내가 찜한 책 <em>{wish.length}권</em></>}
        </h2>
        {/* 찜에는 부제를 두지 않는다 — 제목 줄이 '내가 찜한 책 N권'으로 이미 다 말한다 */}
        {mode === 'read' && <span>완독한 책의 기록을 한 장씩 모아보세요.</span>}
        {mode === 'wish' && (
          <Link to="/search" className="eo-text-button libd__intro-action">+ 책 추가</Link>
        )}
      </header>

      {mode === 'read' ? (
        <>
          <div className="libd__stage libd__stage--book" aria-label="완독 기록을 엮은 책">
            <ArchiveBook read={read} meta={meta} index={index} onIndex={setIndex}
              isClosed={isClosed} onClosed={setIsClosed} />
          </div>
          {read.length > 0 && (
            <Timeline read={read} year={meta.year} current={index - tocCount}
              onJump={(i) => { setIndex(i + tocCount); setIsClosed(false) }} />
          )}
        </>
      ) : (
        <>
          <WishShelves wish={wish} />
        </>
      )}

      {editing && <RecordScreen items={all} initialFilter={mode === 'wish' ? 'WISH' : 'READ'} onClose={closeEditing} />}
    </section>
  )
}
