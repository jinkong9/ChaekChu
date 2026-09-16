import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { api } from '../api/client'
import { addToLibrary } from '../api/library'
import type { LibraryItem, RecommendationItem, ShelfStatus } from '../api/types'
import { useRecommendations, RECOMMEND_DECK_SIZE } from '../lib/useRecommendations'
import { tagLabel, useTags } from '../lib/useTags'
import { useTuneStore } from '../stores/tuneStore'
import { useFinishModalStore } from '../stores/finishModalStore'
import { useAuthStore } from '../stores/authStore'
import { trackEvent } from '../lib/events'
import { SHELF_ACTIONS } from '../lib/shelf'
import { Stamp } from '../components/Stamp'
import LetterStamp from '../components/LetterStamp'
import StampFolder from '../components/StampFolder'

/** REC-001 추천 화면 — 추천을 '모아 둔 우표첩에서 오늘 치를 꺼내는' 동작으로 건넨다.
 *  유산지 봉투의 오른쪽 덮개가 젖혀지고, 그 틈으로 표지 우표와 사연 우표가 계단식으로 나온다.
 *  아래 후보를 누르면 그 책을 이 자리로 꺼내 놓는다 — 넣었다가 다시 꺼내는 동작을 그대로 되풀이한다.
 *  덱은 태그로 재정렬만 하고 후보를 새로 만들지는 않는다 (덱 구조 원칙).
 *  우표첩·엽서라는 재질은 이 화면의 시그니처로 남기고, 그 밖의 면은 홈과 같은 종이·잉크로 둔다. */

const PAGE_BG = '#fdfdfb'      // 톱니를 파낼 배경색 = 페이지 바탕(paper). 실제 배경과 달라지면 톱니에 테가 생긴다
const STAMP_PAPER = '#f6f1e3'  // 우표 테 — 종이 바탕에서 톱니가 보이려면 바탕색과 달라야 한다

/** 히어로 무대 치수 — 폴더에서 나온 두 장이 오른쪽으로 늘어설 자리까지 포함한 폭 */
const HERO = { w: 748, h: 344, folderW: 240, folderH: 336 }
/** 2위 이하 미니 우표첩 */
const MINI = { folderW: 132, folderH: 185, stampW: 108, out: 100 }
/** 이미 서재에 담긴 책의 버튼 라벨 — SHELF_ACTIONS 의 현재형과 짝 */
const DONE_LABEL: Record<ShelfStatus, string> = { WISH: '찜했어요', READ: '읽었어요' }

