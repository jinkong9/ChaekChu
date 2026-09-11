import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import { coverPalette } from '../lib/coverPalette'
import { coverAtWidth } from '../lib/coverUrl'
import LibraryList from '../components/LibraryList'
import bookArchiveTitle from '../assets/book-archive-title.png'
import './LibraryPageD.css'

/** LIB-001 내 서재 D안 — C안(완독 기록)의 책에 B안의 판면을 넣은 안.
 *
 *  책·표지·종이·넘김 물리는 C안 그대로다 (LibraryPageD.css 앞부분은 C안 CSS를
 *  이름만 바꿔 옮긴 것). D안이 더한 것은 그 빈 지면 위의 내용과 둘레의 조작부다:
 *
 *    왼쪽 위  읽음 / 찜 — 무엇을 볼지 고르는 자리
 *    오른쪽 위 책 기록 수정 — 고치는 자리는 서랍 하나로 모은다 (LibraryList)
 *    읽음     C안 책 + B안 판면 — 0장 속표지·목차, 이후 한 권이 한 장
 *             (왼쪽 면 = 제목, 오른쪽 면 = 평가)
 *    찜       A안 선반을 이 무대 위로 — 장르별로 나눠 꽂는다
 *
 *  A·B·C안(LibraryPageShelf·B·Archive)은 비교용으로 그대로 둔다. */

type Direction = -1 | 1

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

const ordinal = (n: number) => String(n).padStart(2, '0')

/** 분류 2단계의 마지막 세그먼트 ("문학 > 한국소설" → "한국소설") — A·B안과 같은 규칙 */
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

type BookMeta = { title: string; year: number; count: number; pages: number }

/* ══════════════════ 지면 — 책 안에 들어가는 네 종류의 면 ══════════════════ */

/** 속표지 (0장 왼쪽) — 조용해야 맞은편 목차가 읽힌다 */
function FrontFace({ meta }: { meta: BookMeta }) {
  return (
    <div className="libd-face libd-front">
      <span className="libd-front__label">완독으로 엮은</span>
      <span className="libd-front__title">{meta.title}</span>
      <span className="libd-front__mark" />
      <span className="libd-face__foot">
        완독 {meta.count}권{meta.pages > 0 ? ` · ${meta.pages.toLocaleString()}쪽` : ''} · {meta.year}
      </span>
    </div>
  )
}

