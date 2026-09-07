import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { LibraryItem, ShelfStatus } from '../api/types'
import LibraryList from '../components/LibraryList'
import { coverPalette } from '../lib/coverPalette'

const TABS: { key: ShelfStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'READ', label: '읽음' },
  { key: 'WISH', label: '찜' },
]

/** 표지 없는 책의 자리색 — 색은 실제 표지만 담당한다 (DESIGN.md Colors).
 *  다른 화면과 같은 자리색을 쓰도록 coverPalette를 그대로 빌려 쓴다. */
const coverColor = coverPalette

/** 분류 2단계의 마지막 세그먼트 ("문학 > 한국소설" → "한국소설") */
const categoryKey = (li: LibraryItem) => {
  const parts = (li.book.category ?? '').split(' > ').filter(Boolean)
  return parts[1] ?? parts[0] ?? '미분류'
}

/** 표지 카드 — coverUrl 있으면 이미지(핫링크), 없으면 색 커버(제목 가로쓰기: 긴 제목 문제 해결) */
function Cover({ li, size = 'md' }: { li: LibraryItem; size?: 'md' | 'sm' }) {
  const [broken, setBroken] = useState(false)
  const c = coverColor(li.book.bookId)
  const cls = size === 'md' ? 'w-[92px] h-[132px]' : 'w-9 h-[52px]'
  if (li.book.coverUrl && !broken) {
    return <img src={li.book.coverUrl} alt={li.book.title} referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      loading="lazy" decoding="async"
      className={`${cls} object-cover shadow-[3px_4px_10px_rgba(11,11,11,0.18)]`} />
  }
  return (
    <div className={`${cls} shadow-[3px_4px_10px_rgba(11,11,11,0.18)] flex flex-col justify-between p-1.5`}
      style={{ background: c.bg, color: c.fg }}>
      <span className={`font-bold leading-snug ${size === 'md' ? 'text-[11px] line-clamp-4' : 'text-[7px] line-clamp-3'}`}>{li.book.title}</span>
      {size === 'md' && <span className="text-[9px] opacity-80 truncate">{li.book.author}</span>}
    </div>
  )
}

/** hover 팝오버 — position:fixed 라 overflow 컨테이너에 잘리지 않음.
 *  마우스가 책 → 팝오버로 이동할 시간을 주기 위해 닫기는 지연(150ms) 처리 */
function BookPop({ li, x, y, onEnter, onLeave }: { li: LibraryItem; x: number; y: number; onEnter: () => void; onLeave: () => void }) {
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave}
      className="eo-panel fixed z-50 w-60 p-3.5 text-left"
      style={{ left: x, top: y, transform: 'translate(-50%, -100%) translateY(-10px)' }}>
      <p className="text-[13px] font-semibold leading-snug">{li.book.title}</p>
      <p className="mt-1 text-[10px] text-ink-faint">{li.book.author} · {categoryKey(li)}</p>
      {li.rating != null && <p className="mt-2 text-[13px] text-ink">{'★'.repeat(li.rating)}<span className="text-rule-soft">{'★'.repeat(5 - li.rating)}</span> <span className="ml-1 text-[11px] font-semibold tabular-nums">{li.rating}.0</span></p>}
      {li.status === 'READ' && li.finishedDate && <p className="mt-2 text-[10px] tabular-nums text-ink-faint">완독 · {li.finishedDate}</p>}
      {li.reviewText && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">{li.reviewText}</p>}
      <Link to={`/books/${li.book.bookId}`} className="eo-link mt-3">상세 보기</Link>
    </div>
  )
}

/** 선반 한 줄 — 나무 선반턱 위에 표지들이 서 있는 형태 */
function Shelf({ title, items, count, onBookEnter, onBookLeave }: {
  title: string; items: LibraryItem[]; count?: number
  onBookEnter: (li: LibraryItem, el: HTMLElement) => void; onBookLeave: () => void
}) {
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="eo-label">{title} <span className="ml-1 text-[10px] font-normal tabular-nums text-ink-faint">{count ?? items.length}권</span></h2>
      <div className="mt-2 relative">
        <div className="flex items-end gap-4 px-4 pb-2 pt-3 overflow-x-auto">
          {items.map((li) => (
            <div key={li.libraryItemId} className="flex-shrink-0 hover:-translate-y-2 transition-transform"
              onMouseEnter={(e) => onBookEnter(li, e.currentTarget)} onMouseLeave={onBookLeave}>
              <Link to={`/books/${li.book.bookId}`}><Cover li={li} /></Link>
            </div>
          ))}
        </div>
        {/* 선반턱 — 나무 톤 그라데이션 + 그림자 (이미지 없이 CSS만) */}
        <div className="h-3 rounded-sm" style={{ background: 'linear-gradient(#d9c9ae, #c4b092)' }} />
        <div className="h-1.5 mx-1 rounded-b-md" style={{ background: 'linear-gradient(#a8916f, #8f7855)' }} />
      </div>
    </section>
  )
}

/** LIB-001 내 서재 A안 — 선반턱 + 표지 카드 + hover 팝오버.
 *  전체 탭 = 읽는 중 / 이번 달 완독 / 찜 선반 + 분야별 책장, 상태 탭 = 그 상태만 분야별 선반.
 *  편집(별점·감상평·상태)은 목록 뷰(LibraryList)에서 — B안과 같은 컴포넌트를 쓴다. */
