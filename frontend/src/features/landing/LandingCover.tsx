import { useState } from 'react'
import { LANDING_TITLES, useLandingOAuth, useRollingTitles } from './landingShared'

/** 랜딩 시안 C — 편집 일러스트 어휘의 평면 그래픽 한 장. 한 가지 색 판 위에 흰 면과
 *  가는 선만으로 책 한 권을 세우고, 글은 그 옆 여백에 앉힌다. 책은 윗부분만 보이고
 *  아래는 화면 밖으로 잘린다 — 한 권이 지면을 뚫고 서 있는 것처럼. */
const COVER_TITLES = LANDING_TITLES.map((title) => title.replace(/[《》]/g, ''))

/** 판 색 비교 — 로그인 뒤 화면은 전부 종이·잉크라, 랜딩만 색 판을 쓰면 온보딩에서 바로 끊긴다.
 *  확정되면 고른 하나만 남기고 PALETTES 와 전환 UI를 지운다. */
const PALETTES = [
  { key: 'navy', label: '1 남색 판' },
  { key: 'ink', label: '2 종이·잉크 책' },
  { key: 'book', label: '3 종이·남색 책' },
] as const

type Palette = (typeof PALETTES)[number]['key']

/** 책의 꼭짓점. viewBox 좌표를 한 곳에 모아 두고 면·선을 여기서 파생한다 —
 *  면마다 숫자를 따로 적으면 한 점만 옮겨도 이음매가 벌어진다. */
/* 두께(책등 폭)를 표지 폭의 1/10 안쪽으로 둔다 — 더 두꺼우면 책이 아니라 상자로 읽힌다 */
const SPINE_BACK = [122, 118] as const  // 책등 위 뒤쪽
const SPINE_FRONT = [158, 152] as const // 책등 위 앞쪽(앞표지와 만나는 모서리)
const FORE_BACK = [532, 60] as const    // 책배 위 뒤쪽
const FORE_FRONT = [568, 94] as const   // 책배 위 앞쪽
const FOOT = 660                         // 화면 밖으로 잘리는 아래 끝

const pt = ([x, y]: readonly [number, number]) => `${x},${y}`
/** 꼭짓점에서 바로 내려 그은 아래 끝. 따로 적어 두면 위 점만 옮겼을 때 이음매가 벌어진다 */
const foot = ([x]: readonly [number, number]) => `${x},${FOOT}`
const lerp = (a: readonly [number, number], b: readonly [number, number], t: number) =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const

/** 위에서 본 책장 낱장. 책등과 나란한 선을 책배 쪽으로 쌓는다 */
const LEAVES = Array.from({ length: 34 }, (_, i) => {
  const t = (i + 1) / 35
  return { id: i, from: lerp(SPINE_BACK, FORE_BACK, t), to: lerp(SPINE_FRONT, FORE_FRONT, t) }
})

