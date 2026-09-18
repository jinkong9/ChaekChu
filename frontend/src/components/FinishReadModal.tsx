import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { patchLibraryItem, saveLibraryRecord } from '../api/library'
import { useFinishModalStore } from '../stores/finishModalStore'

const REVIEW_MAX = 300
/** 감상평 입력이 늘어날 수 있는 최대 높이(px) — 세 줄쯤. 그 위로는 안에서 스크롤한다 */
const REVIEW_MAX_H = 72
/** 오늘(로컬 날짜, YYYY-MM-DD) — toISOString 은 UTC 라 한국 새벽엔 전날이 된다. 서버도 Asia/Seoul 기준(§6.2) */
const today = () => new Date().toLocaleDateString('sv-SE')

/** 완독 기록 모달 — READ 전환 시 별점(선택)·한줄평(선택 300자)·완독일(기본 오늘, 미래 금지)을 받는다.
 *  완독일을 비우면 "서비스 이전에 읽은 책"(finishedDate null)로 저장되어 연표·통계에서 빠진다.
 *  저장은 api/library 를 거친다 — 신규는 POST(이미 있으면 409 → PATCH), 기존 항목은 PATCH 한 번.
 *  스타일은 DESIGN.md popover 문법(종이 면·1px 테두리·정사각 모서리·낮은 그림자)을 따른다. */
export default function FinishReadModal() {
  const target = useFinishModalStore((s) => s.target)
  const close = useFinishModalStore((s) => s.close)
  const qc = useQueryClient()
  const [rating, setRating] = useState(0)
  const [review, setReview] = useState('')
  const [date, setDate] = useState(today())
  // 완독일을 비웠다가 되돌릴 때 쓸 값 — 기록 수정으로 들어온 책의 원래 완독일이 날아가지 않게 한다
  const lastDate = useRef(today())
  const reviewRef = useRef<HTMLTextAreaElement>(null)

  // 대상이 바뀔 때 기존 기록으로 초기화 — 신규 완독과 기록 수정을 같은 모달이 감당한다
  useEffect(() => {
    if (!target) return
    setRating(target.rating ?? 0)
    setReview(target.reviewText ?? '')
    setDate(target.finishedDate === null ? '' : (target.finishedDate ?? today()))
    lastDate.current = target.finishedDate || today()
  }, [target])

  /** 내용에 맞춰 감상평 칸의 높이를 맞춘다.
   *  .eo-field 는 한 줄짜리 입력용이라 min-height:40px 를 갖는다 — 그대로 두면 여기서 잰 높이(한 줄 ≈ 29px)를
   *  덮어써서 밑줄이 글자에서 떨어진 채로 남는다. 그래서 min-h-0 로 눌러 두고 높이를 여기서만 정한다. */
  useEffect(() => {
    const el = reviewRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, REVIEW_MAX_H)}px`
  }, [review, target])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, close])

  const save = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('완독 대상이 없습니다.')
      // 미래 완독일 방어 — input max 와 별개로 제출 직전에 한 번 더 자른다
      const fin = date && date > today() ? today() : date
      const body = {
        status: 'READ' as const,
        rating: rating || null,
        reviewText: review.trim() || null,
        finishedDate: fin || null, // null = 완독일 지움(§6.3: READ 항목의 완독일을 seed 처럼 null 로)
      }
      return target.libraryItemId != null
        ? patchLibraryItem(target.libraryItemId, body)
        : saveLibraryRecord(target.bookId, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library'] })
      qc.invalidateQueries({ queryKey: ['book'] })
      close()
    },
  })

  if (!target) return null

  // z-110: 서재의 「책 기록 수정」 화면(.libd-record, z-100)에서도 열린다 — 그 아래(90)에 두면 모달이 뜨긴 하는데 편집 화면이 덮어 안 보인다.
  // 이 모달은 어느 화면에서 부르든 맨 위여야 하므로 오버레이들보다 한 단 높게 둔다
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-7" role="dialog" aria-modal="true" aria-label={`${target.title} 완독 기록`}>
      {/* 어둡게만 — 블러·글로우는 쓰지 않는다 */}
      <button className="absolute inset-0 bg-black/25" aria-label="닫기" onClick={close} />
      <div className="eo-panel relative w-[min(430px,calc(100vw-56px))] p-[18px]">
        <p className="eo-label">완독 기록</p>
        <h2 className="mt-1.5 line-clamp-2 text-[19px] font-[650] leading-[1.25] tracking-[-0.02em]">{target.title}</h2>

        <div className="mt-5">
          <p className="eo-utility">별점 — 선택</p>
          <div className="mt-1.5 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-label={`별점 ${n}점`} aria-pressed={rating === n}
                onClick={() => setRating(rating === n ? 0 : n)}
                className={`text-[19px] leading-none ${rating >= n ? 'text-ink' : 'text-rule-soft'}`}>★</button>
            ))}
            {rating > 0 && <button className="eo-link ml-2" onClick={() => setRating(0)}>지우기</button>}
          </div>
        </div>

        <div className="mt-5">
          <p className="eo-utility">한 줄 감상평 — 선택, 나만 볼 수 있어요</p>
          <textarea ref={reviewRef} rows={1}
            className="eo-field eo-field--sm mt-1.5 w-full min-h-0 resize-none overflow-y-auto leading-relaxed"
            maxLength={REVIEW_MAX} value={review} onChange={(e) => setReview(e.target.value)} />
          <p className="eo-utility mt-1 text-right">{review.length} / {REVIEW_MAX}</p>
        </div>

        {/* 완독일을 비우면 「서비스를 만나기 전에 읽은 책」이 되는데, 날짜 칸을 직접 지워야 하는 걸 아는 사람이 없었다.
            그래서 비우는 일을 칩 하나로 만든다 — 켜면 날짜 칸을 걷어내고(빈 「연도-월-일」만 남아 있을 이유가 없다),
            끄면 원래 날짜(없으면 오늘)로 되돌린다. 칩이 눌린 것 자체가 완독일 없음의 표시라 따로 설명을 두지 않는다. */}
        <div className="mt-4">
          <p className="eo-utility">완독일</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            {date && (
              <input type="date" className="eo-field eo-field--sm w-[180px]" max={today()}
                value={date} onChange={(e) => setDate(e.target.value)} aria-label="완독일" />
            )}
            <button type="button" aria-pressed={!date}
              className={`eo-tag ${!date ? 'is-on' : ''}`}
              onClick={() => {
                if (date) { lastDate.current = date; setDate('') }
                else setDate(lastDate.current || today())
              }}>
              서비스를 만나기 전에 읽었어요
            </button>
          </div>
        </div>

        {save.isError && <p className="eo-utility mt-3 text-ink">저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}

        <div className="mt-7 flex items-center justify-end gap-6">
          <button className="eo-link" onClick={close}>취소</button>
          <button className="eo-button" disabled={save.isPending} onClick={() => save.mutate()}>완독으로 기록</button>
        </div>
      </div>
    </div>
  )
}
