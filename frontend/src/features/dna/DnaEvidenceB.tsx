/** 근거 구역 새 안 — 지금 안이 세 패널을 나란히 놓는다면, 여기는 읽는 순서대로 네 단을 쌓는다.
 *
 *  ① 취향의 지도 — 도형 옆에 권수를 붙인다. 지분 100%가 다섯 권인지 백 권인지는 점수만으로 알 수 없다.
 *  ② 독서타입 — 키워드를 타입 칸으로 들인다. 키워드는 타입을 설명하는 재료지 따로 설 칸이 아니다.
 *  ③ 독서 습관 — 줄로 읽는 값 옆에 작은 그림 둘(월별 완독·별점 분포)을 둔다.
 *
 *  지금 안에서 비어 보이던 자리는 여백이 아니라 쓰지 않은 데이터였다. 서버는 이미 다 보내 주고 있다. */
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { DnaBookResponse, DnaScore } from '../../api/dna'
import { tagLabel, useTags } from '../../lib/useTags'
import type { DnaProfile } from './dnaProfile'
import { accentOf } from './spectrum'
import { axisCounts, monthlyFinished, ratingSpread } from './dnaEvidence'
import type { Habit } from './habits'
import Radar from './DnaRadar'

/** 값 안의 % 는 숫자보다 작게 — "13% : 87%" 에서 기호가 숫자와 같은 크기면 기호가 읽기를 막는다 */
function HabitValue({ value }: { value: string }) {
  if (!value.includes('%')) return <>{value}</>
  const parts = value.split('%')
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span className="dnar-habit__unit">%</span>}
        </span>
      ))}
    </>
  )
}

/** 습관 한 줄. 그림 위에 얹히는 줄(.dnar-ev__pair 안)은 CSS 가 규칙선을 지운다 — 그 줄과 그림이 한 덩이라서다 */
function HabitRow({ habit, art }: { habit?: Habit; art: Record<string, ReactNode> }) {
  if (!habit) return null
  return (
    <div className={`dnar-habit${habit.empty ? ' dnar-habit--empty' : ''}`}>
      <svg className="dnar-habit__art" viewBox="0 0 18 18" aria-hidden="true">
        {art[habit.id]}
      </svg>
      <div className="dnar-habit__text">
        <dt className="dnar-habit__label">{habit.label}</dt>
        <dd className="dnar-habit__detail">{habit.detail}</dd>
      </div>
      <span className="dnar-habit__value">
        {habit.to ? (
          <Link className="dnar-habit__go" to={habit.to}>
            <HabitValue value={habit.value} /> <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <HabitValue value={habit.value} />
        )}
      </span>
    </div>
  )
}