/** 목차 (0장 오른쪽) — 왼쪽에 제목, 오른쪽에 평가. 줄을 누르면 그 장으로 넘어간다. */
function TocFace({ read, onPick }: { read: LibraryItem[]; onPick: (bookIndex: number) => void }) {
  const shown = read.slice(0, TOC_MAX)
  const rest = read.length - shown.length
  const rated = read.filter((li) => li.rating != null)
  const avg = rated.length ? (rated.reduce((s, li) => s + (li.rating ?? 0), 0) / rated.length).toFixed(1) : null

  return (
    <div className="libd-face">
      <span className="libd-face__eyebrow">목차</span>

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
        <>
          <ul className="libd-toc">
            {shown.map((li, i) => (
              <li key={li.libraryItemId}>
                <button type="button" className="libd-toc__row" onClick={() => onPick(i)}>
                  <span className="libd-toc__no">{ordinal(i + 1)}</span>
                  <span className="libd-toc__title">{li.book.title}</span>
                  <span className="libd-toc__leader" />
                  <span className="libd-toc__rate">{li.rating != null ? `★ ${li.rating}` : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
          {rest > 0 && <p className="libd-toc__more">그 밖 {rest}권</p>}
          <span className="libd-face__foot">
            완독 {read.length}권{avg ? ` · 평균 ★${avg}` : ''}
          </span>
        </>
      )}
    </div>
  )
}

/** 한 권의 왼쪽 면 — 제목. 표지는 제목을 받쳐 주는 자리다. */
function TitleFace({ li }: { li: LibraryItem }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 260) : null

  return (
    <div className="libd-face">
      <span className="libd-face__eyebrow">완독</span>
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
      <span className="libd-title__name">{li.book.title}</span>
      <span className="libd-title__by">
        {li.book.author}{li.book.publisher ? ` · ${li.book.publisher}` : ''}
      </span>
      <span className="libd-face__folio libd-face__folio--left">{li.finishedDate ?? ''}</span>
    </div>
  )
}

/** 한 권의 오른쪽 면 — 평가. 서재에 이미 있는 필드만 쓴다 (별점 · 완독일 · 감상평 · 분류 · 쪽수). */
function RateFace({ li, no }: { li: LibraryItem; no: number }) {
  const rating = li.rating ?? 0
  return (
    <div className="libd-face">
      <span className="libd-face__eyebrow">평가</span>

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
        <Link className="libd-rate__link" to={`/books/${li.book.bookId}`}>상세 보기</Link>
      </span>
      <span className="libd-face__folio libd-face__folio--right">{ordinal(no)}</span>
    </div>
  )
}

/* ══════════════════ 책 — C안의 넘김에 위 지면을 태운다 ══════════════════ */

/** 장 한 개. 0 = 속표지 + 목차, 1.. = 완독한 책 한 권. (표지는 isClosed 가 맡는다) */
type Sheet =
  | { kind: 'toc' }
  | { kind: 'book'; li: LibraryItem; no: number }

function BlankPage({ side, children }: { side: 'left' | 'right'; children?: ReactNode }) {
  return (
    <span className={`libd-book__static-page libd-book__static-page--${side}`}>
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
    <svg aria-hidden="true" viewBox="0 0 24 24" className={direction === 'right' ? 'is-right' : ''}>
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

  const sheets: Sheet[] = [
    { kind: 'toc' },
    ...read.map((li, i) => ({ kind: 'book' as const, li, no: i + 1 })),
  ]
  // C안은 40장을 순환시켰다. 여기는 내용이 있는 만큼만 있고, 끝에서 처음으로 돌지 않는다.
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

  /** 목차에서 곧장 그 장으로 — 넘기는 중에는 받지 않는다 */
  const jumpTo = (sheetIndex: number) => {
    if (turn) return
    const next = Math.max(0, Math.min(lastRef.current, sheetIndex))
    indexRef.current = next
    onIndex(next)
  }

  const leftOf = (s: Sheet | undefined): ReactNode =>
    !s ? null : s.kind === 'toc' ? <FrontFace meta={meta} /> : <TitleFace li={s.li} />
  const rightOf = (s: Sheet | undefined): ReactNode =>
    !s ? null : s.kind === 'toc' ? <TocFace read={read} onPick={(i) => jumpTo(i + 1)} /> : <RateFace li={s.li} no={s.no} />

  // 넘어가는 종이 한 장의 앞면은 먼저 놓인 장(A)의 오른쪽 면, 뒷면은 나중 장(B)의 왼쪽 면이다.
  // 그래서 -180도까지 돌면 B의 왼쪽 면이 왼쪽에 내려앉고, 미리 깔아 둔 B의 오른쪽 면이 드러난다.
  const iA = turn ? (turn.direction === 1 ? cursor : cursor - 1) : cursor
  const iB = turn ? (turn.direction === 1 ? cursor + 1 : cursor) : cursor
  const sheetA = sheets[iA]
  const sheetB = sheets[iB]

  // 넘어가는 장은 착지 직전 10% 동안 사라진다 (C안의 --landing-opacity). 그때 그 아래가
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
            <BlankPage side="left">{leftOf(leftSheet)}</BlankPage>
            <BlankPage side="right">{rightOf(rightSheet)}</BlankPage>
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
            {!isClosed && (
              <>
                <button
                  type="button"
                  className="libd-book__hit libd-book__hit--previous"
                  aria-label="이전 장으로 돌아가기"
                  onClick={() => requestTurn(-1)}
                  disabled={cursor <= 0}
                />
                <button
                  type="button"
                  className="libd-book__hit libd-book__hit--next"
                  aria-label="다음 장 넘기기"
                  onClick={() => requestTurn(1)}
                  disabled={cursor >= sheets.length - 1}
                />
              </>
            )}
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
        <button type="button" onClick={() => requestTurn(-1)} aria-label="이전 장" disabled={cursor <= 0}>
          <ArrowIcon direction="left" />
        </button>
        <span><b>{ordinal(cursor + 1)}</b> / {ordinal(sheets.length)}</span>
        <button type="button" onClick={() => requestTurn(1)} aria-label="다음 장" disabled={cursor >= sheets.length - 1}>
          <ArrowIcon direction="right" />
        </button>
      </div>
    </div>
  )
}

/* ══════════════════ 완독 연표 (B안) — 책 아래 한 띠 ══════════════════ */

/** 한 달 칸의 표지 한 장 — 정면으로, 칸 가운데에. */
function TimelineCover({ li, on, onPick }: { li: LibraryItem; on: boolean; onPick: () => void }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 140) : null

  return (
    <button type="button" onClick={onPick}
      title={`${li.book.title}${li.book.pageCount ? ` · ${li.book.pageCount}쪽` : ''}`}
      aria-label={`${li.book.title} 장으로 넘기기`}
      className={`libd-timeline__cover ${on ? 'is-on' : ''}`}
      style={{ background: c.bg }}>
      {url
        ? <img key={li.libraryItemId} src={url} alt="" referrerPolicy="no-referrer"
            loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
        : <span key={li.libraryItemId} style={{ color: c.fg }}>{li.book.title}</span>}
    </button>
  )
}

