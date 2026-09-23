import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
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
import Pager from '../components/Pager'
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

type BookMeta = { title: string; year: number; span: string; count: number; pages: number; rating: string | null }

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
        <div><dt>엮은 기간</dt><dd>{meta.span}</dd></div>
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

/** 감상평이 남은 지면에 다 들어가게 글씨를 줄인다. 300자는 계약상 상한이라 그대로 두고,
 *  보여 주는 쪽이 맞춘다 — 면의 글자 크기가 책 폭을 따라 9–14px 사이를 오가고 제목 줄 수와
 *  줄바꿈도 책마다 달라서, 입력 글자 수로는 안 잘리는 선을 정할 수 없다.
 *  제일 작은 크기로도 넘치면(줄바꿈을 몰아 쓴 경우) 들어가는 줄까지만 보이고 말줄임으로 끝낸다. */
const REVIEW_SIZES_EM = [1.12, 1.04, 0.96, 0.9, 0.84]

function useFitReview(ref: RefObject<HTMLParagraphElement | null>, text: string | null) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      if (el.clientHeight === 0) return // 아직 안 보이는 면 — 펼쳐질 때 다시 잰다
      el.style.webkitLineClamp = 'unset'
      for (const size of REVIEW_SIZES_EM) {
        el.style.fontSize = `${size}em`
        if (el.scrollHeight <= el.clientHeight + 1) return
      }
      const lineH = parseFloat(getComputedStyle(el).lineHeight)
      el.style.webkitLineClamp = String(Math.max(1, Math.floor(el.clientHeight / lineH)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, text])
}

/** 한 권의 오른쪽 면 — 평가. 서재에 이미 있는 필드만 쓴다 (별점 · 완독일 · 감상평 · 분류 · 쪽수). */
function RateFace({ li, no }: { li: LibraryItem; no: number }) {
  const rating = li.rating ?? 0
  const reviewRef = useRef<HTMLParagraphElement>(null)
  useFitReview(reviewRef, li.reviewText)
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
        <p ref={reviewRef} className="libd-rate__review">{li.reviewText}</p>
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

/** 첫 장·마지막 장 — 화살표에 벽을 하나 세운 글리프. ArrowIcon 과 같은 24 격자·같은 선 굵기라
 *  네 버튼이 한 줄에서 같은 크기로 읽힌다. 오른쪽은 ArrowIcon 과 같은 규칙으로 뒤집는다. */
function EndIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`libd-arrow-icon ${direction === 'right' ? 'is-right' : ''}`}>
      <path d="M17 18 11 12l6-6M7 5.5v13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

  // 목차 색인이 붙을 쪽 — 목차 장을 펼치고 있으면 오른쪽, 넘겼으면 왼쪽.
  // 넘기는 중에는 종이가 가운데를 지나는 순간(진행 0.5)에 옮긴다. 두 방향 모두 그 전은 A, 그 뒤는 B 다
  const facing = turn ? (turn.progress < 0.5 ? iA : iB) : cursor
  const onToc = facing < tocSheets.length


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
            {/* 목차 색인 — 목차 장의 책배에 붙인 탭이다. 목차를 펼치면 그 장이 오른쪽에 있으니 탭도 오른쪽 옆,
                넘기고 나면 그 장이 왼쪽으로 넘어가 있으니 왼쪽 옆에서 비어져 나온다. 덮었을 때만 숨긴다 */}
            <button
              type="button"
              className={`libd-book__index libd-book__index--${onToc ? 'right' : 'left'} ${isClosed ? 'is-hidden' : ''}`}
              onClick={() => jumpTo(0)}
              aria-label="목차로"
              aria-current={cursor === 0 || undefined}
              tabIndex={isClosed ? -1 : 0}
            >
              목차
            </button>
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
        {/* 맨 앞·맨 뒤는 넘김 없이 곧장 간다 — 열여섯 장을 화살표로만 오가던 자리다 */}
        <button type="button" className="libd__arrow libd__arrow--edge" onClick={() => jumpTo(0)}
          aria-label="첫 장으로" disabled={cursor <= 0}>
          <EndIcon direction="left" />
        </button>
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
        <button type="button" className="libd__arrow libd__arrow--edge" onClick={() => jumpTo(sheets.length - 1)}
          aria-label="마지막 장으로" disabled={cursor >= sheets.length - 1}>
          <EndIcon direction="right" />
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

/** 표지를 누르면 그 책의 상세로 간다. 마우스를 올리면 제목·감상평이 뜨던 쪽지는 걷었다 —
 *  선반을 훑는 동안 표지를 가리고 따라다녔고, 표지와 제목은 쪽지 없이도 이미 읽힌다. */
