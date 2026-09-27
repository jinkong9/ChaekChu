/** 책 이상형 월드컵 — BOOK DNA 리포트의 02번 콘텐츠.
 *
 *  두 권의 소개문만 나란히 놓고 "지금 더 읽고 싶은 쪽"을 고르게 한다. 제목·저자·표지는 끝까지 감춘다 —
 *  표지와 이름값을 걷어낸 채로 고르면 무엇이 남는지 보는 게 이 콘텐츠의 요지다.
 *  16강 → 8강 → 준결승 → 결승, 15번 고르면 우승 책의 정체가 처음 공개된다.
 *
 *  후보는 내 서재가 아니라 대출 상위 요약 풀(약 500권)에서 서버가 편성한다(BOOK_DNA_API_CONTRACT §8).
 *  대진표도 서버가 든다 — 화면은 세션 응답을 그대로 보여 주고, 고른 choiceId 를 돌려보내기만 한다. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createWorldCupSession,
  isWorldCupSessionGone,
  isWorldCupUnavailable,
  pickWorldCup,
  type WorldCupSession,
} from '../../api/dna'
import { toDnaBook } from './gachaDraw'
import { axisOf } from './dnaProfile'
import DnaDialog from './DnaDialog'
import ShelfActions from '../../components/ShelfActions'
import ResultCover from './ResultCover'
import { useMyShelfEntry } from '../../lib/useMyShelfEntry'

const ROUND_LABEL: Record<number, string> = { 16: '16강', 8: '8강', 4: '준결승', 2: '결승' }

/** 지금 라운드의 인원 — 16강 1라운드, 8강 2라운드… */
const participantsOf = (s: WorldCupSession) => s.roundSize >> (s.roundNumber - 1)

type Phase = 'idle' | 'loading' | 'playing' | 'done'

/** 모서리 장식 — 네 갈래 별. 이름 없는 책 두 권이 뒤집어 놓은 카드처럼 보이게 한다 */
const CORNERS = ['tl', 'tr', 'bl', 'br'] as const
function Star() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z" />
    </svg>
  )
}

function Synopsis({
  text,
  numeral,
  side,
  disabled,
  onPick,
}: {
  text: string
  /** 카드 윗머리의 번호 — 타로 카드의 로마 숫자 자리 */
  numeral: string
  side: string
  disabled: boolean
  onPick: () => void
}) {
  return (
    <button type="button" className="dnar-wc__synopsis" onClick={onPick} disabled={disabled}>
      {/* 안쪽 이중 테두리와 네 모서리 별 — 장식이라 읽지 않는다 */}
      <span className="dnar-wc__frame" aria-hidden="true">
        {CORNERS.map((c) => (
          <span key={c} className={`dnar-wc__corner dnar-wc__corner--${c}`}>
            <Star />
          </span>
        ))}
      </span>
      <span className="dnar-wc__numeral" aria-hidden="true">{numeral}</span>
      <span className="dnar-wc__synopsis-text">{text}</span>
      <span className="dnar-wc__pick-key" aria-hidden="true">{side}</span>
    </button>
  )
}