const CSS = `
  /* 판 색은 이 네 변수로만 갈린다 — 구도·비례는 셋이 똑같아야 색만 비교된다.
     --cover-book 은 책의 면, --cover-field 는 바탕이자 면을 가르는 선의 색이다 */
  .landing-cover { --cover-title-h: clamp(52px, 7vw, 96px);
                   position: fixed; inset: 0; overflow: hidden;
                   background: var(--cover-field); color: var(--cover-ink);
                   font-family: var(--eo-font); -webkit-font-smoothing: antialiased; }
  /* 1 — 남색 판에 흰 책 (레퍼런스 그대로) */
  .landing-cover--navy { --cover-field: #244f72; --cover-book: #ffffff; --cover-ink: #ffffff;
                         --cover-rule: rgba(255, 255, 255, 0.5); }
  /* 2 — 종이 판에 잉크 책. 로그인 뒤 화면들과 같은 종이·잉크 */
  .landing-cover--ink { --cover-field: var(--eo-paper); --cover-book: var(--eo-ink);
                        --cover-ink: var(--eo-ink); --cover-rule: var(--eo-rule); }
  /* 3 — 종이 판에 남색 책. 색을 바탕이 아니라 표지가 맡는다 (DESIGN.md) */
  .landing-cover--book { --cover-field: var(--eo-paper); --cover-book: #244f72;
                         --cover-ink: var(--eo-ink); --cover-rule: var(--eo-rule); }

  .landing-cover__top { position: absolute; z-index: 3; inset: 0 0 auto; display: flex; align-items: center;
                        min-height: 54px; padding: 0 var(--eo-frame);
                        border-bottom: 1px solid var(--cover-rule); }
  .landing-cover__mark { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; }

  /* ---- 책. 아래를 화면 밖으로 내보내 윗부분만 남긴다 ---- */
  .landing-cover__art { position: absolute; z-index: 1; right: clamp(-96px, -5vw, -20px); bottom: -14vh;
                        width: min(62vw, 790px); height: auto; pointer-events: none; }
  .landing-cover__plane { fill: var(--cover-book); }
  /* 면을 가르는 선과 책장 낱장은 바탕색으로 긋는다 — 면에 색을 더하지 않고 덜어낸다 */
  .landing-cover__seam { stroke: var(--cover-field); stroke-width: 2.4; fill: none; }
  .landing-cover__leaf { stroke: var(--cover-field); stroke-width: 1.6; opacity: 0.62; }

  /* ---- 글 ---- */
  .landing-cover__sheet { position: relative; z-index: 2; display: flex; height: 100%; align-items: center;
                          padding: 54px var(--eo-frame) 0; }
  .landing-cover__copy { width: min(52%, 640px); }
  .landing-cover__line { display: block; font-size: clamp(19px, 2.5vw, 34px); font-weight: 400;
                         line-height: 1.3; letter-spacing: -0.045em; opacity: 0.88; }
  /* 지면에서 가장 큰 글자는 책 제목이다 */
  .landing-cover__window { display: block; height: var(--cover-title-h); margin: clamp(4px, 0.8vw, 10px) 0;
                           overflow: hidden; }
  .landing-cover__window ul { list-style: none; margin: 0; padding: 0; will-change: transform;
                              transition: transform 0.65s cubic-bezier(0.72, -0.02, 0.16, 1); }
  .landing-cover__window li { display: flex; height: var(--cover-title-h); align-items: center;
                              font-size: clamp(36px, 5.6vw, 82px); font-weight: 700; line-height: 1;
                              letter-spacing: -0.06em; white-space: nowrap; }

  .landing-cover__cta { margin-top: clamp(22px, 3.4vw, 42px); }
  .landing-cover__buttons { display: flex; flex-wrap: wrap; gap: 10px; max-width: 460px; }
  .landing-cover__oauth { display: inline-flex; flex: 1 1 190px; align-items: center; justify-content: center;
                          gap: 8px; min-height: 46px; padding: 0 18px; border-radius: 0; cursor: pointer;
                          font: inherit; font-size: 13px; font-weight: 700; letter-spacing: -0.02em;
                          transition: opacity 0.16s ease, transform 0.16s ease; }
  .landing-cover__oauth:hover, .landing-cover__oauth:focus-visible { opacity: 0.78; transform: translateY(-1px); }
  .landing-cover__oauth--kakao { border: 1px solid #fee500; background: #fee500; color: #191919; }
  .landing-cover__oauth--google { border: 1px solid var(--cover-rule); background: transparent;
                                  color: var(--cover-ink); }
  .landing-cover__oauth svg { display: block; flex: none; width: 17px; height: 17px; }
  .landing-cover__hint { display: block; margin-top: 11px; font-size: 11px; letter-spacing: -0.01em;
                         opacity: 0.6; }
  .landing-cover :focus-visible { outline: 2px solid var(--cover-ink); outline-offset: 3px; }

  /* 좁은 화면에서는 글을 위로, 책을 아래로 — 나란히 두면 둘 다 좁아진다 */
  @media (max-width: 880px) {
    .landing-cover__sheet { align-items: flex-start; padding-top: clamp(76px, 13vh, 132px); }
    .landing-cover__copy { width: 100%; }
    .landing-cover__art { right: 50%; bottom: -8vh; width: min(104vw, 520px); transform: translateX(50%); }
    .landing-cover__buttons { max-width: 340px; }
  }
  @media (max-width: 880px) and (max-height: 720px) {
    .landing-cover__art { opacity: 0.32; }
  }
  @media (prefers-reduced-motion: reduce) { .landing-cover__window ul { transition: none; } }
`

/** 카카오톡 말풍선 — 카카오 로그인 버튼 규정의 심벌. 버튼 글자색을 따라간다 */
function KakaoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 3C6.48 3 2 6.54 2 10.91c0 2.79 1.84 5.24 4.61 6.64l-1.17 4.3c-.1.38.32.68.65.46l5.13-3.39c.25.02.51.03.78.03 5.52 0 10-3.54 10-7.91S17.52 3 12 3z" />
    </svg>
  )
}

