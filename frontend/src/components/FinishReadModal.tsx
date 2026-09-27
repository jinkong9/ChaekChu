import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { patchLibraryItem, removeLibraryItem, saveLibraryRecord } from '../api/library'
import type { ShelfStatus } from '../api/types'
import { useFinishModalStore } from '../stores/finishModalStore'
import './finish-read-modal.css'

const REVIEW_MAX = 300
/** 오늘(로컬 날짜, YYYY-MM-DD) — toISOString 은 UTC 라 한국 새벽엔 전날이 된다. 서버도 Asia/Seoul 기준(§6.2) */
const today = () => new Date().toLocaleDateString('sv-SE')
/** YYYY-MM-DD → 「일요일」. 로컬 자정으로 읽어야 한다 — new Date('2026-09-27') 는 UTC 라 요일이 하루 밀릴 수 있다 */
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('ko-KR', { weekday: 'long' })

/** 상태 세그먼트 라벨 — 상세 화면의 CTA 와 같은 말을 쓴다(찜/읽음 은 이 화면에서 쓰지 않는다) */
const STATUS_LABEL: Record<ShelfStatus, string> = { READ: '읽었어요', WISH: '읽고 싶어요' }

/** 완독 기록 모달 — 두 가지 일을 한다.
 *  · finish(기본): 상세·추천에서 「읽었어요」를 눌렀을 때. 별점(필수)·감상평(선택 300자)·완독일(기본 오늘, 미래 금지)을 받아 READ 로 저장한다.
 *  · edit: 서재 「책 기록 수정」에서. 위 셋에 더해 상태(읽었어요/읽고 싶어요)를 바꾸고 서재에서 뺄 수 있다.
 *    행에서 별점·감상·상태를 따로따로 고치던 것을 여기 한 곳으로 모았다 — 진입점이 셋이면 어디를 눌러야 하는지 안 보인다.
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
  const [status, setStatus] = useState<ShelfStatus>('READ')
  // 서재에서 빼기는 2단계 — 한 번 누르면 확인으로 바뀐다. 별점·감상·완독일이 통째로 사라지는 일이라 실수를 한 번 막는다
  const [removeArmed, setRemoveArmed] = useState(false)
  // 완독일을 비웠다가 되돌릴 때 쓸 값 — 기록 수정으로 들어온 책의 원래 완독일이 날아가지 않게 한다
  const lastDate = useRef(today())

  const editing = target?.mode === 'edit'

  // 대상이 바뀔 때 기존 기록으로 초기화 — 신규 완독과 기록 수정을 같은 모달이 감당한다
  useEffect(() => {
    if (!target) return
    setRating(target.rating ?? 0)
    setReview(target.reviewText ?? '')
    setDate(target.finishedDate === null ? '' : (target.finishedDate ?? today()))
    setStatus(target.status ?? 'READ')
    setRemoveArmed(false)
    lastDate.current = target.finishedDate || today()
  }, [target])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, close])

  const save = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('완독 대상이 없습니다.')
      // 읽고 싶어요로 내리면 상태만 보낸다 — 서버가 완독일을 비우고 별점·감상은 남긴다(§6.3)
      if (editing && status === 'WISH') {
        return patchLibraryItem(target.libraryItemId!, { status: 'WISH' })
      }
      // 미래 완독일 방어 — input max 와 별개로 제출 직전에 한 번 더 자른다
      const fin = date && date > today() ? today() : date
      const body = {
        status: 'READ' as const,
        rating,
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

  const remove = useMutation({
    mutationFn: async () => {
      if (!target?.libraryItemId) throw new Error('서재 항목이 없습니다.')
      await removeLibraryItem(target.libraryItemId)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library'] })
      qc.invalidateQueries({ queryKey: ['book'] })
      close()
    },
  })

  if (!target) return null

  const busy = save.isPending || remove.isPending
  // 읽고 싶어요로 바꾸면 완독 기록 칸은 접는다 — 저장되지 않는 값을 만지게 두면 안 된다
  const showRecord = !editing || status === 'READ'
  // 별점은 필수 — 완독으로 남기는 기록엔 별점이 있어야 한다. 읽고 싶어요로 내릴 때는 별점 칸이 접히므로 묻지 않는다
  const needsRating = showRecord && rating === 0

  // z-110: 서재의 「책 기록 수정」 화면(.libd-record, z-100)에서도 열린다 — 그 아래(90)에 두면 모달이 뜨긴 하는데 편집 화면이 덮어 안 보인다.
  // 이 모달은 어느 화면에서 부르든 맨 위여야 하므로 오버레이들보다 한 단 높게 둔다
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-7" role="dialog" aria-modal="true" aria-label={`${target.title} ${editing ? '기록 수정' : '완독 기록'}`}>
      {/* 어둡게만 — 블러·글로우는 쓰지 않는다 */}
      <button className="absolute inset-0 bg-black/25" aria-label="닫기" onClick={close} />
      {/* 다이어리 한 장 — 종이·여백선·괘선·손글씨는 finish-read-modal.css. 판형·그림자는 .eo-panel 을 그대로 쓴다 */}
      <div className="eo-panel frm-sheet relative w-[min(430px,calc(100vw-56px))]">
        <div className="frm-head">
          <p className="eo-label">{editing ? '기록 수정' : '완독 기록'}</p>
          <p className="eo-utility">나만 볼 수 있어요</p>
        </div>
        <h2 className="frm-title line-clamp-2 text-[19px] font-[650] leading-[1.25] tracking-[-0.02em]">{target.title}</h2>

        {editing && (
          <div className="mt-4">
            <p className="eo-utility">상태</p>
            <div className="eo-segments mt-1.5">
              {(['READ', 'WISH'] as const).map((s) => (
                <button key={s} type="button" className={`eo-segment ${status === s ? 'is-on' : ''}`}
                  aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {/* 예전 셀렉트는 이 전환을 아무 말 없이 했다 — 완독일이 사라지는 일이라 무엇이 남고 무엇이 지워지는지 말한다 */}
            {status === 'WISH' && target.status === 'READ' && (
              <p className="eo-utility mt-2">읽고 싶어요로 바꾸면 완독일은 지워지고, 별점과 감상평은 남아요.</p>
            )}
          </div>
        )}

        {showRecord && (
          <>
            {/* 일기의 첫 줄은 날짜다 — 그래서 완독일을 맨 위로 올리고, 손글씨 날짜 옆에 요일을 적는다.
                완독일을 비우면 「서비스를 만나기 전에 읽은 책」이 되는데, 날짜 칸을 직접 지워야 하는 걸 아는 사람이 없었다.
                그래서 비우는 일을 칩 하나로 만든다 — 켜면 날짜 칸을 걷어내고(빈 「연도-월-일」만 남아 있을 이유가 없다),
                끄면 원래 날짜(없으면 오늘)로 되돌린다. 칩이 눌린 것 자체가 완독일 없음의 표시라 따로 설명을 두지 않는다. */}
            <div className="mt-4">
              <p className="eo-utility">다 읽은 날</p>
              <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-2">
                {date && (
                  <span className="flex items-end gap-2">
                    <input type="date" className="frm-date w-[150px]" max={today()}
                      value={date} onChange={(e) => setDate(e.target.value)} aria-label="완독일" />
                    <span className="frm-weekday pb-[5px]" aria-hidden="true">{weekday(date)}</span>
                  </span>
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

            <div className="mt-4">
              <p className="eo-utility">별점 — 필수</p>
              <div className="mt-0.5 flex items-center">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-label={`별점 ${n}점`} aria-pressed={rating === n}
                    onClick={() => setRating(n)}
                    className={`frm-star ${rating >= n ? 'is-on' : ''}`}>★</button>
                ))}
              </div>
            </div>

            {/* 감상평이 이 면의 주인공 — 괘선 다섯 줄을 미리 깔아 두고 손글씨로 받는다. 넘치면 괘선째 안에서 스크롤한다 */}
            <div className="mt-3">
              <p className="eo-utility">감상 — 선택</p>
              <div className="frm-review-wrap mt-1">
                <textarea className="frm-review" aria-label="감상평" spellCheck={false}
                  maxLength={REVIEW_MAX} value={review} onChange={(e) => setReview(e.target.value)} />
              </div>
              <p className="eo-utility mt-1.5 text-right tabular-nums">{review.length} / {REVIEW_MAX}</p>
            </div>
          </>
        )}

        {(save.isError || remove.isError) && (
          <p className="eo-utility mt-3 text-ink">저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>
        )}

        {/* 아래 줄 — 왼쪽은 파괴적 행동(서재에서 빼기, edit 만), 오른쪽은 취소·저장. 빼기는 밑줄 링크로 위계를 낮추고 두 번 눌러야 실행된다 */}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-x-4 text-[11px]">
            {editing && (removeArmed ? (
              <>
                <span className="text-ink-faint">별점·감상평·완독일도 함께 지워져요</span>
                <button className="eo-link" disabled={busy} onClick={() => remove.mutate()}>빼기</button>
                <button className="eo-link" onClick={() => setRemoveArmed(false)}>취소</button>
              </>
            ) : (
              <button className="eo-link text-ink-faint" onClick={() => setRemoveArmed(true)}>서재에서 빼기</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-6">
            <button className="eo-link" onClick={close}>취소</button>
            <button className="eo-button" disabled={busy || needsRating} onClick={() => save.mutate()}>
              {editing ? '저장' : '완독으로 기록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
