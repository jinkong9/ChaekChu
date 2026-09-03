import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link, useNavigate } from 'react-router'
import type { PopularBook, PopularSegment, PopularSelection } from './types'
import { usePopularRingData } from './usePopularRingData'
import './popular-ring.css'

const PopularRingCanvas = lazy(() => import('./PopularRingCanvas'))

type ViewMode = 'ring' | 'grid'

const PREVIEW_TITLE_BREAK_TARGET = 10
const PREVIEW_TITLE_BREAK_TOLERANCE = 3

function splitPreviewTitle(title: string): [string, string?] {
  const characters = Array.from(title.trim())
  if (characters.length <= PREVIEW_TITLE_BREAK_TARGET) return [title]

  const nearbyWhitespace = characters
    .map((character, index) => (/\s/u.test(character) ? index : -1))
    .filter((index) => index >= 4 && index < characters.length - 1)
    .sort((a, b) => Math.abs(a - PREVIEW_TITLE_BREAK_TARGET) - Math.abs(b - PREVIEW_TITLE_BREAK_TARGET))[0]

  const breakIndex = nearbyWhitespace !== undefined
    && Math.abs(nearbyWhitespace - PREVIEW_TITLE_BREAK_TARGET) <= PREVIEW_TITLE_BREAK_TOLERANCE
    ? nearbyWhitespace
    : PREVIEW_TITLE_BREAK_TARGET

  const firstLine = characters.slice(0, breakIndex).join('').trimEnd()
  const secondLine = characters
    .slice(/\s/u.test(characters[breakIndex] ?? '') ? breakIndex + 1 : breakIndex)
    .join('')
    .trimStart()

  return secondLine ? [firstLine, secondLine] : [firstLine]
}