export default function BookWorldCup({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [session, setSession] = useState<WorldCupSession | null>(null)
  /** 고른 쪽을 서버에 보내는 중 — 응답 전에는 두 카드를 잠근다 */
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 요청 중에 닫히면 늦게 온 응답이 사라진 화면을 건드리지 않게 한다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const begin = useCallback(async () => {
    setPhase('loading')
    setError(null)
    setSession(null)
    try {
      const s = await createWorldCupSession()
      if (!alive.current) return
      setSession(s)
      setPhase(s.status === 'COMPLETED' ? 'done' : 'playing')
    } catch (err) {
      if (!alive.current) return
      setError(
        isWorldCupUnavailable(err)
          ? '월드컵에 낼 책이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.'
          : '대진표를 짜지 못했어요. 다시 시작해 주세요.',
      )
      setPhase('idle')
    }
  }, [])

  const pick = useCallback(
    async (choiceId: string) => {
      if (!session || picking || phase !== 'playing') return
      setPicking(true)
      setError(null)
      try {
        const next = await pickWorldCup(session.sessionId, choiceId)
        if (!alive.current) return
        setSession(next)
        if (next.status === 'COMPLETED') setPhase('done')
      } catch (err) {
        if (!alive.current) return
        if (isWorldCupSessionGone(err)) {
          // 24시간이 지났거나 세션이 사라졌다 — 이어 갈 수 없으니 처음으로
          setSession(null)
          setPhase('idle')
          setError('세션이 끝났어요. 처음부터 다시 시작해 주세요.')
        } else {
          setError('선택이 전달되지 않았어요. 다시 골라 주세요.')
        }
      } finally {
        if (alive.current) setPicking(false)
      }
    },
    [session, picking, phase],
  )

  const [left, right] = session?.choices ?? []

  // 좌우 방향키로 고른다 — 카드를 겨냥하지 않아도 빠르게 넘길 수 있다
  useEffect(() => {
    if (phase !== 'playing' || !left || !right) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') pick(left.choiceId)
      else if (e.key === 'ArrowRight') pick(right.choiceId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, left, right, pick])

  const champion = phase === 'done' && session?.champion ? toDnaBook(session.champion) : null
  /** 우승 책이 내 서재에 어떻게 있는지 — 대출 상위 풀이라 이미 읽은 책이 나오는 일이 잦다 */
  const my = useMyShelfEntry(champion?.bookId)
  /** 라운드 진행 — 우상단 구석이 아니라 질문 바로 위에 크게. 몇 강 몇 번째인지가 이 화면의 시간이다 */
  const progress =
    phase === 'playing' && session
      ? `${ROUND_LABEL[participantsOf(session)] ?? `${participantsOf(session)}강`} · ${session.matchNumber} / ${session.matchesInRound}`
      : null

  return (
    <DnaDialog label="책 이상형 월드컵" kicker="Book World Cup" status={phase === 'done' ? '우승' : ''} onClose={onClose}>
      {phase === 'idle' || phase === 'loading' ? (
        <div className="dnar-wc__result">
          <p className="dnar-dlg__ask">소개만 읽고, 한 권</p>
          <p className="dnar-wc__verdict">
            표지와 제목은 우승이 정해질 때 공개돼요.
            <br />
            16권이 맞붙어 15번의 선택이 남아요.
          </p>
          {error && <p className="dnar-wc__error" role="status">{error}</p>}
          <div className="dnar-dlg__actions">
            <button type="button" className="dnar-dlg__button" onClick={begin} disabled={phase === 'loading'}>
              {phase === 'loading' ? '대진표를 짜는 중' : '시작하기'}
            </button>
            <button type="button" className="dnar-dlg__close" onClick={onClose}>닫기</button>
          </div>
        </div>
      ) : phase === 'done' && champion ? (
        <div className="dnar-wc__result">
          <h2 className="dnar-wc__crown">당신의 한 권</h2>
          {/* 표지는 상세로 가는 문 — 올리면 살짝 열리고, 누르면 그 책으로 */}
          {champion.coverUrl && <ResultCover book={champion} width={300} className="dnar-wc__champion" />}
          <p className="dnar-wc__champion-title">{champion.title}</p>
          <p className="dnar-wc__champion-meta">
            {champion.author && `${champion.author} · `}{axisOf(champion.classNo)}
          </p>
          <p className="dnar-wc__verdict">
            {(session?.roundSize ?? 16) - 1}번의 선택 끝에 남은 책이에요.
            <br />
            제목도 표지도 모른 채 소개문만으로 고른 결과입니다.
          </p>
          {/* 우승으로 끝내지 않는다 — 상세 화면과 같은 버튼 한 벌로 그 자리에서 서재에 올린다 */}
          {champion.bookId && (
            <ShelfActions className="dnar-shelf" bookId={champion.bookId} title={champion.title} my={my} eventContext="DNA" />
          )}
          <div className="dnar-dlg__actions">
            <button type="button" className="dnar-dlg__button" onClick={begin}>다시 하기</button>
            <button type="button" className="dnar-dlg__close" onClick={onClose}>닫기</button>
          </div>
        </div>
      ) : (
        // 질문·카드·안내를 한 덩어리로 묶어 가운데 세운다 — 질문만 위에 붙고 카드가 가운데 떠 있으면 둘 사이가 빈 벌판이 된다
        <div className="dnar-wc__stage">
          <div className="dnar-wc__head">
            {progress && <p className="dnar-wc__round" role="status">{progress}</p>}
            <p className="dnar-dlg__ask">지금 더 읽고 싶은 쪽은?</p>
          </div>
          <div className="dnar-wc__match dnar-wc__match--text">
            {left && <Synopsis text={left.synopsis} numeral="I" side="←" disabled={picking} onPick={() => pick(left.choiceId)} />}
            <span className="dnar-wc__vs" aria-hidden="true">VS</span>
            {right && <Synopsis text={right.synopsis} numeral="II" side="→" disabled={picking} onPick={() => pick(right.choiceId)} />}
          </div>
          {error ? (
            <p className="dnar-wc__error" role="status">{error}</p>
          ) : (
            <p className="dnar-utility dnar-dlg__hint">카드를 누르거나 방향키로 고르세요 · Esc로 닫기</p>
          )}
        </div>
      )}
    </DnaDialog>
  )
}
