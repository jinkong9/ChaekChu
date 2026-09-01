import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { api } from '../api/client'
import type { RecommendationItem } from '../api/types'
import { useRecommendations } from '../lib/useRecommendations'
import { useTuneStore } from '../stores/tuneStore'
import { useAuthStore } from '../stores/authStore'
import { trackEvent } from '../lib/events'
import { Stamp } from '../components/Postcard'
import LetterStamp from '../components/LetterStamp'
import StampFolder from '../components/StampFolder'

/** REC-001 추천 C안 · 우표첩 — 추천을 '모아 둔 우표첩에서 오늘 치를 꺼내는' 동작으로 건넨다.
 *  유산지 폴더 앞판이 왼쪽 모서리를 축으로 열리고, 안에서 표지 우표와 사연 우표가 오른쪽으로 계단식으로 나온다.
 *  2위 아래도 같은 우표첩을 작게 줄여 세우고, 손을 올리면 그 한 통만 열린다.
 *  데이터·이벤트 계약은 A·B안과 동일 — 덱 재정렬만 하고 후보 재생성은 하지 않는다. */

const PAGE_BG = '#ffffff'   // 톱니를 파낼 배경색 = 페이지 바탕
const STAMP_PAPER = '#f6f1e3'  // 우표 테 — 흰 바탕에서 톱니가 보이려면 바탕색과 달라야 한다

/** 히어로 무대 치수 — 폴더에서 나온 두 장이 오른쪽으로 늘어설 자리까지 포함한 폭 */
const HERO = { w: 748, h: 344, folderW: 240, folderH: 336 }
/** 2위 이하 미니 우표첩 */
const MINI = { folderW: 132, folderH: 185, stampW: 108, out: 100 }

