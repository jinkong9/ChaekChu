import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { api } from '../api/client'
import type { RecommendationItem } from '../api/types'
import { useRecommendations, RECOMMEND_DECK_SIZE } from '../lib/useRecommendations'
import { useTuneStore } from '../stores/tuneStore'
import { useAuthStore } from '../stores/authStore'
import { trackEvent } from '../lib/events'
import Postcard from '../components/Postcard'
import Envelope from '../components/Envelope'
import { glassine, GLASS_LINE } from '../lib/glassine'

/** REC-001 추천 B안 · 편지 — 추천을 '고른 결과'가 아니라 '오늘 도착한 우편'으로 건넨다.
 *  1위는 유산지 폴더에서 엽서 한 장이 솟아 나오고(표지=우표, 이유=손글씨),
 *  2위 아래는 아직 뜯지 않은 봉투로 늘어선다.
 *  데이터·이벤트 계약은 A안과 동일 — 덱 재정렬만 하고 후보 재생성은 하지 않는다. */

const CARD_W = 600          // 엽서 폭 — 안쪽 글씨·우표가 전부 이 값에 비례한다
const POCKET_W = 680        // 폴더 앞주머니 폭 (엽서보다 넓어야 '들어 있다'로 읽힌다)
const POCKET_H = 150        // 앞주머니 높이
const POCKET_INSET = 105    // 엽서 아랫단이 주머니 위로 올라오는 높이 — 차이만큼 엽서가 주머니에 잠긴다
const FLOOR = 26            // 폴더 바닥을 무대 아래에서 띄운다 — 잘린 면이 아니라 놓인 물건으로 보이게

export default function RecommendPageLetter() {
  const qc = useQueryClient()
  const { data, isPending, isError } = useRecommendations()
  const myTags = useTuneStore((s) => s.tags)
  const nickname = useAuthStore((s) => s.nickname)
  const reduced = useReducedMotion()

  // 노출 이벤트 — 덱(recommendationId)당 1회
  const impressed = useRef<string | null>(null)
  useEffect(() => {
    if (data && impressed.current !== data.recommendationId) {
      impressed.current = data.recommendationId
      trackEvent('IMPRESSION', { recommendationId: data.recommendationId })
    }
  }, [data])

  if (isPending) return <main className="p-8 text-gray-400 bg-white" style={{ minHeight: 'calc(100vh - 62px)' }}>편지를 가지러 가는 중…</main>
  if (isError || !data) return <main className="p-8 text-gray-400 bg-white" style={{ minHeight: 'calc(100vh - 62px)' }}>오늘은 도착한 편지가 없어요.</main>

  // 태그 선택 시 캐시된 덱을 겹치는 태그 수로 재정렬 — 후보 재생성 없음 (덱 구조 원칙)
  const overlap = (item: RecommendationItem) => item.tags.filter((t) => myTags.includes(t)).length
  // 태그로 재정렬한 뒤 상위 RECOMMEND_DECK_SIZE권까지만 편다
  const items = (myTags.length === 0 ? data.items : [...data.items].sort((a, b) => overlap(b) - overlap(a) || a.rank - b.rank))
    .slice(0, RECOMMEND_DECK_SIZE)
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
          {data.fallback ? '아직 취향을 몰라서 인기 도서로 첫 편지를 썼어요 — 찜하면 더 정확해져요.' : `최근 기록한 ${data.basedOnCount}권을 읽고 썼어요`}
        </p>

        {/* 적용 중인 관심 태그 — 최종 점수의 근거를 사람이 이해할 수 있게 표시 */}
        <div className="mt-4 flex items-center gap-2 border-2 border-primary rounded-lg bg-white px-4 py-2 text-sm flex-wrap">
          <span className="font-bold">관심 태그</span>
          {appliedTags.length === 0
            ? <span className="text-gray-400">아직 없어요 — 태그를 고르면 그 결이 먼저 올라와요</span>
            : appliedTags.map((t) => <Tag key={t} t={t} />)}
          <Link to="/tune" className="ml-auto font-bold underline">기준 조절하기 ›</Link>
        </div>

        {/* ===== 1위 — 폴더에서 엽서가 솟아 나온다 ===== */}
        <section className="relative mt-6 overflow-hidden" style={{ height: 530 + FLOOR }}>
          {/* 폴더 뒷판 — 엽서 양옆으로 살짝 비쳐 두께를 만든다 */}
          <div className="absolute left-1/2 -translate-x-1/2 rounded-t-md"
            style={{ width: POCKET_W + 20, bottom: FLOOR, height: 200, ...glassine(0.7, 2), boxShadow: `0 14px 26px -12px rgba(34,34,74,0.28), 0 0 0 1px ${GLASS_LINE} inset` }} />

          {/* 엽서 — 마운트 시 주머니 안에서 위로 (z10) */}
          <motion.div className="absolute left-1/2 z-10"
            style={{ bottom: POCKET_INSET + FLOOR, marginLeft: -CARD_W / 2 }}
            initial={reduced ? { opacity: 0 } : { y: 330, scale: 0.82, opacity: 0, rotate: 0 }}
            animate={reduced ? { opacity: 1 } : { y: 0, scale: 1, opacity: 1, rotate: -1.4 }}
            transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 90, damping: 17, delay: 0.25 }}>
            <Link to={`/books/${top.book.bookId}?from=rec`} onClick={() => click(top)} className="block hover:-translate-y-1 transition-transform">
              <Postcard book={top.book} reason={top.reasonText} to={nickname} width={CARD_W} postmark={postmark} insetBottom={POCKET_H - POCKET_INSET + 5} />
            </Link>
          </motion.div>

          {/* 폴더 앞주머니 (z20) — 가운데가 V로 파인 서류철 앞면. 같은 모양을 2px 크게 깔아 접힌 모서리를 만든다 */}
          {[{ h: POCKET_H + 2, tint: 0.78 }, { h: POCKET_H, tint: 0.6 }].map((p, i) => (
            <div key={i} className="absolute left-1/2 -translate-x-1/2 z-20"
              style={{
                width: POCKET_W, bottom: FLOOR, height: p.h, ...glassine(p.tint, i === 0 ? 0 : 4),
                clipPath: 'polygon(0 0, 38% 0, 50% 30%, 62% 0, 100% 0, 100% 100%, 0 100%)',
                boxShadow: i === 0 ? '0 -8px 24px -14px rgba(34,34,74,0.35)' : undefined,
              }} />
          ))}
          {/* 주머니 위에 얹은 라벨 — 이 편지가 언제 것인지 */}
          <div className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full border-2 border-primary bg-white px-4 py-1"
            style={{ bottom: 66 + FLOOR }}>
            <span className="text-xs font-bold">TOP 1</span>
            <span className="text-xs text-gray-400">{postmark} 소인</span>
          </div>
        </section>

        {/* 1위 태그 + 행동 — 엽서 밖에 두어 손글씨 면을 깨지 않는다 */}
        <div className="mt-5 flex flex-col items-center gap-3">
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

        {/* ===== 2위 이하 — 아직 뜯지 않은 편지들 ===== */}
        <h3 className="text-xl mt-12">아직 뜯지 않은 편지 <span className="text-sm text-gray-400 font-sans">봉투에 손을 올리면 안에 든 책이 보여요</span></h3>
        <div className="mt-4 grid grid-cols-5 gap-4">
          {rest.map((item) => (
            <Envelope key={item.book.bookId} item={item} onClick={() => click(item)} />
          ))}
        </div>
      </main>
    </div>
  )
}