export default function DnaEvidenceB({
  profile,
  records,
  habits,
  keywords,
  declaredTags,
  tones,
  habitArt,
}: {
  profile: DnaProfile
  /** 서버 응답 그대로 — 권수·표지·별점·완독일이 여기서 나온다 */
  records: DnaBookResponse[]
  habits: Habit[]
  /** 점수를 가진 원본 키워드 — 칩의 농도를 순서가 아니라 점수로 정한다 */
  keywords: DnaScore[]
  declaredTags: string[]
  tones: string[] | null
  /** 습관 줄의 선 그림 — 지금 안과 같은 표를 쓴다 */
  habitArt: Record<string, ReactNode>
}) {
  const { data: tags } = useTags('GENRE')
  const declared = declaredTags.map((code) => tagLabel(code, tags).replace(/^#/, ''))

  const axes = useMemo(() => axisCounts(records, profile.axes), [records, profile.axes])
  const months = useMemo(() => monthlyFinished(records), [records])
  const stars = useMemo(() => ratingSpread(records), [records])

  const live = axes.filter((a) => a.share > 0)
  const empty = axes.filter((a) => a.share === 0)
  const peakShare = Math.max(...live.map((a) => a.share), 1)
  const monthPeak = Math.max(...months.map((m) => m.count), 1)
  const starPeak = Math.max(...stars, 1)
  const topKeyword = keywords[0]?.score ?? 0
  // 한 화면에 강조색 하나 — 표지에서 가장 선명한 색을 골라 막대와 레이더가 같은 색을 쓴다
  const accent = accentOf(tones) ?? 'var(--eo-ink)'
  /** 그림과 짝이 있는 두 줄과, 짝이 없어 아래로 내려가는 나머지 */
  const paired = { pace: habits.find((h) => h.id === 'pace'), rating: habits.find((h) => h.id === 'rating') }
  const rest = habits.filter((h) => h.id !== 'pace' && h.id !== 'rating')

  return (
    <>
      {/* 1. 취향의 지도 */}
      <section className="dnar-ev">
        <div className="dnar-sechead">
          <h2 className="dnar-title">취향의 지도</h2>
        </div>
        <div className="dnar-ev__map">
          <Radar axes={profile.axes} tone={accent} />
          <div className="dnar-ev__axes">
            {live.map((a) => (
              <div key={a.label} className="dnar-ev__axis">
                {/* 권수는 라벨 옆에 — 서재에서 센 사실이다. 오른쪽 % 는 AI 축 점수라 권수와 비례하지 않는다
                    (0권인데 5% 가 있을 수 있다). 둘을 한 자리에 붙여 두면 어긋난 값처럼 읽혔다 */}
                <span className="dnar-ev__axis-label">
                  {a.label}
                  {a.count > 0 && <span className="dnar-ev__axis-count">{a.count}권</span>}
                </span>
                <span className="dnar-ev__axis-bar">
                  <span style={{ width: `${(a.share / peakShare) * 100}%`, background: accent }} />
                </span>
                <span className="dnar-ev__axis-value">{a.share}%</span>
              </div>
            ))}
            {/* 0% 축 다섯 줄을 그대로 세우면 지면의 절반이 0 이 된다 — 한 줄로 접는다 */}
            {empty.length > 0 && (
              <p className="dnar-ev__empty">아직 손대지 않은 축 — {empty.map((a) => a.label).join(' · ')}</p>
            )}
            {declared.length > 0 && (
              <p className="dnar-ev__declared">
                <span className="dnar-utility">온보딩에서 고른 관심사</span>
                <b>{declared.join(' · ')}</b>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 2. 독서타입 */}
      <section className="dnar-ev">
        <div className="dnar-sechead">
          <h2 className="dnar-title">당신의 독서타입</h2>
        </div>
        <div className="dnar-ev__type" style={{ ['--tone' as string]: accent }}>
          <div className="dnar-ev__type-main">
            <h3 className="dnar-type__name">{profile.type.name}</h3>
            <p className="dnar-ev__quote">{profile.oneLine}</p>
            <p className="dnar-type__blurb">{profile.type.blurb}</p>
            {profile.type.likes.length > 0 && (
              <ul className="dnar-type__likes">
                {profile.type.likes.map((l) => (
                  <li key={l}>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                      <circle cx="7" cy="7" r="6.2" fill="none" stroke="currentColor" strokeWidth="1" />
                      <path d="M4.2 7.2 6.2 9.2 9.9 5.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {keywords.length > 0 && (
            <div className="dnar-ev__keywords">
              <p className="dnar-utility">자주 읽는 키워드</p>
              <ul className="dnar-keywords">
                {keywords.map((k) => (
                  // 강조를 순서가 아니라 점수로 — 1위의 6할을 넘으면 잉크로 누른다
                  <li key={k.code} className={`dnar-keyword ${k.score >= topKeyword * 0.6 ? 'is-strong' : ''}`}>
                    #{k.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* 3. 독서 습관 — 요약 줄과 그 줄이 요약한 그림을 붙여 둔다 */}
      <section className="dnar-ev">
        <div className="dnar-sechead">
          <div>
            <span className="dnar-eyebrow">Reading Habits</span>
            <h2 className="dnar-title dnar-habits__title">독서 습관</h2>
          </div>
        </div>

        {/* '월 0.8권' 한 줄은 옆 막대 여섯 개를 한마디로 줄인 것이다. 둘을 좌우로 떼어 놓으면
            같은 수라는 걸 아무도 모른다 — 요약을 자기 그림 바로 위에 얹는다. */}
        <div className="dnar-ev__pairs">
          <div className="dnar-ev__pair">
            <HabitRow habit={paired.pace} art={habitArt} />
            <figure className="dnar-ev__chart">
              <div className="dnar-ev__bars">
                {months.map((m) => (
                  <div key={m.label} className="dnar-ev__bar">
                    <span className="dnar-ev__bar-value">{m.count}</span>
                    <span className="dnar-ev__bar-track">
                      <span
                        className="dnar-ev__bar-fill"
                        style={{ height: `${(m.count / monthPeak) * 100}%`, background: accent }}
                      />
                    </span>
                    <span className="dnar-ev__bar-label">{m.label}</span>
                  </div>
                ))}
              </div>
            </figure>
          </div>

          <div className="dnar-ev__pair">
            <HabitRow habit={paired.rating} art={habitArt} />
            <figure className="dnar-ev__chart">
              <div className="dnar-ev__bars">
                {stars.map((count, i) => (
                  <div key={i} className="dnar-ev__bar">
                    <span className="dnar-ev__bar-value">{count}</span>
                    <span className="dnar-ev__bar-track">
                      <span
                        className="dnar-ev__bar-fill"
                        style={{ height: `${(count / starPeak) * 100}%`, background: accent }}
                      />
                    </span>
                    <span className="dnar-ev__bar-label">{i + 1}점</span>
                  </div>
                ))}
              </div>
            </figure>
          </div>
        </div>

        {/* 짝이 없는 줄들 — 그림으로 펼칠 만큼의 분포가 없다. 아래 한 줄 세 칸으로 내려 급을 낮춘다.
            셋은 늘 셋이다(habits.ts) — 표본이 모자라면 값 자리에 「—」가 서고 이유가 붙는다. 줄이 생기고 사라지면
            계정마다 아래쪽 정렬이 달라졌다 */}
        <dl className="dnar-ev__rest">
          {rest.map((h) => (
            <HabitRow key={h.id} habit={h} art={habitArt} />
          ))}
        </dl>
      </section>
    </>
  )
}