/** 한 달 칸. 한 권이면 그 표지 하나, 여러 권이면 한 장씩 돌아가며 보여 준다.
 *
 *  12칸짜리 띠라 칸 하나가 100px 남짓이다. 화살표 버튼을 넣을 자리가 없고,
 *  자동으로만 돌리면 원하는 책이 올 때까지 기다려야 한다. 그래서 둘 다 둔다:
 *  가만두면 천천히 넘어가고, 아래 점을 누르면 그 자리에서 멈춘다.
 *  마우스를 얹은 동안에도 멈춘다 — 누르려는 표지가 바뀌면 안 되니까. */
function TimelineMonth({ books, current, onJump }: {
  books: { li: LibraryItem; i: number }[]; current: number; onJump: (bookIndex: number) => void
}) {
  const reduced = useReducedMotion()
  const [at, setAt] = useState(0)
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)

  // 지금 펼쳐 둔 장이 이 달에 있으면 그 책을 보여 준다 — 연표가 책을 따라간다
  const forced = books.findIndex((b) => b.i === current)
  const shown = forced >= 0 ? forced : Math.min(at, books.length - 1)
  const holding = pinned || hover || forced >= 0 || reduced

  useEffect(() => {
    if (books.length < 2 || holding) return
    const timer = setInterval(() => setAt((k) => (k + 1) % books.length), 3200)
    return () => clearInterval(timer)
  }, [books.length, holding])

  if (books.length === 0) return <div className="libd-timeline__slot" />

  const book = books[shown]
  return (
    <div className="libd-timeline__slot"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <TimelineCover li={book.li} on={book.i === current} onPick={() => onJump(book.i)} />
      {books.length > 1 && (
        <div className="libd-timeline__dots">
          {books.map((b, k) => (
            <button type="button" key={b.li.libraryItemId} className={k === shown ? 'is-on' : ''}
              aria-label={`${b.li.book.title} 표지 보기`} aria-pressed={k === shown}
              onClick={() => { setAt(k); setPinned(true) }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 캘린더 대신 열두 달의 띠. 완독일만으로 그려지고, 표지를 누르면 그 장으로 넘어간다.
 *  (월 캘린더는 넣지 않는다: 서재에는 하루 단위 기록이 없어 31칸 중 한두 칸만 찬다) */
function Timeline({ read, year, current, onJump }: {
  read: LibraryItem[]; year: number; current: number; onJump: (bookIndex: number) => void
}) {
  const thisMonth = new Date().getFullYear() === year ? new Date().getMonth() + 1 : 0
  const otherYears = read.filter((li) => !li.finishedDate?.startsWith(String(year))).length

  return (
    <section className="libd-timeline">
      <div className="libd-timeline__head">
        <h3>완독 연표 · {year}</h3>
        <p>그 달에 완독한 책이 놓입니다 — 표지를 누르면 그 장으로 넘어가요</p>
        {otherYears > 0 && <p className="libd-timeline__other">그 밖의 해 {otherYears}권</p>}
      </div>
      <div className="libd-timeline__grid">
        {Array.from({ length: 12 }, (_, k) => k + 1).map((m) => {
          const spines = read
            .map((li, i) => ({ li, i }))
            .filter(({ li }) => li.finishedDate?.startsWith(`${year}-${String(m).padStart(2, '0')}`))
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

/* ══════════════════ 찜 — A안 선반을 이 무대 위로 ══════════════════ */

function ShelfCover({ li }: { li: LibraryItem }) {
  const [broken, setBroken] = useState(false)
  const c = coverPalette(li.book.bookId)
  const url = li.book.coverUrl && !broken ? coverAtWidth(li.book.coverUrl, 184) : null
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
    setPop({ li, x: r.left + r.width / 2, y: r.top })
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
          <div className="libd-shelf__books">
            {books.map((li) => (
              <div key={li.libraryItemId} className="libd-shelf__book"
                onMouseEnter={(e) => showPop(li, e.currentTarget)} onMouseLeave={hidePop}>
                <Link to={`/books/${li.book.bookId}`}><ShelfCover li={li} /></Link>
              </div>
            ))}
          </div>
          <div className="libd-shelf__ledge" />
          <i />
        </section>
      ))}
      {pop && <ShelfPop li={pop.li} x={pop.x} y={pop.y} onEnter={holdPop} onLeave={hidePop} />}
    </div>
  )
}

/* ══════════════════ 고치는 자리 — 서랍 하나로 ══════════════════ */

const SORTS = [
  { key: 'recent', label: '최신순' },
  { key: 'rating', label: '별점 높은 순' },
] as const

type SortKey = (typeof SORTS)[number]['key']

/** 완독일이 빠른 순. 완독일이 없는 책(찜)은 뒤로 밀고, 그 안에서는 최근 고친 것부터(계약 §6 정렬 기준).
 *  libraryItemId 는 서버에서 문자열이라 뺄셈으로 순서를 매기지 않는다. */
const byRecent = (x: LibraryItem, y: LibraryItem) =>
  (y.finishedDate ?? '').localeCompare(x.finishedDate ?? '') || (y.updatedAt ?? '').localeCompare(x.updatedAt ?? '')

/** 별점이 높은 순. 별점이 없으면 맨 뒤 — 0점과 '아직 안 매김'은 다르다. */
const byRating = (x: LibraryItem, y: LibraryItem) =>
  (y.rating ?? -1) - (x.rating ?? -1) || byRecent(x, y)

function RecordScreen({ items, onClose }: { items: LibraryItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
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
  const shown = items
    .filter((li) => !needle || `${li.book.title} ${li.book.author ?? ''}`.toLowerCase().includes(needle))
    .sort(sort === 'rating' ? byRating : byRecent)

  return createPortal(
    <div className="libd-record eo-page" role="dialog" aria-modal="true" aria-label="책 기록 수정">
      {/* 들어올 때 누른 '책 기록 수정'과 같은 자리, 같은 버튼 */}
      <button type="button" className="eo-button libd-record__back" onClick={onClose}>서재로 돌아가기</button>
      <div className="eo-shell">
        <div>
          <p className="eo-eyebrow">Library</p>
          <h1 className="eo-headline">책 기록 수정</h1>
          <p className="eo-body mt-2.5">별점 · 한 줄 감상평 · 읽음/찜 상태를 여기서 고칩니다</p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-rule pt-3">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            className="eo-field eo-field--sm w-full sm:w-[260px]"
            placeholder="제목 · 저자로 찾기" aria-label="서재에서 책 검색" />
          <div className="eo-segments">
            {SORTS.map((s) => (
              <button key={s.key} type="button" onClick={() => setSort(s.key)} aria-pressed={sort === s.key}
                className={`eo-segment ${sort === s.key ? 'is-on' : ''}`}>{s.label}</button>
            ))}
          </div>
          <p className="eo-utility ml-auto">
            {needle ? `찾은 책 ${shown.length}권 · 전체 ${items.length}권` : `전체 ${items.length}권`}
          </p>
        </div>

        {shown.length > 0 ? (
          <div className="mt-1"><LibraryList items={shown} /></div>
        ) : (
          <div className="eo-empty">
            <p className="eo-body">
              {/* 조사(와/과)는 검색어 받침에 따라 달라진다 — 문구에서 아예 뺀다 */}
              {needle ? `‘${query.trim()}’ — 서재에서 찾지 못했어요.` : '서재가 아직 비어 있어요.'}
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

export default function LibraryPageD() {
  const nickname = useAuthStore((s) => s.nickname)
  const [mode, setMode] = useState<'read' | 'wish'>('read')
  const [editing, setEditing] = useState(false)
  // 책의 장·덮힘은 연표에서도 움직여야 해서 페이지가 들고 있는다. 0 = 속표지 + 목차.
  const [index, setIndex] = useState(0)
  const [isClosed, setIsClosed] = useState(true)

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

  const all = data ?? []
  // 완독은 오래된 순 — 그 순서가 곧 이 책의 장 순서다
  const read = all.filter((li) => li.status === 'READ')
    .sort((x, y) => (x.finishedDate ?? '').localeCompare(y.finishedDate ?? ''))
  const wish = all.filter((li) => li.status === 'WISH')

  const meta: BookMeta = {
    title: `${nickname ?? '나'}의 책`,
    year: new Date().getFullYear(),
    count: read.length,
    pages: read.reduce((s, li) => s + (li.book.pageCount ?? 0), 0),
  }

  return (
    <section className="libd-page libd-page--book libd-page--scroll" aria-labelledby="libd-title">
      <div className="libd__grain" aria-hidden="true" />

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
        <button type="button" className="eo-button" onClick={() => setEditing(true)}>
          책 기록 수정
        </button>
      </div>

      <header className={`libd__intro ${mode === 'wish' ? 'libd__intro--flow' : ''}`}>
        <p>READING ARCHIVE</p>
        <h2 id="libd-title">{mode === 'read' ? '완독 기록을 한 권에' : '찜한 책을 장르별로'}</h2>
        <span>
          {mode === 'read'
            ? '완독한 책의 감상과 기억을 한 장씩 모아보세요.'
            : '언젠가 펼칠 책을 분야별 선반에 꽂아 두었어요.'}
        </span>
      </header>

      {mode === 'read' ? (
        <>
          <div className="libd__stage libd__stage--book" aria-label="완독 기록을 엮은 책">
            <ArchiveBook read={read} meta={meta} index={index} onIndex={setIndex}
              isClosed={isClosed} onClosed={setIsClosed} />
          </div>
          {read.length > 0 && (
            <Timeline read={read} year={meta.year} current={index - 1}
              onJump={(i) => { setIndex(i + 1); setIsClosed(false) }} />
          )}
        </>
      ) : (
        <WishShelves wish={wish} />
      )}

      {editing && <RecordScreen items={all} onClose={() => setEditing(false)} />}
    </section>
  )
}