export default function RecommendPage() {
  const qc = useQueryClient()
  const myTags = useTuneStore((s) => s.tags)
  // 기준 조절에서 고른 태그는 서버로 보낸다(§5.1) — 덱 순서·appliedTags 는 서버가 정한 그대로 그린다
  const { data, isPending, isError } = useRecommendations(myTags)
  // 서버는 태그 사전의 공개 코드(`FICTION`)로 돌려주고 기준 조절은 라벨(`#소설`)로 보낸다 — 사전으로 라벨을 붙이고 강조도 라벨끼리 맞춘다
  const { data: tagDict } = useTags('GENRE')
  const label = (t: string) => tagLabel(t, tagDict)
  const isMine = (t: string) => myTags.includes(label(t))
  const nickname = useAuthStore((s) => s.nickname)
  const reduced = useReducedMotion()
  const openFinish = useFinishModalStore((s) => s.open)

  // 내 서재 — 추천 응답에는 `my` 가 없어서, 이 책이 이미 담겨 있는지는 서재 목록과 대조해 안다.
  // 서재 화면과 같은 queryKey 라 캐시를 공유하고, 담기·완독 모달이 invalidate 하면 여기 표시도 같이 바뀐다
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: async () => (await api.get<{ items: LibraryItem[] }>('/library/me')).data.items,
  })
  const mine = (bookId: number) => library?.find((li) => li.book.bookId === bookId)
  // 담기 왕복 동안 버튼을 잠그고, 실패는 버튼 아래에 적는다 — 눌렀는데 아무 반응이 없던 것을 없앤다
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 히어로 자리에 꺼내 둔 책. null이면 1순위
  const [featuredId, setFeaturedId] = useState<number | null>(null)
  // 히어로는 도착 연출 — 들어오고 잠시 뒤 저절로 열린다 (모션을 줄인 환경에선 즉시 열린 상태)
  const [heroOpen, setHeroOpen] = useState(false)
  const reopen = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heroRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (reduced) { setHeroOpen(true); return }
    const t = setTimeout(() => setHeroOpen(true), 420)
    return () => clearTimeout(t)
  }, [reduced])
  useEffect(() => () => clearTimeout(reopen.current), [])

  // 노출 이벤트 — 덱(recommendationId)당 1회
  const impressed = useRef<string | null>(null)
  useEffect(() => {
    if (data && impressed.current !== data.recommendationId) {
      impressed.current = data.recommendationId
      trackEvent('IMPRESSION', { recommendationId: data.recommendationId })
    }
  }, [data])

  if (isPending) {
    return (
      <main className="eo-page">
        <div className="eo-state">
          <span className="eo-progress" />
          <p className="eo-body">우표첩을 여는 중</p>
        </div>
      </main>
    )
  }
  if (isError || !data) {
    return (
      <main className="eo-page">
        <div className="eo-state">
          <h1 className="eo-title">오늘 꽂아 둔 우표가 없어요</h1>
          <p className="eo-body">기준을 조금 손보면 다음 장을 채울 수 있어요.</p>
          <Link to="/tune" className="eo-text-button text-[13px]">추천 기준 조절하기</Link>
        </div>
      </main>
    )
  }

  // 태그 선택 시 캐시된 덱을 겹치는 태그 수로 재정렬 — 후보 재생성 없음 (덱 구조 원칙)
  // 태그로 재정렬한 뒤 상위 RECOMMEND_DECK_SIZE권까지만 편다
  const items = data.items.slice(0, RECOMMEND_DECK_SIZE)
  // 꺼내 둔 책이 곧 히어로. 나머지는 순위 그대로 아래에 남는다 (원래 1순위도 여기로 내려온다)
  const featured = items.find((i) => i.book.bookId === featuredId) ?? items[0]
  const rest = items.filter((i) => i !== featured)
  const appliedTags = data.appliedTags
  const postmark = new Date(data.generatedAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })

  const save = (item: RecommendationItem, status: ShelfStatus) => {
    const { bookId, title } = item.book
    const existing = mine(bookId)
    // 읽음은 상세 화면과 똑같이 완독 모달(별점·한줄평·완독일)을 거친다. 이미 서재에 있으면 그 기록을 채워 열어 수정이 된다
    if (status === 'READ') {
      openFinish({ bookId, title, libraryItemId: existing?.libraryItemId,
        rating: existing?.rating, reviewText: existing?.reviewText,
        finishedDate: existing?.status === 'READ' ? existing.finishedDate : undefined })
      return
    }
    // 찜은 서버로 바로 간다. 이미 담긴 책이면 409 → api/library 가 PATCH 로 처리한다
    trackEvent('WISH', { bookId, recommendationId: data.recommendationId, rank: item.rank })
    setSaving(true)
    setSaveError(null)
    addToLibrary(bookId, status)
      .then(() => { qc.invalidateQueries({ queryKey: ['library'] }); qc.invalidateQueries({ queryKey: ['book', String(bookId)] }) })
      // 401 은 인터셉터가 로그아웃으로 받아 간다 — 여기 남는 건 네트워크 끊김·서버 오류
      .catch(() => setSaveError('서재에 담지 못했어요. 잠시 후 다시 눌러 주세요.'))
      .finally(() => setSaving(false))
  }
  const click = (item: RecommendationItem) =>
    trackEvent('CLICK', { bookId: item.book.bookId, recommendationId: data.recommendationId, rank: item.rank })

  /** 후보를 히어로 자리로 꺼낸다 — 폴더를 한 번 닫았다 여는 것으로 '바꿔 꺼냈다'를 보여 준다.
   *  선택 자체는 상세로 가는 행동이 아니므로 CLICK 이벤트를 보내지 않는다
   *  (계약의 CLICK은 도서 상세 진입을 뜻한다 — 히어로의 표지 우표를 누를 때 나간다). */
  const feature = (item: RecommendationItem) => {
    if (item.book.bookId === featured.book.bookId) return
    setFeaturedId(item.book.bookId)
    clearTimeout(reopen.current)
    if (reduced) {
      setHeroOpen(true)
    } else {
      setHeroOpen(false)
      reopen.current = setTimeout(() => setHeroOpen(true), 280)
    }
    // 히어로는 목록보다 위에 있어 그대로면 바뀐 걸 못 본다
    heroRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
  }

  return (
    <main className="eo-page">
      <div className="eo-shell">
        <header className="eo-pagehead">
          <p className="eo-eyebrow">{postmark} 소인</p>
          <h1 className="eo-headline">오늘, 한 권 도착했어요</h1>
          <p className="eo-body mt-3.5 max-w-[52ch]">
            {data.fallback
              ? '아직 취향을 몰라서 인기 도서로 첫 장을 채웠어요 — 찜하면 더 정확해져요.'
              : `최근 기록한 ${data.basedOnCount}권을 보고 골랐어요`}
          </p>
        </header>

        {/* 적용 중인 관심 태그 — 최종 점수의 근거를 사람이 이해할 수 있게 표시 */}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3.5">
          <span className="eo-label shrink-0">관심 태그</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {appliedTags.length === 0
              ? <span className="text-[11px] text-ink-faint">아직 없어요 — 태그를 고르면 그 결이 먼저 올라와요</span>
              : appliedTags.map((t) => <span key={t} className={`eo-tag ${isMine(t) ? 'is-on' : ''}`}>{label(t)}</span>)}
          </div>
          <Link to="/tune" className="eo-link shrink-0">기준 조절하기</Link>
        </div>

        {/* ===== 꺼내 놓은 한 권 — 우표첩에서 표지 우표와 사연 우표가 차례로 나온다 ===== */}
        <section ref={heroRef} className="mt-10 flex justify-center overflow-x-auto" style={{ scrollMarginTop: 80 }}>
          <div className="relative shrink-0" style={{ width: HERO.w, height: HERO.h }}>
            <StampFolder
              open={heroOpen} width={HERO.folderW} height={HERO.folderH}
              label="오늘의 책" sub={`${postmark} 소인 · No.${featured.rank}`}
              slots={[
                {
                  key: 'cover', out: 250, tilt: -2, top: 28, left: 20,
                  // 표지 우표 = 도서 상세로 가는 문
                  node: (
                    <Link to={`/books/${featured.book.bookId}?from=rec`} onClick={() => click(featured)}
                      className="block transition-transform duration-150 hover:-translate-y-1" aria-label={`${featured.book.title} 상세 보기`}>
                      <Stamp book={featured.book} width={200} notch={PAGE_BG} frame={STAMP_PAPER} />
                    </Link>
                  ),
                },
                {
                  key: 'letter', out: 505, tilt: 1.6, top: 7, left: 5,
                  // 사연 우표 = 추천 상세로 가는 문. 그 화면이 아직 없어 링크는 보류 —
                  // 라우트가 생기면 표지 우표와 같은 모양으로 Link만 감싸면 된다.
                  node: <LetterStamp reason={featured.reasonText} to={nickname} postmark={postmark} rank={featured.rank} width={230} notch={PAGE_BG} />,
                },
              ]}
            />
          </div>
        </section>

        {/* 꺼낸 책의 태그 + 행동 — 우표 면을 깨지 않도록 밖에 둔다 */}
        <div className="mt-8 flex flex-col items-center gap-4 text-center">
          <div className="flex flex-wrap justify-center gap-1.5">
            {featured.tags.map((t) => <span key={t} className={`eo-tag ${isMine(t) ? 'is-on' : ''}`}>{label(t)}</span>)}
          </div>
          <p className="max-w-[46ch]">
            <span className="text-[15px] font-semibold">{featured.book.title}</span>
            {featured.book.author && <span className="text-[12px] text-ink-muted"> · {featured.book.author}</span>}
          </p>
          {/* 찜하기 하나만 캡슐형 CTA, 나머지 담기는 밑줄 버튼으로 위계를 낮춘다.
              이미 담긴 쪽은 라벨이 과거형으로 바뀌고 눌린 상태(aria-pressed)가 된다 — 다시 누르면 읽음은 기록 수정, 찜은 그대로 */}
          <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
            {SHELF_ACTIONS.map((a, i) => {
              const on = mine(featured.book.bookId)?.status === a.status
              return (
                <button key={a.status} onClick={() => save(featured, a.status)} disabled={saving} aria-pressed={on}
                  className={i === 0 ? 'eo-button' : 'eo-text-button text-[13px]'}>
                  {on ? `✓ ${DONE_LABEL[a.status]}` : a.label}
                </button>
              )
            })}
          </div>
          {saveError && <p className="text-[11px] text-ink-muted" role="alert">{saveError}</p>}
        </div>

        {/* ===== 나머지 후보 — 같은 우표첩을 작게. 손을 올린 한 통만 열린다 ===== */}
        <section className="eo-section mt-12">
          <div className="eo-section__header">
            <h2 className="eo-title">우표첩의 다음 장</h2>
            <span>손을 올리면 표지가 보이고, 누르면 위로 꺼내 놓아요</span>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-4">
            {rest.map((item) => <MiniFolder key={item.book.bookId} item={item} label={label} onSelect={() => feature(item)} />)}
          </div>
        </section>
      </div>
    </main>
  )
}

