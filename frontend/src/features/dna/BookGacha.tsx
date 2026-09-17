/** 완전 랜덤 책 가챠 — BOOK DNA 리포트의 01번 콘텐츠.
 *
 *  이름 그대로 난수로 한 권을 뽑는다. 취향을 반영하지 않는 게 이 콘텐츠의 요지다 —
 *  리포트의 나머지 칸이 "당신의 기록이 말하는 취향"이라면, 여기는 그 바깥으로 한 걸음이다.
 *  그래서 후보도 내 서재가 아니라 소설 전체다(useGachaPool).
 *
 *  뽑을 때마다 서버에서 새 묶음을 집어 온다 — 열 때 받아 둔 한 묶음 안에서만 굴리면
 *  "다시 뽑기"를 눌러도 같은 오십 권을 맴돈다. 표지가 도는 동안 그 요청이 끝난다.
 *
 *  다만 뽑고 끝내지 않는다. 뽑힌 책의 장르가 리포트 레이더에서 몇 %인지 붙여서
 *  "이게 내 취향에서 얼마나 먼 자리인지"를 알려 준다. 그래야 랜덤이 그냥 랜덤으로 끝나지 않는다.
 *
 *  돌아가는 표지는 연출일 뿐이고, 당첨은 뽑기를 누른 순간 이미 정해져 있다. */
import { useEffect, useRef, useState } from 'react'
import type { DnaBook } from './dnaTypes'
import { axisOf, type DnaProfile } from './dnaProfile'
import { fetchGachaWindow } from './useGachaPool'
import { coverAtWidth } from '../../lib/coverUrl'
import DnaDialog from './DnaDialog'
import GachaMachine from './GachaMachine'

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
  total,
  failed,
  axes,
  onClose,
}: {
  /** 열 때 받아 둔 묶음 — 돌아가는 표지와, 새 묶음을 못 받았을 때의 폴백 */
  pool: DnaBook[]
  /** 그 나라 소설의 전체 권수 — "소설 N권 가운데"로 적는다 */
  total: number
  /** 후보를 못 받아 왔다 — 기다림과 실패를 다르게 말한다 */
  failed?: boolean
  /** 리포트 레이더 — 뽑힌 책이 취향에서 얼마나 먼지 재는 자 */
  axes: DnaProfile['axes']
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [book, setBook] = useState<DnaBook | null>(null)
  /** 돌아가는 동안 스쳐 보여 줄 표지 */
  const [flash, setFlash] = useState<DnaBook | null>(null)
  const timers = useRef<number[]>([])

  // 뽑는 도중에 닫히면 늦게 도착한 응답이 사라진 화면을 건드리지 않게 한다
  const alive = useRef(true)
  useEffect(() => {
    // StrictMode 는 개발에서 effect 를 두 번 돌린다 — 첫 정리에서 내려간 깃발을 다시 올려야 뽑기가 멈추지 않는다
    alive.current = true
    const ids = timers.current
    return () => {
      alive.current = false
      ids.forEach(clearTimeout)
    }
  }, [])

  const pull = async () => {
    if (phase === 'spinning' || pool.length === 0) return
    setPhase('spinning')
    setBook(null)

    // 표지를 돌리는 동안 새 묶음을 받아 온다 — 실패하면 열 때 받아 둔 묶음으로 뽑는다
    const spun = new Promise<void>((resolve) => window.setTimeout(resolve, SPIN_MS))
    const ids: number[] = []
    for (let t = 0; t < SPIN_MS; t += FRAME_MS) {
      ids.push(window.setTimeout(() => setFlash(pool[Math.floor(Math.random() * pool.length)]), t))
    }
    timers.current.forEach(clearTimeout)
    timers.current = ids

    const fresh = await fetchGachaWindow().then((w) => (w.books.length > 0 ? w.books : pool)).catch(() => pool)
    const won = fresh[Math.floor(Math.random() * fresh.length)]
    await spun
    if (!alive.current) return
    setFlash(null)
    setBook(won)
    setPhase('done')
  }

  const shown = book ?? flash
  const d = book ? distance(book, axes) : null

  return (
    <DnaDialog
      label="완전 랜덤 책 가챠"
      kicker="Random Draw"
      status={
        phase === 'done' ? '뽑기 완료' : phase === 'spinning' ? '뽑는 중' : total > 0 ? `소설 ${total.toLocaleString()}권` : ''
      }
      onClose={onClose}
    >
      <div className="dnar-gacha">
        {phase === 'idle' ? (
          <>
            <p className="dnar-dlg__ask">취향은 잠시 접어 두고, 한 권을 뽑아 볼까요?</p>
            {/* 기계가 곧 버튼이다 — 손잡이를 누르면 뽑힌다 */}
            <GachaMachine onPull={pull} disabled={pool.length === 0} />
            <p className="dnar-gacha__lead">
              {pool.length > 0 ? (
                <>
                  소설 <b>{total.toLocaleString()}권</b> 가운데 어디서든 한 권이 나옵니다.
                  <br />
                  추천이 아니라 우연입니다 — 많이 읽힌 책도, 아무도 안 펼친 책도 확률이 같아요.
                </>
              ) : failed ? (
                '소설 목록을 불러오지 못했어요. 닫았다 다시 열어 주세요.'
              ) : (
                '소설을 한 묶음 꺼내는 중이에요…'
              )}
            </p>
            <button type="button" className="dnar-gacha__pull" onClick={pull} disabled={pool.length === 0}>
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
