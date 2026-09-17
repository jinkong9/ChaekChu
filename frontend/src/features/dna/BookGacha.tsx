/** 완전 랜덤 책 가챠 — BOOK DNA 리포트의 01번 콘텐츠.
 *
 *  이름 그대로 균일 난수로 한 권을 뽑는다. 취향을 반영하지 않는 게 이 콘텐츠의 요지다 —
 *  리포트의 나머지 칸이 "당신의 기록이 말하는 취향"이라면, 여기는 그 바깥으로 한 걸음이다.
 *  그래서 후보도 내 서재가 아니라 책 전체다(useGachaPool).
 *
 *  다만 뽑고 끝내지 않는다. 뽑힌 책의 장르가 리포트 레이더에서 몇 %인지 붙여서
 *  "이게 내 취향에서 얼마나 먼 자리인지"를 알려 준다. 그래야 랜덤이 그냥 랜덤으로 끝나지 않는다.
 *
 *  돌아가는 표지는 연출일 뿐이고, 당첨은 뽑기를 누른 순간 이미 정해져 있다. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DnaBook } from './dnaTypes'
import { axisOf, type DnaProfile } from './dnaProfile'
import { coverAtWidth } from '../../lib/coverUrl'
import DnaDialog from './DnaDialog'
import GachaMachine from './GachaMachine'

/** 유리구에 보이는 캡슐 수 — GachaMachine 의 자리 수와 같다 */
const CAPSULE_COUNT = 14

/** 캡슐에 넣을 표지를 고르기 위한 섞기 (Fisher–Yates) */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 표지가 돌아가는 시간(ms)과 한 장이 머무는 시간(ms) */
const SPIN_MS = 900
const FRAME_MS = 70
const COVER_W = 300

type Phase = 'idle' | 'spinning' | 'done'

/** 뽑힌 책의 장르가 이 독자의 레이더에서 몇 %인지 → 거리 한 줄 */
function distance(book: DnaBook, axes: DnaProfile['axes']) {
  const axis = axisOf(book.classNo)
  const value = axes.find((a) => a.label === axis)?.value ?? 0
  if (value >= 55) return { axis, value, verdict: '취향 정중앙 — 가장 많이 읽는 자리에서 뽑혔어요.' }
  if (value >= 20) return { axis, value, verdict: '취향의 가장자리 — 읽긴 읽지만 중심은 아닌 자리예요.' }
  return { axis, value, verdict: '완전히 새 영역 — 지금껏 거의 손대지 않은 장르예요.' }
}

export default function BookGacha({
  pool,
  axes,
  onClose,
}: {
  pool: DnaBook[]
  /** 리포트 레이더 — 뽑힌 책이 취향에서 얼마나 먼지 재는 자 */
  axes: DnaProfile['axes']
  onClose: () => void
}) {
  // 유리구를 채울 표지 — 열 때 한 번만 고른다. 매 렌더마다 다시 뽑으면 캡슐이 깜빡인다
  const capsuleCovers = useMemo(() => shuffled(pool).slice(0, CAPSULE_COUNT).map((b) => b.coverUrl), [pool])
  const [phase, setPhase] = useState<Phase>('idle')
  const [book, setBook] = useState<DnaBook | null>(null)
  /** 돌아가는 동안 스쳐 보여 줄 표지 */
  const [flash, setFlash] = useState<DnaBook | null>(null)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const ids = timers.current
    return () => ids.forEach(clearTimeout)
  }, [])

  const pull = () => {
    if (phase === 'spinning' || pool.length === 0) return
    // 당첨은 지금 정한다. 아래 연출은 이 결과를 바꾸지 않는다
    const won = pool[Math.floor(Math.random() * pool.length)]
    setPhase('spinning')
    setBook(null)

    const ids: number[] = []
    for (let t = 0; t < SPIN_MS; t += FRAME_MS) {
      ids.push(
        window.setTimeout(() => setFlash(pool[Math.floor(Math.random() * pool.length)]), t),
      )
    }
    ids.push(
      window.setTimeout(() => {
        setFlash(null)
        setBook(won)
        setPhase('done')
      }, SPIN_MS),
    )
    timers.current.forEach(clearTimeout)
    timers.current = ids
  }

  const shown = book ?? flash
  const d = book ? distance(book, axes) : null

  return (
    <DnaDialog
      label="완전 랜덤 책 가챠"
      kicker="Random Draw"
      status={phase === 'done' ? '뽑기 완료' : phase === 'spinning' ? '뽑는 중' : `후보 ${pool.length}권`}
      onClose={onClose}
    >
      <div className="dnar-gacha">
        {phase === 'idle' ? (
          <>
            <p className="dnar-dlg__ask">취향은 잠시 접어 두고, 한 권을 뽑아 볼까요?</p>
            {/* 기계가 곧 버튼이다 — 손잡이를 누르면 뽑힌다 */}
            <GachaMachine covers={capsuleCovers} onPull={pull} />
            <p className="dnar-gacha__lead">
              책 {pool.length}권에서 <b>가중치 없이</b> 한 권을 뽑습니다.
              <br />
              추천이 아니라 우연입니다 — 그래서 취향 밖의 책이 나올 수 있어요.
            </p>
            <button type="button" className="dnar-gacha__pull" onClick={pull}>
              손잡이 돌리기
            </button>
          </>
        ) : (
          <>
            <div className={`dnar-gacha__slot ${phase === 'spinning' ? 'is-spinning' : ''}`}>
              {shown && (
                <img
                  key={shown.isbn13}
                  src={coverAtWidth(shown.coverUrl, COVER_W) ?? shown.coverUrl}
                  alt=""
                  width={COVER_W}
                  decoding="async"
                />
              )}
            </div>

            {book && d && (
              <div className="dnar-gacha__reveal">
                <p className="dnar-gacha__title">{book.title}</p>
                <p className="dnar-gacha__meta">
                  {book.author} · {d.axis}
                </p>
                <p className="dnar-gacha__verdict">
                  당신의 <b>{d.axis}</b> 지분은 {d.value}%.
                  <br />
                  {d.verdict}
                </p>
                <div className="dnar-dlg__actions">
                  <button type="button" className="dnar-dlg__button" onClick={pull}>
                    다시 뽑기
                  </button>
                  <button type="button" className="dnar-dlg__close" onClick={onClose}>
                    닫기
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DnaDialog>
  )
}
