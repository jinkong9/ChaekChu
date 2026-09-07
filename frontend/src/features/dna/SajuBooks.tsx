/** 사주 기반 책 추천 — BOOK DNA 리포트의 03번 콘텐츠.
 *
 *  생년월일 → 일주(60갑자) → 일간의 오행 → 그 오행에 붙인 장르 → 그 장르의 책 3권.
 *
 *  계산과 해석의 경계를 화면에서도 지킨다: 일주와 오행은 역법 계산이라 "이 날의 일주는
 *  갑자"라고 단정해도 되지만, 오행에서 장르로 넘어가는 대목은 우리 쪽 해석이므로
 *  그렇게 밝히고 보여 준다(saju.ts 머리말 참고). 운세를 예측하지 않는다.
 *
 *  이 콘텐츠만 근거의 종류가 다르다 — 옆 칸은 완독 기록 집계다. 그래서 카드와 화면 양쪽에
 *  재미 콘텐츠임을 적어 리포트 전체의 신뢰와 섞이지 않게 한다. */
import { useMemo, useState } from 'react'
import type { DnaBook } from './useDnaMockData'
import { axisOf } from './dnaProfile'
import { sajuDay, ELEMENT_READING } from './saju'
import { coverAtWidth } from '../../lib/coverUrl'
import DnaDialog from './DnaDialog'

const PICKS = 3
const COVER_W = 150

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function SajuBooks({ pool, onClose }: { pool: DnaBook[]; onClose: () => void }) {
  /** input[type=date]의 값 그대로 — "YYYY-MM-DD" */
  const [birth, setBirth] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  /** 다시 뽑을 때 같은 생일에서도 다른 세 권이 나오게 하는 값 */
  const [reroll, setReroll] = useState(0)

  const today = new Date().toISOString().slice(0, 10)

  const result = useMemo(() => {
    if (!submitted) return null
    const [y, m, d] = submitted.split('-').map(Number)
    const day = sajuDay(y, m, d)
    const reading = ELEMENT_READING[day.element]
    // 첫 장르에 책이 없으면 두 번째로 — mock 풀은 장르가 고르지 않다
    const [primary, secondary] = reading.axes
    const of = (axis: string) => pool.filter((b) => axisOf(b.classNo) === axis)
    const candidates = of(primary).length >= PICKS ? of(primary) : [...of(primary), ...of(secondary)]
    const usedAxis = of(primary).length >= PICKS ? primary : `${primary}·${secondary}`
    return { day, reading, usedAxis, books: shuffled(candidates).slice(0, PICKS) }
    // reroll이 바뀌면 같은 생일이라도 책을 다시 섞는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, pool, reroll])

  return (
    <DnaDialog
      label="사주 기반 책 추천"
      kicker="Saju Reading"
      status={result ? `일주 ${result.day.pillar} · ${result.day.element}` : '재미로 보는 콘텐츠'}
      onClose={onClose}
    >
      <div className="dnar-saju">
        {!result ? (
          <form
            className="dnar-saju__form"
            onSubmit={(e) => {
              e.preventDefault()
              if (birth) setSubmitted(birth)
            }}
          >
            <p className="dnar-dlg__ask">생년월일을 알려 주세요.</p>
            <p className="dnar-saju__lead">
              생년월일로 그날의 <b>일주(日柱)</b>를 세고, 일간의 <b>오행</b>에 맞는 장르에서 책을 고릅니다.
              <br />
              태어난 시간은 받지 않습니다 — 일주는 날짜만으로 정해집니다.
            </p>
            <label className="dnar-saju__field">
              <span className="dnar-utility">생년월일</span>
              <input
                type="date"
                value={birth}
                max={today}
                min="1900-01-01"
                required
                onChange={(e) => setBirth(e.target.value)}
              />
            </label>
            <button type="submit" className="dnar-saju__submit" disabled={!birth}>
              책 받기
            </button>
            <p className="dnar-utility dnar-saju__disclaimer">
              일주·오행은 역법 계산이지만, 오행에서 장르로 잇는 부분은 이 서비스의 해석입니다.
              운세를 예측하지 않습니다.
            </p>
          </form>
        ) : (
          <div className="dnar-saju__result">
            <p className="dnar-saju__pillar">
              <b>{result.day.pillar}</b>일 · 일간 {result.day.gan}({result.day.element})
            </p>
            <p className="dnar-saju__nature">
              {result.day.element}은 <b>{result.reading.nature}</b>. {result.reading.advice}
            </p>
            <p className="dnar-saju__bridge dnar-utility">
              그래서 <b>{result.usedAxis}</b>에서 골랐습니다 — 이 연결은 이 서비스의 해석입니다.
            </p>

            <ul className="dnar-saju__books">
              {result.books.map((b) => (
                <li key={b.isbn13}>
                  <img
                    src={coverAtWidth(b.coverUrl, COVER_W) ?? b.coverUrl}
                    alt=""
                    width={COVER_W}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="dnar-saju__book-title">{b.title}</span>
                  <span className="dnar-saju__book-meta">{b.author}</span>
                </li>
              ))}
            </ul>

            <div className="dnar-dlg__actions">
              <button type="button" className="dnar-dlg__button" onClick={() => setReroll((n) => n + 1)}>
                다른 책 보기
              </button>
              <button
                type="button"
                className="dnar-dlg__button"
                onClick={() => {
                  setSubmitted(null)
                  setBirth('')
                }}
              >
                생년월일 다시 입력
              </button>
              <button type="button" className="dnar-dlg__close" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </DnaDialog>
  )
}
