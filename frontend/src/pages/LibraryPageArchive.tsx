import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import bookArchiveTitle from '../assets/book-archive-title.png'
import './LibraryPageArchive.css'

const PAGE_COUNT = 40
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

const wrapIndex = (index: number) => (index + PAGE_COUNT) % PAGE_COUNT

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

function BlankPage({ side }: { side: 'left' | 'right' }) {
  return (
    <span className={`cinematic-book__static-page cinematic-book__static-page--${side}`} aria-hidden="true">
      <span className="cinematic-book__paper-light" />
    </span>
  )
}

function TurningPage({ progress, direction }: { progress: number; direction: Direction }) {
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

  return (
    <span className="cinematic-book__turning-page" style={pageStyle} aria-hidden="true">
      <span className="cinematic-book__turn-face cinematic-book__turn-face--front" />
      <span className="cinematic-book__turn-face cinematic-book__turn-face--back" />
      <span className="cinematic-book__paper-edge" />
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

function CinematicBook() {
  const reducedMotion = useReducedMotion()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [turn, setTurn] = useState<TurnState | null>(null)
  const [isClosed, setIsClosed] = useState(true)
  const indexRef = useRef(currentIndex)
  const motionRef = useRef<MotionState>({
    direction: null,
    progress: 0,
    target: 0,
    velocity: 0,
    lastTime: 0,
    frame: 0,
  })

  useEffect(() => {
    indexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => () => cancelAnimationFrame(motionRef.current.frame), [])

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
        const nextIndex = wrapIndex(indexRef.current + direction)
        indexRef.current = nextIndex
        setCurrentIndex(nextIndex)
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

    if (reducedMotion) {
      setCurrentIndex((index) => wrapIndex(index + direction))
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
    if (!turn) setIsClosed(true)
  }, [turn])

  return (
    <div
      className="book-experience__interaction"
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
          className="book-experience__backdrop-close"
          aria-label="책 바깥 여백을 눌러 책 덮기"
          onClick={closeBook}
          disabled={Boolean(turn)}
        />
      )}
      <div
        className="book-experience__book-trigger"
      >
        <span className={`book-experience__world ${isClosed ? 'is-closed' : ''}`}>
          <span className="cinematic-book">
            <span className="cinematic-book__back-cover cinematic-book__back-cover--left" />
            <span className="cinematic-book__back-cover cinematic-book__back-cover--right" />
            <span className="cinematic-book__page-block cinematic-book__page-block--left" />
            <span className="cinematic-book__page-block cinematic-book__page-block--right" />
            <BlankPage side="left" />
            <BlankPage side="right" />
            {turn && <TurningPage progress={turn.progress} direction={turn.direction} />}
            <span className="cinematic-book__front-cover" aria-hidden="true">
              <span className="cinematic-book__front-cover-face cinematic-book__front-cover-face--outside">
                <small>BOOK EXPERIENCE</small>
                <img
                  className="cinematic-book__cover-title"
                  src={bookArchiveTitle}
                  alt=""
                />
                <span>PAGE · {String(currentIndex + 1).padStart(2, '0')}</span>
              </span>
              <span className="cinematic-book__front-cover-face cinematic-book__front-cover-face--inside" />
            </span>
            <span className="cinematic-book__gutter" />
            {!isClosed && (
              <>
                <button
                  type="button"
                  className="cinematic-book__hit cinematic-book__hit--previous"
                  aria-label="이전 흰 페이지로 돌아가기"
                  onClick={() => requestTurn(-1)}
                />
                <button
                  type="button"
                  className="cinematic-book__hit cinematic-book__hit--next"
                  aria-label="다음 흰 페이지 넘기기"
                  onClick={() => requestTurn(1)}
                />
              </>
            )}
            {isClosed && (
              <button
                type="button"
                className="cinematic-book__hit cinematic-book__hit--cover"
                aria-label="표지를 눌러 책 펼치기"
                onClick={() => setIsClosed(false)}
              />
            )}
          </span>
        </span>
      </div>

      <div className={`book-experience__controls ${isClosed ? 'is-hidden' : ''}`} aria-label="책 페이지 넘기기">
        <button type="button" onClick={() => requestTurn(-1)} aria-label="이전 페이지">
          <ArrowIcon direction="left" />
        </button>
        <span><b>{String(currentIndex + 1).padStart(2, '0')}</b> / {PAGE_COUNT}</span>
        <button type="button" onClick={() => requestTurn(1)} aria-label="다음 페이지">
          <ArrowIcon direction="right" />
        </button>
      </div>
    </div>
  )
}

export default function LibraryPageArchive() {
  return (
    <section className="book-experience-page library-archive-page" aria-labelledby="library-archive-title">
      <div className="book-experience__grain" aria-hidden="true" />
      <header className="library-archive__intro">
        <p>READING ARCHIVE</p>
        <h2 id="library-archive-title">완독 기록을 한 권에</h2>
        <span>완독한 책의 감상과 기억을 한 장씩 모아보세요.</span>
      </header>

      <div className="book-experience__stage library-archive__stage" aria-label="완독 기록용 3D 아카이브 책">
        <CinematicBook />
      </div>
    </section>
  )
}
