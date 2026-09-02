import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { RecommendationItem } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { trackEvent } from '../lib/events'
import { coverAtWidth } from '../lib/coverUrl'
import { coverPalette } from '../lib/coverPalette'

/** 홈 B안 — 흐르는 서가. 어두운 무대 위에 큰 세리프 한 문장, 그 아래로 추천 덱의 표지가
 *  두 줄로 서로 반대 방향으로 흐른다. (레퍼런스: Fable 홈)
 *
 *  A안(궤도)이 '한 권씩 들여다보는' 화면이라면 B안은 '서가 앞을 지나가는' 화면이다.
 *  그래서 개별 책을 고르게 하기보다 문장 하나와 CTA 하나로 몰아준다. */

const COVER_W = 118
const COVER_H = 176
const GAP = 10
/** 아래 줄이 조금 느려야 두 줄이 같은 박자로 움직이지 않는다 */
const ROW1_SEC = 56
const ROW2_SEC = 72

const CSS = `
  /* 같은 세트를 두 벌 넣고 한 세트 폭(-50%)만큼 옮기면 이음매가 보이지 않는다 */
  .hb-strip { overflow: hidden; }
  .hb-row { display: flex; gap: ${GAP}px; width: max-content; will-change: transform; }
  .hb-row > * { flex: none; }
  .hb-left { animation: hb-left linear infinite; }
  .hb-right { animation: hb-right linear infinite; }
  @keyframes hb-left { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
  @keyframes hb-right { from { transform: translate3d(-50%,0,0); } to { transform: translate3d(0,0,0); } }
  /* 표지를 누를 수 있으니, 올리면 줄을 세워 쫓아가지 않아도 되게 한다 */
  .hb-strip:hover .hb-row { animation-play-state: paused; }
  .hb-cover { transition: transform 0.18s ease, box-shadow 0.18s ease; }
  .hb-cover:hover { transform: translateY(-6px); box-shadow: 0 18px 38px rgba(0,0,0,0.5); }
  @media (prefers-reduced-motion: reduce) {
    .hb-left, .hb-right { animation: none; }
    .hb-cover:hover { transform: none; }
  }
`

/** 표지 한 장 — 이미지가 없으면 서재·궤도와 같은 색 커버로 떨어진다.
 *  loading="lazy" 는 쓰지 않는다: 마퀴는 transform 으로 움직여서 지연 로딩이 제때 걸리지 않고,
 *  뷰포트 밖 표지가 끝까지 안 뜨거나 흐르는 도중에 툭 나타난다. */
function Cover({ item, w, h, onOpen }: { item: RecommendationItem; w: number; h: number; onOpen: () => void }) {
  const src = coverAtWidth(item.book.coverUrl, w)
  const c = coverPalette(item.book.bookId)
  return (
    <button type="button" onClick={onOpen} title={item.book.title}
      className="hb-cover block cursor-pointer rounded-[3px] p-0 text-left"
      style={{ width: w, height: h, background: c.bg, color: c.fg, boxShadow: '0 10px 26px rgba(0,0,0,0.34)' }}>
      {src
        ? <img src={src} alt={item.book.title} referrerPolicy="no-referrer" draggable={false}
            className="h-full w-full rounded-[3px] object-cover" />
        : <span className="line-clamp-4 block p-2 text-[11px] font-bold leading-snug">{item.book.title}</span>}
    </button>
  )
}

/** 한 줄. 같은 목록을 두 벌 렌더해야 -50% 루프가 매끄럽다 */
function Row({ items, reverse, seconds, onOpen }: {
  items: RecommendationItem[]; reverse?: boolean; seconds: number
  onOpen: (item: RecommendationItem) => void
}) {
  return (
    <div className="hb-strip" style={{ height: COVER_H }}>
      <div className={`hb-row ${reverse ? 'hb-right' : 'hb-left'}`} style={{ animationDuration: `${seconds}s` }}>
        {[...items, ...items].map((it, i) => (
          <Cover key={`${it.book.bookId}-${i}`} item={it} w={COVER_W} h={COVER_H} onOpen={() => onOpen(it)} />
        ))}
      </div>
    </div>
  )
}