function CoverImage({ book, large = false }: { book: PopularBook; large?: boolean }) {
  const [broken, setBroken] = useState(false)
  const source = large ? (book.coverLargeUrl ?? book.coverUrl) : book.coverUrl

  if (!source || broken) {
    return (
      <div className={`popular-cover-fallback ${large ? 'is-large' : ''}`} aria-label={`${book.title} 표지 없음`}>
        <span>{book.title}</span>
      </div>
    )
  }

  return (
    <img
      src={source}
      alt={`${book.title} 표지`}
      className={large ? 'popular-preview__cover' : 'popular-grid__cover'}
      loading={large ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  )
}

function PopularGrid({
  segments,
  activeSegmentId,
  onOpen,
}: {
  segments: PopularSegment[]
  activeSegmentId: string | null
  onOpen: (book: PopularBook) => void
}) {
  const [expandedSegmentIds, setExpandedSegmentIds] = useState<Set<string>>(() => new Set())
  const sectionRefs = useRef(new Map<string, HTMLElement>())

  useLayoutEffect(() => {
    if (!activeSegmentId) return
    const target = sectionRefs.current.get(activeSegmentId)
    if (!target) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
        inline: 'nearest',
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSegmentId])

  const toggleSegment = (segmentId: string) => {
    setExpandedSegmentIds((current) => {
      const next = new Set(current)
      if (next.has(segmentId)) next.delete(segmentId)
      else next.add(segmentId)
      return next
    })
  }

  const renderBook = (book: PopularBook) => (
    <button key={book.id} type="button" className="popular-grid__book" onClick={() => onOpen(book)}>
      <span className="popular-grid__rank">{String(book.ranking).padStart(2, '0')}</span>
      <CoverImage book={book} />
      <span className="popular-grid__title">{book.title}</span>
      <span className="popular-grid__author">{book.author}</span>
    </button>
  )

  return (
    <div className="popular-grid" aria-label="연령대와 성별 인기도서 그리드">
      {segments.map((segment) => {
        const primaryBooks = segment.items.slice(0, 10)
        const additionalBooks = segment.items.slice(10)
        const isExpanded = expandedSegmentIds.has(segment.id)
        const moreRegionId = `popular-more-${segment.id}`

        return (
          <section
            key={segment.id}
            ref={(node) => {
              if (node) sectionRefs.current.set(segment.id, node)
              else sectionRefs.current.delete(segment.id)
            }}
            className={`popular-grid__section ${activeSegmentId === segment.id ? 'is-active' : ''}`}
            aria-labelledby={`popular-${segment.id}`}
          >
            <header className="popular-grid__section-header">
              <h2 id={`popular-${segment.id}`}>{segment.label}</h2>
              <span>{segment.startDate.replaceAll('-', '.')} — {segment.endDate.replaceAll('-', '.')}</span>
            </header>
            <div className="popular-grid__books">
              {primaryBooks.map(renderBook)}
            </div>

            <AnimatePresence initial={false}>
              {isExpanded && additionalBooks.length > 0 && (
                <motion.div
                  id={moreRegionId}
                  className="popular-grid__books popular-grid__books--more"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                >
                  {additionalBooks.map(renderBook)}
                </motion.div>
              )}
            </AnimatePresence>

            {additionalBooks.length > 0 && (
              <div className="popular-grid__more-row">
                <button
                  type="button"
                  className="popular-grid__more-button"
                  aria-expanded={isExpanded}
                  aria-controls={moreRegionId}
                  onClick={() => toggleSegment(segment.id)}
                >
                  <span>{isExpanded ? '접기' : `11–${segment.items.length}위 보기`}</span>
                  <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                </button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

export default function PopularRingPage() {
  const navigate = useNavigate()
  const { data, isPending, isError } = usePopularRingData()
  const [view, setView] = useState<ViewMode>('ring')
  const [filterOpen, setFilterOpen] = useState(false)
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null)
  const [selection, setSelection] = useState<PopularSelection | null>(null)
  const [loadedCovers, setLoadedCovers] = useState(0)
  const [totalCovers, setTotalCovers] = useState(0)
  const [renderer, setRenderer] = useState<'webgl' | 'fallback' | null>(null)
  const previewCopyRef = useRef<HTMLDivElement>(null)
  const previewTitleRef = useRef<HTMLSpanElement>(null)

  const segments = useMemo(() => data?.segments ?? [], [data])
  const activeSegment = segments.find((segment) => segment.id === activeSegmentId) ?? null
  const progress = totalCovers === 0 ? 0 : Math.round((loadedCovers / totalCovers) * 100)
  const previewTitleLines = useMemo(
    () => selection ? splitPreviewTitle(selection.book.title) : [],
    [selection],
  )

  useLayoutEffect(() => {
    const copy = previewCopyRef.current
    const title = previewTitleRef.current
    if (!copy || !title) return

    let cancelled = false
    const measureTitle = () => {
      if (cancelled) return

      const heading = title.parentElement
      const lineHeight = heading ? Number.parseFloat(getComputedStyle(heading).lineHeight) : 0
      const lineCount = Math.min(2, Math.max(1, title.getClientRects().length))

      copy.dataset.titleLines = String(lineCount)
      if (Number.isFinite(lineHeight) && lineHeight > 0) {
        copy.style.setProperty('--popular-preview-title-line-height', `${lineHeight}px`)
      }
    }

    const resizeObserver = new ResizeObserver(measureTitle)
    resizeObserver.observe(copy)
    measureTitle()
    void document.fonts.ready.then(measureTitle)

    return () => {
      cancelled = true
      resizeObserver.disconnect()
    }
  }, [selection])

  const handleSelection = useCallback((next: PopularSelection | null) => setSelection(next), [])
  const openBook = useCallback((book: PopularBook) => {
    navigate(`/books/${encodeURIComponent(book.isbn13)}?from=home`)
  }, [navigate])
  const handleLoadProgress = useCallback((loaded: number, total: number) => {
    setLoadedCovers(loaded)
    setTotalCovers(total)
  }, [])
  const handleRendererReady = useCallback((next: 'webgl' | 'fallback') => {
    setRenderer(next)
    if (next === 'fallback') setView('grid')
  }, [])

  const selectSegment = (segmentId: string | null) => {
    setActiveSegmentId(segmentId)
    setFilterOpen(false)
  }

  if (isPending) {
    return (
      <main className="popular-home popular-home--loading" aria-busy="true">
        <p>인기도서 링을 준비하는 중</p>
        <span />
      </main>
    )
  }

  if (isError || !data) {
    return (
      <main className="popular-home popular-home--error">
        <h1>인기도서를 불러오지 못했습니다.</h1>
        <p>잠시 뒤 다시 시도해 주세요.</p>
      </main>
    )
  }

  return (
    <main className="popular-home">
      <div className="popular-home__toolbar">
        <div className="popular-home__toolbar-actions">
          <button type="button" className="popular-home__text-button" onClick={() => setFilterOpen((open) => !open)} aria-expanded={filterOpen}>
            인기도서 필터 {filterOpen ? '−' : '+'}
          </button>
          <Link to="/recommend" className="popular-home__recommend-button">책 추천받기</Link>
        </div>
        <button type="button" className="popular-home__text-button" onClick={() => setView((current) => current === 'ring' ? 'grid' : 'ring')}>
          {view === 'ring' ? 'Grid view +' : 'Ring view +'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {filterOpen && (
          <motion.aside
            className="popular-filter"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <div className="popular-filter__header">
              <p>연령·성별</p>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label="필터 닫기">닫기</button>
            </div>
            <button type="button" className={!activeSegmentId ? 'is-active' : ''} onClick={() => selectSegment(null)}>전체 {data.itemCount}권</button>
            <div className="popular-filter__segments">
              {segments.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  className={activeSegmentId === segment.id ? 'is-active' : ''}
                  onClick={() => selectSegment(activeSegmentId === segment.id ? null : segment.id)}
                >
                  <span>{segment.label}</span>
                  <span className="popular-filter__count">{segment.items.length}</span>
                </button>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {view === 'ring' ? (
        <>
          <Suspense fallback={<div className="popular-ring__webgl" aria-hidden="true" />}>
            <PopularRingCanvas
              segments={segments}
              activeSegmentId={activeSegmentId}
              onActiveSegmentChange={setActiveSegmentId}
              onSelectionChange={handleSelection}
              onBookOpen={openBook}
              onLoadProgress={handleLoadProgress}
              onRendererReady={handleRendererReady}
            />
          </Suspense>

          <div className={`popular-center ${selection ? 'is-preview' : ''}`} aria-live="polite">
            <AnimatePresence initial={false} mode="popLayout">
              {selection ? (
                <motion.article
                  key={selection.book.id}
                  className="popular-preview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <div ref={previewCopyRef} className="popular-preview__copy" data-title-lines="2">
                    <p>{selection.segment.label} <span>#{selection.book.ranking}</span></p>
                    <h1>
                      <span ref={previewTitleRef}>
                        {previewTitleLines[0]}
                        {previewTitleLines[1] && <><br className="popular-preview__title-break" />{previewTitleLines[1]}</>}
                      </span>
                    </h1>
                    <div className="popular-preview__details">
                      <div className="popular-preview__meta">
                        <span>{selection.book.author}</span>
                        <span>{selection.book.publisher}</span>
                        <span>{selection.book.publicationYear}</span>
                      </div>
                      <p className="popular-preview__loans">최근 3개월 대출 {selection.book.loanCount.toLocaleString('ko-KR')}회</p>
                    </div>
                  </div>
                  <div className="popular-preview__cover-slot">
                    <CoverImage book={selection.book} large />
                  </div>
                </motion.article>
              ) : (
                <motion.div key="wordmark" className="popular-wordmark" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <p>세대별로 지금 많이 읽는 책</p>
                  <h1>책추책책추</h1>
                  <span>{activeSegment ? activeSegment.label : `10개 독자 그룹 · 인기 ${data.itemCount}권`}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="popular-home__hint">드래그하거나 휠을 굴려 둘러보세요</p>
          {renderer === 'webgl' && progress < 100 && (
            <div className="popular-load" aria-label={`표지 ${progress}% 로딩`}>
              <span style={{ width: `${progress}%` }} />
              <p>{loadedCovers}/{totalCovers}</p>
            </div>
          )}
        </>
      ) : (
        <PopularGrid segments={segments} activeSegmentId={activeSegmentId} onOpen={openBook} />
      )}
    </main>
  )
}