/** Google G — 구글 브랜드 규정상 네 가지 색과 형태를 바꾸지 않고 그대로 쓴다 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#ea4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285f4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#fbbc05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34a853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export default function LandingCover() {
  const { oauth, oauthFailed } = useLandingOAuth()
  const ulRef = useRollingTitles('var(--cover-title-h)')
  const [palette, setPalette] = useState<Palette>('navy')

  return (
    <div className={`landing-cover landing-cover--${palette}`}>
      <style>{CSS}</style>
      <header className="landing-cover__top">
        <span className="landing-cover__mark">책추책책추</span>
      </header>

      <svg className="landing-cover__art" viewBox={`0 0 620 ${FOOT}`} aria-hidden="true" focusable="false">
        {/* 그림자는 두지 않는다 — 바닥이 화면 밖이라 그림자가 놓일 자리가 없고,
            책등 옆에 붙이면 책의 또 다른 면처럼 읽힌다 */}
        {/* 책등 */}
        <polygon className="landing-cover__plane"
          points={`${pt(SPINE_BACK)} ${pt(SPINE_FRONT)} ${foot(SPINE_FRONT)} ${foot(SPINE_BACK)}`} />
        {/* 앞표지 */}
        <polygon className="landing-cover__plane"
          points={`${pt(SPINE_FRONT)} ${pt(FORE_FRONT)} ${foot(FORE_FRONT)} ${foot(SPINE_FRONT)}`} />
        {/* 위에서 본 책장 단면 */}
        <polygon className="landing-cover__plane"
          points={`${pt(SPINE_BACK)} ${pt(FORE_BACK)} ${pt(FORE_FRONT)} ${pt(SPINE_FRONT)}`} />
        {LEAVES.map((leaf) => (
          <line key={leaf.id} className="landing-cover__leaf"
            x1={leaf.from[0]} y1={leaf.from[1]} x2={leaf.to[0]} y2={leaf.to[1]} />
        ))}
        {/* 책등과 앞표지가 만나는 모서리 */}
        <polyline className="landing-cover__seam"
          points={`${pt(SPINE_BACK)} ${pt(SPINE_FRONT)} ${foot(SPINE_FRONT)}`} />
      </svg>

      <div className="landing-cover__sheet">
        <div className="landing-cover__copy">
          <h1>
            <span className="landing-cover__line">당신의 다음 한 권은</span>
            <span className="landing-cover__window">
              <ul ref={ulRef}>
                {[...COVER_TITLES, COVER_TITLES[0]].map((title, index) => <li key={index}>{title}</li>)}
              </ul>
            </span>
            <span className="landing-cover__line">일지도 몰라요.</span>
          </h1>
          <div className="landing-cover__cta">
            <div className="landing-cover__buttons">
              <button className="landing-cover__oauth landing-cover__oauth--kakao" onClick={() => oauth('kakao')}>
                <KakaoMark /> 카카오로 시작하기
              </button>
              <button className="landing-cover__oauth landing-cover__oauth--google" onClick={() => oauth('google')}>
                <GoogleMark /> Google로 시작하기
              </button>
            </div>
            <span className="landing-cover__hint">
              {oauthFailed ? '로그인이 중간에 끊겼어요 — 다시 시도해 주세요' : '읽은 책 몇 권이면 충분해요 · 가입과 로그인이 한 번에'}
            </span>
          </div>
        </div>
      </div>

      {/* 판 색 비교는 시안 전환과 같은 팀용 도구다. 시안 줄은 오른쪽에 있으니 왼쪽에 둔다 —
          같은 쪽에 쌓으면 로그인 버튼을 가려 눌러 볼 수가 없다 */}
      <div className="eo-panel fixed bottom-5 left-4 z-40 flex items-center gap-4 px-3.5 py-2 sm:left-7">
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">판</span>
        {PALETTES.map((p) => (
          <button key={p.key} onClick={() => setPalette(p.key)} aria-pressed={palette === p.key}
            className={`border-b-2 pb-0.5 text-[11px] transition-colors duration-150 ${
              palette === p.key ? 'border-ink font-bold text-ink' : 'border-transparent text-ink-faint hover:text-ink'
            }`}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