export default function HomePageB() {
  const navigate = useNavigate()
  const { data, isPending } = useRecommendations()

  const items = useMemo(() => data?.items ?? [], [data])
  // 두 줄에 다른 책을 태워야 같은 표지가 위아래로 나란히 흐르지 않는다
  const half = Math.ceil(items.length / 2)
  const row1 = items.slice(0, half)
  const row2 = items.slice(half)

  const stage = { minHeight: 620 }
  const shell = 'flex-1 flex flex-col overflow-hidden'

  const open = (it: RecommendationItem) => {
    if (!data) return
    trackEvent('CLICK', { bookId: it.book.bookId, recommendationId: data.recommendationId, rank: it.rank })
    navigate(`/books/${it.book.bookId}?from=home`)
  }

  if (isPending) {
    return <main className={`${shell} items-center justify-center text-white/50`} style={{ ...stage, background: '#22224a' }}>추천을 불러오는 중…</main>
  }
  if (items.length === 0) {
    return <main className={`${shell} items-center justify-center text-white/50`} style={{ ...stage, background: '#22224a' }}>아직 보여 드릴 책이 없어요.</main>
  }

  // 오른쪽에 기울여 쌓은 세 권 — 레퍼런스의 일러스트 자리를 실물 표지로 대신한다
  const stack = items.slice(0, 3)
  const tilts = [{ deg: -8, left: 0, top: 0 }, { deg: -2, left: 74, top: 18 }, { deg: 6, left: 150, top: 8 }]

  return (
    <main className={`${shell} text-cream`} style={{ ...stage, background: '#22224a' }}>
      <style>{CSS}</style>

      {/* ===== 히어로 ===== */}
      <div className="flex min-h-0 flex-1 items-center gap-10 px-[72px]">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] uppercase tracking-[0.16em] text-accent">오늘의 서가</p>
          <h1 className="mt-5 leading-[1.32] tracking-[-0.03em]"
            style={{ fontFamily: 'var(--font-serif-ko)', fontWeight: 600, fontSize: 'clamp(34px, 4vw, 58px)', textWrap: 'pretty' }}>
            읽은 책 몇 권이면<br />다음 한 권이 보여요
          </h1>
          <p className="mt-[22px] max-w-[30em] text-[17px] leading-[1.75] text-cream/70">
            205만 권에서 당신 기준으로 골라, 왜 골랐는지까지 알려드려요.
          </p>
          <div className="mt-9 flex items-center gap-4">
            <button onClick={() => navigate('/recommend')}
              className="rounded-full bg-cream px-[30px] text-[15px] font-bold text-primary transition-transform hover:-translate-y-0.5"
              style={{ height: 52 }}>
              추천 받기
            </button>
            <span className="text-sm text-cream/50">읽은 책 3권이면 시작할 수 있어요</span>
          </div>
        </div>

        <div className="relative hidden h-[300px] w-[380px] shrink-0 lg:block">
          {stack.map((it, i) => (
            <button key={it.book.bookId} type="button" onClick={() => open(it)} title={it.book.title}
              className="hb-cover absolute cursor-pointer rounded p-0"
              style={{
                left: tilts[i].left, top: tilts[i].top, width: 176, height: 262,
                transform: `rotate(${tilts[i].deg}deg)`, boxShadow: '0 26px 60px rgba(0,0,0,0.45)',
                background: coverPalette(it.book.bookId).bg,
              }}>
              {coverAtWidth(it.book.coverUrl, 176)
                ? <img src={coverAtWidth(it.book.coverUrl, 176)!} alt="" referrerPolicy="no-referrer" draggable={false}
                    className="h-full w-full rounded object-cover" />
                : <span className="block p-3 text-sm font-bold" style={{ color: coverPalette(it.book.bookId).fg }}>{it.book.title}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 두 줄이 서로 반대 방향으로. 아래 줄은 화면 끝에 잘려 계속 이어지는 느낌을 준다 ===== */}
      <div className="shrink-0 overflow-hidden" style={{ height: COVER_H + GAP + 128 }}>
        <div className="flex flex-col" style={{ gap: GAP }}>
          <Row items={row1} seconds={ROW1_SEC} onOpen={open} />
          <Row items={row2} reverse seconds={ROW2_SEC} onOpen={open} />
        </div>
      </div>
    </main>
  )
}