export default function RecommendPageArchive() {
  const qc = useQueryClient()
  const { data, isPending, isError } = useRecommendations()
  const myTags = useTuneStore((s) => s.tags)
  const nickname = useAuthStore((s) => s.nickname)
  const reduced = useReducedMotion()

  // 히어로는 도착 연출 — 들어오고 잠시 뒤 저절로 열린다 (모션을 줄인 환경에선 즉시 열린 상태)
  const [heroOpen, setHeroOpen] = useState(false)
  useEffect(() => {
    if (reduced) { setHeroOpen(true); return }
    const t = setTimeout(() => setHeroOpen(true), 420)
    return () => clearTimeout(t)
  }, [reduced])

  // 노출 이벤트 — 덱(recommendationId)당 1회
  const impressed = useRef<string | null>(null)
  useEffect(() => {
    if (data && impressed.current !== data.recommendationId) {
      impressed.current = data.recommendationId
      trackEvent('IMPRESSION', { recommendationId: data.recommendationId })
    }
  }, [data])

  if (isPending) return <main className="p-8 text-gray-400 bg-white" style={{ minHeight: 'calc(100vh - 62px)' }}>우표첩을 여는 중…</main>
  if (isError || !data) return <main className="p-8 text-gray-400 bg-white" style={{ minHeight: 'calc(100vh - 62px)' }}>오늘 꽂아 둔 우표가 없어요.</main>

  // 태그 선택 시 캐시된 덱을 겹치는 태그 수로 재정렬 — 후보 재생성 없음 (덱 구조 원칙)
  const overlap = (item: RecommendationItem) => item.tags.filter((t) => myTags.includes(t)).length
  const items = myTags.length === 0 ? data.items : [...data.items].sort((a, b) => overlap(b) - overlap(a) || a.rank - b.rank)
  const [top, ...rest] = items
  const appliedTags = myTags.length > 0 ? myTags : data.appliedTags
  const postmark = new Date(data.generatedAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })

  const save = (bookId: number, rank: number, status: 'WISH' | 'READING') => {
    if (status === 'WISH') trackEvent('WISH', { bookId, recommendationId: data.recommendationId, rank })
    api.post('/library', { bookId, status }).then(() => qc.invalidateQueries({ queryKey: ['library'] })).catch(() => {})
  }
  const click = (item: RecommendationItem) =>
    trackEvent('CLICK', { bookId: item.book.bookId, recommendationId: data.recommendationId, rank: item.rank })

  const Tag = ({ t }: { t: string }) => (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${myTags.includes(t) ? 'border-accent text-accent font-bold' : 'border-gray-300 text-gray-500'}`}>{t}</span>
  )

  return (
    <div className="bg-white" style={{ minHeight: 'calc(100vh - 62px)' }}>
      <main className="px-8 pb-16 pt-8 max-w-5xl mx-auto">
        <h1 className="text-3xl">오늘, 한 권 도착했어요</h1>
        <p className="text-sm text-gray-500 mt-1">
          {data.fallback ? '아직 취향을 몰라서 인기 도서로 첫 장을 채웠어요 — 찜하면 더 정확해져요.' : `최근 기록한 ${data.basedOnCount}권을 보고 골랐어요`}
        </p>

        {/* 적용 중인 관심 태그 — 최종 점수의 근거를 사람이 이해할 수 있게 표시 */}
        <div className="mt-4 flex items-center gap-2 border-2 border-primary rounded-lg bg-white px-4 py-2 text-sm flex-wrap">
          <span className="font-bold">관심 태그</span>
          {appliedTags.length === 0
            ? <span className="text-gray-400">아직 없어요 — 태그를 고르면 그 결이 먼저 올라와요</span>
            : appliedTags.map((t) => <Tag key={t} t={t} />)}
          <Link to="/tune" className="ml-auto font-bold underline">기준 조절하기 ›</Link>
        </div>

        {/* ===== 1위 — 우표첩에서 표지 우표와 사연 우표가 차례로 나온다 ===== */}
        <section className="mt-8 flex justify-center">
          <div className="relative" style={{ width: HERO.w, height: HERO.h }}>
            <Link to={`/books/${top.book.bookId}?from=rec`} onClick={() => click(top)} className="block">
              <StampFolder
                open={heroOpen} width={HERO.folderW} height={HERO.folderH}
                label="오늘의 편지" sub={`${postmark} 소인 · TOP 1`}
                slots={[
                  {
                    key: 'cover', out: 250, tilt: -2, top: 28, left: 20,
                    node: <Stamp book={top.book} width={200} notch={PAGE_BG} frame={STAMP_PAPER} />,
                  },
                  {
                    key: 'letter', out: 505, tilt: 1.6, top: 7, left: 5,
                    node: <LetterStamp reason={top.reasonText} to={nickname} postmark={postmark} rank={top.rank} width={230} notch={PAGE_BG} />,
                  },
                ]}
              />
            </Link>
          </div>
        </section>

        {/* 1위 태그 + 행동 — 우표 면을 깨지 않도록 밖에 둔다 */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="flex gap-1.5 flex-wrap justify-center">{top.tags.map((t) => <Tag key={t} t={t} />)}</div>
          <p className="text-sm text-gray-500">
            <span className="font-bold text-primary">{top.book.title}</span>
            {top.book.author && <span> · {top.book.author}</span>}
          </p>
          <div className="flex gap-2">
            <button className="bg-primary text-white rounded-lg px-5 py-2 font-bold" onClick={() => save(top.book.bookId, top.rank, 'WISH')}>찜하기</button>
            <button className="border-2 border-primary rounded-lg px-5 py-2" onClick={() => save(top.book.bookId, top.rank, 'READING')}>서재에 담기</button>
          </div>
        </div>

        {/* ===== 2위 이하 — 같은 우표첩을 작게. 손을 올린 한 통만 열린다 ===== */}
        <h3 className="text-xl mt-12">우표첩의 다음 장 <span className="text-sm text-gray-400 font-sans">폴더에 손을 올리면 안에 든 표지가 나와요</span></h3>
        <div className="mt-4 grid grid-cols-4 gap-4">
          {rest.map((item) => <MiniFolder key={item.book.bookId} item={item} onClick={() => click(item)} />)}
        </div>
      </main>
    </div>
  )
}

/** 2위 이하 한 통 — hover(=우표첩을 집는 순간)에만 열린다.
 *  열리면 표지가 옆 칸까지 밀려 나오므로 그동안만 z를 올려 이웃 위에 그린다. */
function MiniFolder({ item, onClick }: { item: RecommendationItem; onClick?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Link to={`/books/${item.book.bookId}?from=rec`} onClick={onClick}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      className="block outline-none relative" style={{ zIndex: open ? 30 : 0 }}>
      <StampFolder
        open={open} width={MINI.folderW} height={MINI.folderH}
        label={`No.${item.rank}`}
        slots={[{
          key: 'cover', out: MINI.out, tilt: -2, top: 17, left: 12,
          node: <Stamp book={item.book} width={MINI.stampW} notch={PAGE_BG} frame={STAMP_PAPER} />,
        }]}
      />
      <p className="mt-2.5 font-bold text-sm leading-snug line-clamp-2" style={{ width: MINI.folderW + 24 }}>{item.book.title}</p>
      {/* 태그 = 이 우표의 요약 이유 (2줄 수용 고정 높이로 카드 높이 정렬) */}
      <div className="mt-1.5 h-11 flex gap-1 flex-wrap content-start" style={{ width: MINI.folderW + 24 }}>
        {item.tags.slice(0, 2).map((t) => (
          <span key={t} className="rounded-full border border-primary/25 px-2 py-0.5 text-[11px] text-gray-500">{t}</span>
        ))}
      </div>
    </Link>
  )
}
