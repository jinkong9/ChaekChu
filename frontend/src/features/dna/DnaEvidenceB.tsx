/** 근거 구역 새 안 — 지금 안이 세 패널을 나란히 놓는다면, 여기는 읽는 순서대로 네 단을 쌓는다.
 *
 *  ① 취향의 지도 — 도형 옆에 권수를 붙인다. 지분 100%가 다섯 권인지 백 권인지는 점수만으로 알 수 없다.
 *  ② 독서타입 — 키워드를 타입 칸으로 들인다. 키워드는 타입을 설명하는 재료지 따로 설 칸이 아니다.
 *  ③ 독서 습관 — 줄로 읽는 값 옆에 작은 그림 둘(월별 완독·별점 분포)을 둔다.
 *  ④ 읽은 책 — 표지를 깐다. "완독 N권"이라는 말의 근거가 눈에 보이는 자리다.
 *
 *  지금 안에서 비어 보이던 자리는 여백이 아니라 쓰지 않은 데이터였다. 서버는 이미 다 보내 주고 있다. */
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { DnaBookResponse, DnaScore } from '../../api/dna'
import { tagLabel, useTags } from '../../lib/useTags'
import { coverAtWidth } from '../../lib/coverUrl'
import type { DnaProfile } from './dnaProfile'
import { axisCounts, monthlyFinished, ratingSpread, readCovers, topAuthors } from './dnaEvidence'
import type { Habit } from './habits'
import Radar from './DnaRadar'

/** 표지 벽에 까는 최대 장수 — 이보다 많으면 지면이 표지에 먹힌다 */
const WALL_LIMIT = 42
const WALL_COVER_W = 68

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
  const authors = useMemo(() => topAuthors(records), [records])
  const covers = useMemo(() => readCovers(records, WALL_LIMIT), [records])

  const live = axes.filter((a) => a.share > 0)
  const empty = axes.filter((a) => a.share === 0)
  const peakShare = Math.max(...live.map((a) => a.share), 1)
  const monthPeak = Math.max(...months.map((m) => m.count), 1)
  const starPeak = Math.max(...stars, 1)
  const topKeyword = keywords[0]?.score ?? 0

  return (
    <>
      {/* 1. 취향의 지도 */}
      <section className="dnar-ev">
        <div className="dnar-sechead">
          <h2 className="dnar-title">취향의 지도</h2>
        </div>
        <div className="dnar-ev__map">
          <Radar axes={profile.axes} tone={tones?.[0]} />
          <div className="dnar-ev__axes">
            {live.map((a, i) => (
              <div key={a.label} className="dnar-ev__axis">
                <span className="dnar-ev__axis-label">{a.label}</span>
                <span className="dnar-ev__axis-bar">
                  <span style={{ width: `${(a.share / peakShare) * 100}%`, background: tones?.[i] ?? 'var(--eo-ink)' }} />
                </span>
                <span className="dnar-ev__axis-value">
                  {a.count > 0 && <b>{a.count}권</b>} {a.share}%
                </span>
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
        <div className="dnar-ev__type" style={{ ['--tone' as string]: tones?.[0] ?? undefined }}>
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

      {/* 3. 독서 습관 */}
      <section className="dnar-ev">
        <div className="dnar-sechead">
          <div>
            <span className="dnar-eyebrow">Reading Habits</span>
            <h2 className="dnar-title dnar-habits__title">독서 습관</h2>
          </div>
        </div>
        <div className="dnar-ev__habits">
          <dl className="dnar-ev__habit-list">
            {habits.map((h) => (
              <div key={h.id} className="dnar-habit">
                <svg className="dnar-habit__art" viewBox="0 0 18 18" aria-hidden="true">
                  {habitArt[h.id]}
                </svg>
                <div className="dnar-habit__text">
                  <dt className="dnar-habit__label">{h.label}</dt>
                  <dd className="dnar-habit__detail">{h.detail}</dd>
                </div>
                <span className="dnar-habit__value">{h.value}</span>
              </div>
            ))}
          </dl>

          <div className="dnar-ev__charts">
            {/* 월별 완독 — '읽는 속도'가 숫자로만 있던 것을 그림으로 */}
            <figure className="dnar-ev__chart">
              <figcaption className="dnar-utility">최근 6개월 완독</figcaption>
              <div className="dnar-ev__bars">
                {months.map((m) => (
                  <div key={m.label} className="dnar-ev__bar">
                    <span className="dnar-ev__bar-value">{m.count}</span>
                    <span className="dnar-ev__bar-track">
                      <span
                        className="dnar-ev__bar-fill"
                        style={{ height: `${(m.count / monthPeak) * 100}%`, background: tones?.[1] ?? 'var(--eo-ink)' }}
                      />
                    </span>
                    <span className="dnar-ev__bar-label">{m.label}</span>
                  </div>
                ))}
              </div>
            </figure>

            {/* 별점 분포 — '무던한 편'이라는 말의 근거 */}
            <figure className="dnar-ev__chart">
              <figcaption className="dnar-utility">별점 분포</figcaption>
              <div className="dnar-ev__bars">
                {stars.map((count, i) => (
                  <div key={i} className="dnar-ev__bar">
                    <span className="dnar-ev__bar-value">{count}</span>
                    <span className="dnar-ev__bar-track">
                      <span
                        className="dnar-ev__bar-fill"
                        style={{ height: `${(count / starPeak) * 100}%`, background: tones?.[3] ?? 'var(--eo-ink)' }}
                      />
                    </span>
                    <span className="dnar-ev__bar-label">{i + 1}점</span>
                  </div>
                ))}
              </div>
            </figure>
          </div>
        </div>

        {authors.length > 0 && (
          <div className="dnar-ev__authors">
            <span className="dnar-utility">다시 찾은 작가</span>
            <ul>
              {authors.map((a) => (
                <li key={a.name}>
                  {a.name} <b>{a.count}권</b>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 4. 이 리포트를 만든 책들 */}
      {covers.length > 0 && (
        <section className="dnar-ev">
          <div className="dnar-sechead">
            <h2 className="dnar-title">이 리포트를 만든 책들</h2>
          </div>
          <ul className="dnar-ev__wall">
            {covers.map((c) => (
              <li key={c.bookId}>
                <Link to={`/books/${c.bookId}`} title={c.title}>
                  <img src={coverAtWidth(c.coverUrl, WALL_COVER_W) ?? c.coverUrl} alt={c.title} loading="lazy" decoding="async" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