/** 후보 한 통 — hover(=우표첩을 집는 순간)에 열리고, 누르면 히어로 자리로 올라간다.
 *  열리면 표지가 옆 칸까지 밀려 나오므로 그동안만 z를 올려 이웃 위에 그린다. */
function MiniFolder({ item, label, onSelect }: { item: RecommendationItem; label: (t: string) => string; onSelect: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <button type="button" onClick={onSelect}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      className="relative block cursor-pointer text-left" style={{ zIndex: open ? 30 : 0 }}
      aria-label={`${item.book.title} 꺼내 보기`}>
      <StampFolder
        open={open} width={MINI.folderW} height={MINI.folderH}
        label={`No.${item.rank}`}
        slots={[{
          key: 'cover', out: MINI.out, tilt: -2, top: 17, left: 12,
          node: <Stamp book={item.book} width={MINI.stampW} notch={PAGE_BG} frame={STAMP_PAPER} />,
        }]}
      />
      <p className="mt-3 line-clamp-2 text-[12px] font-semibold leading-snug" style={{ width: MINI.folderW + 24 }}>{item.book.title}</p>
      {/* 태그 = 이 우표의 요약 이유 (2줄 수용 고정 높이로 카드 높이 정렬) */}
      <div className="mt-2 flex h-[62px] flex-wrap content-start gap-1" style={{ width: MINI.folderW + 24 }}>
        {item.tags.slice(0, 2).map((t) => <span key={t} className="eo-tag">{label(t)}</span>)}
      </div>
    </button>
  )
}
