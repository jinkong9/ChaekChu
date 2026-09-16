import { useState } from 'react'
import { LANDING_TITLES, useLandingOAuth, useRollingTitles } from './landingShared'

/** 랜딩 시안 B — 왼쪽은 글과 로그인(C의 지면), 오른쪽은 선반에서 한 권을 꺼내는
 *  독자 일러스트(D의 히어로 그림). 둘 다 종이·잉크라 한 지면으로 붙는다.
 *  지면에서 가장 큰 글자는 책 제목이다. */
const READER_TITLES = LANDING_TITLES.map((title) => title.replace(/[《》]/g, ''))

const ILLUSTRATIONS = [
  {
    src: '/images/landing-shelf-reader.png',
    label: '1 선반',
    alt: '책이 가득한 선반에서 한 권을 꺼내는 독자',
    eyebrow: 'YOUR SHELF KNOWS',
    caption: '다음 한 권을 꺼내 보세요',
  },
  {
    src: '/images/landing-reader-floating-books.png',
    label: '2 책 사이로',
    alt: '여러 권의 책 사이를 유영하며 한 권을 향해 손을 뻗는 독자',
    eyebrow: 'BETWEEN THE BOOKS',
    caption: '수많은 책 사이, 당신의 한 권',
  },
  {
    src: '/images/landing-reader-taste-thread.png',
    label: '4 취향의 실',
    alt: '독자의 취향을 나타내는 실이 여러 책을 지나 한 권의 펼친 책으로 이어지는 모습',
    eyebrow: 'FOLLOW YOUR TASTE',
    caption: '취향을 따라 발견한 다음 한 권',
  },
] as const