function WishShelves({ wish }: { wish: LibraryItem[] }) {
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
                <div key={li.libraryItemId} className="libd-shelf__book">
                  <Link to={`/books/${li.book.bookId}`} aria-label={`${li.book.title} 상세 보기`}>
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

/** 완독이 이른 순 — 이 책이 엮인 단 하나의 차례다. 목차·장 번호·연표가 모두 이것을 따른다.
 *  한때 목차에서 제목순·별점순을 고를 수 있게 했다가 걷었다: 연표는 완독일로만 그려지는데
 *  장 차례가 따로 놀면, 같은 책이 연표에서는 8월 자리에 있고 책에서는 23장이 되어 둘이 어긋났다.
 *  완독일만 비교하면 같은 날 기록한 책들은 비교값이 0 이고, Array.sort 는 stable 이라
 *  서버가 준 순서(updatedAt 내림차순, §6.1)가 그대로 남는다 — A·B·C 로 기록한 날이 C·B·A 로 뒤집혔다.
 *  그래서 담은 순서(createdAt)를 2차 기준으로 둔다. mock 응답에 createdAt 이 없던 때를 위해 id 를 최종 폴백으로 남긴다
 *  (id 는 서버에서 문자열이라 뺄셈이 NaN 이 된다 — 숫자로 읽는 localeCompare 로 비교한다). */
const byFinishedFirst = (x: LibraryItem, y: LibraryItem) =>
  (x.finishedDate ?? '').localeCompare(y.finishedDate ?? '')
  || (x.createdAt ?? '').localeCompare(y.createdAt ?? '')
  || String(x.libraryItemId).localeCompare(String(y.libraryItemId), undefined, { numeric: true })

/** 기록 수정 목록의 한 쪽에 놓는 행 수. 검색 화면과 같은 20 이다.
 *  행 하나가 20개 남짓한 노드라, 서재가 커지면 전부 그리는 순간 화면이 멎는다 —
 *  3,000권에서 노드가 62,000개, 정렬 한 번이 2.9초, 검색어를 지우면 6.0초였다.
 *  거르고 정렬하는 일은 늘 전체를 놓고 한다(수천 권이어도 수십 ms 다). 비싼 것은 그리기뿐이다. */
const ROWS_PER_PAGE = 20

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
  const [page, setPage] = useState(1)
  // 스크롤은 창이 아니라 이 화면 자신이 한다(position: fixed + overflow-y: auto) — 쪽을 넘기면 여기를 올린다
  const scrollerRef = useRef<HTMLDivElement>(null)

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

  const lastPage = Math.max(1, Math.ceil(shown.length / ROWS_PER_PAGE))
  // 검색어를 좁히면 있던 쪽이 사라진다 — 그리기 전에 끌어당겨 빈 쪽을 보여 주지 않는다
  const current = Math.min(page, lastPage)
  const rows = shown.slice((current - 1) * ROWS_PER_PAGE, current * ROWS_PER_PAGE)

  // 목록이 통째로 달라지면 1쪽부터 — 40쪽에서 검색하면 엉뚱한 자리에서 시작한다
  useEffect(() => { setPage(1) }, [needle, sort, filter])

  const goPage = (next: number) => {
    if (next < 1 || next > lastPage || next === current) return
    setPage(next)
    scrollerRef.current?.scrollTo({ top: 0 })   // 쪽을 넘겼는데 눈은 목록 끝에 남아 있으면 안 된다
  }

  return createPortal(
    <div className="libd-record eo-page" role="dialog" aria-modal="true" aria-label="독서 기록 수정" ref={scrollerRef}>
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
          <div className="mt-4">
            <LibraryList items={rows} />
            <Pager page={current} lastPage={lastPage}
              from={(current - 1) * ROWS_PER_PAGE + 1} to={(current - 1) * ROWS_PER_PAGE + rows.length}
              total={shown.length} onPage={goPage} label="기록 쪽 이동" />
          </div>
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
  // 완독이 이른 순 — 그 순서가 곧 이 책의 장 순서다.
  const read = all.filter((li) => li.status === 'READ').sort(byFinishedFirst)
  const wish = all.filter((li) => li.status === 'WISH')
  // 장 번호 = 목차 장 수 + 완독 순번. 연표도 책과 같은 셈을 써야 눌렀을 때 그 책이 열린다.
  const tocCount = tocSheetCount(read.length)

  const thisYear = new Date().getFullYear()
  const meta: BookMeta = {
    title: `${nickname ?? '나'}의 책`,
    year: thisYear,
    // 엮은 기간 — 올해를 적던 자리다. 아무것도 안 해도 해가 바뀌면 숫자가 바뀌어,
    // 서재를 말하는 판권에서 혼자 서재와 무관했다. 완독 기록이 걸친 해로 적는다.
    // 완독일이 없는 책('서비스를 만나기 전에 읽은 책')은 해를 모르니 범위에 넣지 않는다.
    span: (() => {
      const years = read.map((li) => Number(li.finishedDate?.slice(0, 4))).filter(Boolean)
      if (years.length === 0) return String(thisYear)
      const from = Math.min(...years)
      const to = Math.max(...years)
      return from === to ? String(from) : `${from}–${to}`
    })(),
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