export default function LibraryPageShelf() {
  const [tab, setTab] = useState<ShelfStatus | 'ALL'>('ALL')
  const [view, setView] = useState<'shelf' | 'list'>('shelf')
  const [pop, setPop] = useState<{ li: LibraryItem; x: number; y: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showPop = (li: LibraryItem, el: HTMLElement) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    const r = el.getBoundingClientRect()
    setPop({ li, x: r.left + r.width / 2, y: r.top })
  }
  const hidePop = () => { hideTimer.current = setTimeout(() => setPop(null), 150) }
  const holdPop = () => { if (hideTimer.current) clearTimeout(hideTimer.current) }

  const { data } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })

  const all = data ?? []
  const byStatus = (s: ShelfStatus) => all.filter((li) => li.status === s)

  // 통계
  const readItems = byStatus('READ')
  const rated = readItems.filter((li) => li.rating != null)
  const avgRating = rated.length ? (rated.reduce((a, li) => a + (li.rating ?? 0), 0) / rated.length).toFixed(1) : '–'
  const thisMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
  const readThisMonth = readItems.filter((li) => li.finishedDate?.startsWith(thisMonth))

  // 분야별 그룹 (전체 or 현재 탭 범위)
  const scope = tab === 'ALL' ? all : byStatus(tab)
  const byCategory = [...scope.reduce((m, li) => {
    const k = categoryKey(li)
    m.set(k, [...(m.get(k) ?? []), li])
    return m
  }, new Map<string, LibraryItem[]>())].sort((a, b) => b[1].length - a[1].length)

  return (
    <main className="eo-page">
      <div className="eo-shell">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="eo-eyebrow">Library</p>
          <h1 className="eo-headline">내 서재</h1>
          <p className="eo-body mt-2.5">당신의 읽고 싶은 마음이 쌓이는 공간</p>
        </div>
        <Link to="/search" className="eo-button">책 추가</Link>
      </div>

      {/* 통계 타일 */}
      <div className="mt-8 grid grid-cols-2 border-t border-rule pt-4 sm:grid-cols-4">
        {[
          { label: '보유한 책', value: `${all.length}권` },
          { label: '완독', value: `${readItems.length}권` },
          { label: '찜', value: `${byStatus('WISH').length}권` },
          { label: '평균 별점', value: `★ ${avgRating}` },
        ].map((s) => (
          <div key={s.label} className="py-1.5">
            <p className="eo-utility">{s.label}</p>
            <p className="mt-1.5 text-[19px] font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 border-t border-rule">
        <div className="eo-segments">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
              className={`eo-segment ${tab === t.key ? 'is-on' : ''}`}>{t.label}</button>
          ))}
        </div>
        <div className="eo-segments ml-auto">
          <button className={`eo-segment ${view === 'shelf' ? 'is-on' : ''}`} onClick={() => setView('shelf')}>책장</button>
          <button className={`eo-segment ${view === 'list' ? 'is-on' : ''}`} onClick={() => setView('list')}>목록</button>
        </div>
      </div>

      {/* 책장 영역 — 크림/우드 무드는 배경·선반이 만들고, 표지는 제각각이어도 수용 */}
      {view === 'shelf' && (
      <div className="mt-7 space-y-9">
        {tab === 'ALL' ? (
          <>
            <Shelf title="이번 달 완독" items={readThisMonth} onBookEnter={showPop} onBookLeave={hidePop} />
            <Shelf title="찜한 책" items={byStatus('WISH')} onBookEnter={showPop} onBookLeave={hidePop} />

            {/* 분야별 책장 — 미니 카드 행 */}
            {byCategory.length > 0 && (
              <section>
                <h2 className="eo-label">분야별 책장</h2>
                <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
                  {byCategory.map(([cat, books]) => (
                    <button key={cat} onClick={() => setTab('READ')}
                      className="flex flex-shrink-0 items-center gap-3 border-t border-rule-soft px-1 py-3 transition-colors hover:border-ink">
                      <div className="flex -space-x-3">
                        {books.slice(0, 3).map((li) => <Cover key={li.libraryItemId} li={li} size="sm" />)}
                      </div>
                      <div className="text-left">
                        <p className="text-[12px] font-semibold">{cat}</p>
                        <p className="mt-1 text-[10px] tabular-nums text-ink-faint">{books.length}권</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          byCategory.map(([cat, books]) => <Shelf key={cat} title={cat} items={books} onBookEnter={showPop} onBookLeave={hidePop} />)
        )}

        {scope.length === 0 && (
          <div className="eo-empty">
            <p className="eo-body">이 선반은 아직 비어 있어요 — 오늘의 추천에서 한 권 꽂아 보세요.</p>
            <div className="flex items-center gap-7">
              <Link to="/recommend" className="eo-button">추천 보러 가기</Link>
              <Link to="/search" className="eo-text-button text-[13px]">검색하기</Link>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ===== 목록 뷰 — 별점·상태·감상평 편집은 여기서 ===== */}
      {view === 'list' && (
        <div className="mt-4">
          <LibraryList items={tab === 'ALL' ? all : byStatus(tab)} />
        </div>
      )}

      {pop && <BookPop li={pop.li} x={pop.x} y={pop.y} onEnter={holdPop} onLeave={hidePop} />}

      <p className="eo-utility mt-8">
        책장에서 표지에 마우스를 올리면 기록이 보여요 · 별점·상태·감상평 수정은 목록 뷰에서
      </p>
      </div>
    </main>
  )
}