const CSS = `
  .landing-reader { --reader-ink: var(--eo-ink); --reader-muted: var(--eo-ink-muted);
                    --reader-title-h: clamp(52px, 7vw, 96px);
                    position: fixed; inset: 0; overflow: hidden;
                    background: var(--eo-paper); color: var(--reader-ink);
                    font-family: var(--eo-font); -webkit-font-smoothing: antialiased; }

  .landing-reader__top { position: absolute; z-index: 3; inset: 0 0 auto; display: flex; align-items: center;
                         min-height: 54px; padding: 0 var(--eo-frame);
                         border-bottom: 1px solid var(--eo-rule-soft); }
  .landing-reader__mark { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; }

  /* 글과 그림을 한 줄에 놓는다. 그림 쪽을 넓게 잡아 선반이 잘리지 않게 한다 */
  .landing-reader__sheet { display: grid; height: 100%; align-items: center;
                           grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
                           gap: clamp(24px, 4vw, 64px);
                           padding: 54px var(--eo-frame) 0; }

  /* ---- 왼쪽: 글과 로그인 ---- */
  .landing-reader__copy { min-width: 0; }
  .landing-reader__line { display: block; font-size: clamp(19px, 2.5vw, 34px); font-weight: 400;
                          line-height: 1.3; letter-spacing: -0.045em; opacity: 0.88; }
  .landing-reader__window { display: block; height: var(--reader-title-h); margin: clamp(4px, 0.8vw, 10px) 0;
                            overflow: hidden; }
  .landing-reader__window ul { list-style: none; margin: 0; padding: 0; will-change: transform;
                               transition: transform 0.65s cubic-bezier(0.72, -0.02, 0.16, 1); }
  .landing-reader__window li { display: flex; height: var(--reader-title-h); align-items: center;
                               font-size: clamp(36px, 5.6vw, 82px); font-weight: 700; line-height: 1;
                               letter-spacing: -0.06em; white-space: nowrap; }

  .landing-reader__cta { margin-top: clamp(22px, 3.4vw, 42px); }
  .landing-reader__buttons { display: flex; flex-wrap: wrap; gap: 10px; max-width: 460px; }
  .landing-reader__oauth { display: inline-flex; flex: 1 1 190px; align-items: center; justify-content: center;
                           gap: 8px; min-height: 46px; padding: 0 18px; border-radius: 0; cursor: pointer;
                           font: inherit; font-size: 13px; font-weight: 700; letter-spacing: -0.02em;
                           transition: opacity 0.16s ease, transform 0.16s ease; }
  .landing-reader__oauth:hover, .landing-reader__oauth:focus-visible { opacity: 0.78; transform: translateY(-1px); }
  .landing-reader__oauth--kakao { border: 1px solid #fee500; background: #fee500; color: #191919; }
  .landing-reader__oauth--google { border: 1px solid var(--eo-rule); background: transparent;
                                   color: var(--reader-ink); }
  .landing-reader__oauth svg { display: block; flex: none; width: 17px; height: 17px; }
  .landing-reader__hint { display: block; margin-top: 11px; color: var(--reader-muted);
                          font-size: 11px; letter-spacing: -0.01em; }
  .landing-reader :focus-visible { outline: 2px solid var(--reader-ink); outline-offset: 3px; }

  /* ---- 오른쪽: 독자 일러스트 ---- */
  .landing-reader__art { position: relative; min-width: 0; aspect-ratio: 1.42; isolation: isolate; }
  /* 그림이 종이에서 떠 보이지 않게 아주 옅은 바닥 그늘만 깐다 */
  .landing-reader__art::before { content: ''; position: absolute; z-index: -1; inset: 9% 4% 5% 7%;
                                 background: radial-gradient(ellipse at 48% 48%, rgba(11, 11, 11, 0.055), transparent 66%);
                                 filter: blur(18px); }
  .landing-reader__art img { position: absolute; inset: 0 -6% auto -8%; width: 114%; height: 100%;
                             object-fit: contain; }
  .landing-reader__caption { position: absolute; z-index: 2; right: 0; bottom: 2%; margin: 0;
                             display: grid; gap: 3px; padding: 10px 13px; font-size: 9px;
                             background: rgba(253, 253, 251, 0.94); border-left: 1px solid var(--reader-ink); }
  .landing-reader__caption span { color: var(--reader-muted); letter-spacing: 0.08em; }
  .landing-reader__caption b { font-size: 11px; }

  /* 좁은 화면에서는 글이 위, 그림이 아래 — 나란히 두면 둘 다 좁아진다 */
  @media (max-width: 880px) {
    .landing-reader__sheet { grid-template-columns: 1fr; align-content: center; gap: clamp(18px, 4vh, 36px);
                             padding-top: clamp(70px, 11vh, 110px); }
    .landing-reader__art { aspect-ratio: 1.32; }
    .landing-reader__buttons { max-width: 340px; }
  }
  @media (max-width: 880px) and (max-height: 700px) {
    .landing-reader__art { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .landing-reader__window ul { transition: none; } }
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

export default function LandingReader() {
  const { oauth, oauthFailed } = useLandingOAuth()
  const ulRef = useRollingTitles('var(--reader-title-h)')
  const [illustrationIndex, setIllustrationIndex] = useState(0)
  const illustration = ILLUSTRATIONS[illustrationIndex]

  return (
    <div className="landing-reader">
      <style>{CSS}</style>
      <header className="landing-reader__top">
        <span className="landing-reader__mark">책추책책추</span>
      </header>

      <div className="landing-reader__sheet">
        <div className="landing-reader__copy">
          <h1>
            <span className="landing-reader__line">당신의 다음 한 권은</span>
            <span className="landing-reader__window">
              <ul ref={ulRef}>
                {[...READER_TITLES, READER_TITLES[0]].map((title, index) => <li key={index}>{title}</li>)}
              </ul>
            </span>
            <span className="landing-reader__line">일지도 몰라요.</span>
          </h1>
          <div className="landing-reader__cta">
            <div className="landing-reader__buttons">
              <button className="landing-reader__oauth landing-reader__oauth--kakao" onClick={() => oauth('kakao')}>
                <KakaoMark /> 카카오로 시작하기
              </button>
              <button className="landing-reader__oauth landing-reader__oauth--google" onClick={() => oauth('google')}>
                <GoogleMark /> Google로 시작하기
              </button>
            </div>
            <span className="landing-reader__hint">
              {oauthFailed ? '로그인이 중간에 끊겼어요 — 다시 시도해 주세요' : '읽은 책 몇 권이면 충분해요 · 가입과 로그인이 한 번에'}
            </span>
          </div>
        </div>

        <div className="landing-reader__art">
          <img key={illustration.src} src={illustration.src} alt={illustration.alt} />
          <p className="landing-reader__caption">
            <span>{illustration.eyebrow}</span>
            <b>{illustration.caption}</b>
          </p>
        </div>
      </div>

      <div className="eo-panel fixed bottom-5 left-4 z-40 flex items-center gap-4 px-3.5 py-2 sm:left-7">
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">그림</span>
        {ILLUSTRATIONS.map((item, index) => (
          <button key={item.src} onClick={() => setIllustrationIndex(index)}
            aria-pressed={illustrationIndex === index}
            className={`border-b-2 pb-0.5 text-[11px] transition-colors duration-150 ${
              illustrationIndex === index
                ? 'border-ink font-bold text-ink'
                : 'border-transparent text-ink-faint hover:text-ink'
            }`}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
