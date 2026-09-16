import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { LANDING_TITLES, useLandingBooks, useLandingOAuth, useRollingTitles } from './landingShared'

/** 랜딩 시안 B — 종이·잉크(Editorial Orbit) 위로 실제 인기 도서 표지가 천천히 흐르고,
 *  가운데는 비워 지면(글)을 얹는다. DESIGN.md의 "색은 표지가 담당한다"를 그대로 따르고,
 *  머리줄은 로그인 뒤 GNB와 같은 높이·같은 밑줄 하나를 쓴다. */

/** 롤링 제목 한 칸의 높이(em) — 아래 CSS의 한 칸 높이와 같은 수여야 한다 */
const LINE = 1.34

const COVER_POOL = 24   // 내려받는 표지 수. 칸이 더 많으면 이 묶음을 돌려 쓴다(같은 URL이라 추가 전송 없음)
const COL_TARGET = 208  // 열 하나의 목표 너비(px) — 실제 열 수는 화면 너비에서 나온다.
                        // 좁게 잡아 열을 늘리면 표지가 배경이 아니라 벽처럼 읽힌다
const GAP = 18
const COVER_RATIO = 0.7 // DESIGN.md 표지 기본 비율

/** 화면 크기에서 표지 격자를 뽑는다 — 열·행 수를 픽셀로 박아 두면 해상도마다 빈 줄이 생긴다 */
function shelfGrid() {
  const width = window.innerWidth
  const height = window.innerHeight
  const cols = Math.max(3, Math.round(width / COL_TARGET))
  const colWidth = (width - GAP * (cols + 1)) / cols
  // 한 열이 화면보다 길어야 되감을 때 바닥이 비지 않는다
  const rows = Math.ceil(height / (colWidth / COVER_RATIO + GAP)) + 1
  return { cols, rows }
}

const CSS = `
  .landing-shelf { position: fixed; inset: 0; overflow: hidden;
                   background: var(--eo-paper); color: var(--eo-ink);
                   font-family: var(--eo-font); -webkit-font-smoothing: antialiased; }

  /* ---- 배경: 표지 밭. 가운데를 마스크로 뚫어 글 뒤에는 종이만 남긴다 ---- */
  .landing-shelf__field { position: absolute; inset: 0; z-index: 0; display: grid; gap: ${GAP}px;
                          padding: 0 ${GAP}px; overflow: hidden; opacity: 0.24; pointer-events: none;
                          /* 글이 커진 만큼 가운데를 더 비운다 — 좁으면 큰 글자 뒤로 표지가 겹쳐 읽힌다 */
                          -webkit-mask-image: radial-gradient(ellipse 72% 64% at 50% 50%, transparent 46%, #000 100%);
                          mask-image: radial-gradient(ellipse 72% 64% at 50% 50%, transparent 46%, #000 100%); }
  .landing-shelf__col { overflow: hidden; }
  /* grid — 블록이면 마지막 표지의 아래 여백이 부모 밖으로 새어 나가 트랙 높이가
     한 칸 어긋나고, 그만큼 되감을 때 이음매가 튄다 */
  .landing-shelf__track { display: grid; will-change: transform;
                          animation: landing-shelf-drift var(--dur) linear infinite; }
  .landing-shelf__col:nth-child(even) .landing-shelf__track { animation-direction: reverse; }
  /* 간격을 gap 대신 margin으로 준다 — 되감기(-50%)가 딱 떨어져 이음매가 튀지 않는다 */
  .landing-shelf__track img { display: block; width: 100%; aspect-ratio: ${COVER_RATIO};
                              object-fit: cover; margin-bottom: ${GAP}px; background: var(--eo-placeholder); }
  @keyframes landing-shelf-drift { to { transform: translateY(-50%); } }

  /* ---- 제호: 종이 바탕을 깔아 표지가 워드마크 뒤로 지나가지 않게 한다 ---- */
  .landing-shelf__top { position: absolute; inset: 0 0 auto; z-index: 10; display: flex; align-items: center;
                        min-height: 54px; padding: 0 var(--eo-frame); background: var(--eo-paper);
                        border-bottom: 1px solid var(--eo-rule-soft); }
  .landing-shelf__mark { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; color: var(--eo-ink); }

  /* ---- 지면 ---- */
  .landing-shelf__page { position: relative; z-index: 5; height: 100%; display: flex; flex-direction: column;
                         align-items: center; justify-content: center; text-align: center;
                         padding: 54px var(--eo-frame) 0; }
  /* 크기는 시안 A와 같은 램프다 — DESIGN.md headline(최대 42px)으로는 랜딩 첫 화면에서
     표지 밭에 묻힌다. 자간·행간만 이 시안의 편집형 어휘를 지킨다 */
  .landing-shelf__h1 { margin: 0; font-size: clamp(38px, 5vw, 64px); font-weight: 600; line-height: ${LINE};
                       letter-spacing: -0.055em; text-wrap: balance; word-break: keep-all; }
  .landing-shelf__roll { display: inline-flex; vertical-align: bottom; overflow: hidden; height: ${LINE}em; }
  .landing-shelf__roll ul { list-style: none; padding: 0; margin: 0; will-change: transform;
                            transition: transform 0.6s cubic-bezier(0.72, -0.02, 0.16, 1); }
  .landing-shelf__roll li { height: ${LINE}em; display: flex; align-items: center; justify-content: center;
                            font-weight: 700; white-space: nowrap; }
  .landing-shelf__sub { margin: 22px 0 0; max-width: 44ch; color: var(--eo-ink-muted);
                        font-size: 17px; font-weight: 400; line-height: 1.8; letter-spacing: -0.02em;
                        text-wrap: pretty; word-break: keep-all; }
  .landing-shelf__cta { margin-top: 44px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .landing-shelf__btns { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
  .landing-shelf__oauth { display: inline-flex; align-items: center; justify-content: center; gap: 9px;
                          min-width: 220px; min-height: 53px; padding: 0 30px; border-radius: 999px; cursor: pointer;
                          font: inherit; font-size: 15px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
                          transition: opacity var(--eo-motion) ease-out, transform var(--eo-motion) ease-out; }
  .landing-shelf__oauth:hover, .landing-shelf__oauth:focus-visible { opacity: 0.82; transform: translateY(-1px); }
  /* 카카오 버튼의 노랑·글자색은 카카오 로그인 버튼 규정이라 팔레트 밖이어도 그대로 둔다.
     테두리는 투명으로 둬 구글 버튼과 높이·반경만 맞춘다 */
  .landing-shelf__oauth--kakao { border: 1px solid transparent; background: #fee500; color: #191919; }
  .landing-shelf__oauth--google { border: 1px solid var(--eo-rule-soft); background: var(--eo-paper); color: var(--eo-ink); }
  .landing-shelf__oauth svg { display: block; flex: none; width: 18px; height: 18px; }
  .landing-shelf__hint { color: var(--eo-ink-faint); font-size: 13px; letter-spacing: -0.01em; }
  .landing-shelf :focus-visible { outline: 2px solid var(--eo-ink); outline-offset: 3px; }

  @media (max-width: 640px) {
    /* 좁은 화면에서는 글이 세로로 길어져 가로로 뚫은 구멍 밖으로 버튼·안내가 밀려난다.
       여기서는 위아래로 길게 비우고 표지는 천장과 바닥에만 남긴다 */
    .landing-shelf__field { -webkit-mask-image: radial-gradient(ellipse 88% 62% at 50% 49%, transparent 54%, #000 100%);
                            mask-image: radial-gradient(ellipse 88% 62% at 50% 49%, transparent 54%, #000 100%); }
    .landing-shelf__btns { width: 100%; max-width: 320px; }
    .landing-shelf__oauth { flex: 1 1 100%; min-width: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .landing-shelf__track { animation: none; }
    .landing-shelf__roll ul { transition: none; }
  }
`

/** 카카오톡 말풍선 — 카카오 로그인 버튼 규정의 심벌. 노란 바탕 위 검정이라 버튼 글자색을 따라간다 */
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

export default function LandingShelf() {
  const { oauth, oauthFailed } = useLandingOAuth()
  const ulRef = useRollingTitles(`${LINE}em`)
  const books = useLandingBooks(COVER_POOL)
  const [grid, setGrid] = useState(shelfGrid)

  useEffect(() => {
    const onResize = () => setGrid(shelfGrid())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 열마다 집는 자리를 어긋나게 해 옆 칸에 같은 표지가 붙지 않게 한다
  const columns = useMemo(() => {
    if (books.length === 0) return []
    return Array.from({ length: grid.cols }, (_, c) =>
      Array.from({ length: grid.rows }, (_, r) => books[(r * grid.cols + c * 5) % books.length].coverUrl))
  }, [books, grid])

  return (
    <div className="landing-shelf">
      <style>{CSS}</style>
      <div className="landing-shelf__field" aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}>
        {columns.map((column, c) => (
          <div className="landing-shelf__col" key={c}>
            {/* 표지를 두 벌 쌓고 -50%까지 밀면 이음매 없이 되감긴다 */}
            <div className="landing-shelf__track" style={{ '--dur': `${64 + c * 9}s` } as CSSProperties}>
              {[...column, ...column].map((src, i) => (
                <img key={i} src={src} alt="" draggable={false}
                  loading={i < grid.rows ? 'eager' : 'lazy'} decoding="async" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <header className="landing-shelf__top">
        <span className="landing-shelf__mark">책추책책추</span>
      </header>
      <div className="landing-shelf__page">
        <h1 className="landing-shelf__h1">
          당신의 다음 한 권은<br />
          <span className="landing-shelf__roll">
            <ul ref={ulRef}>{[...LANDING_TITLES, LANDING_TITLES[0]].map((t, i) => <li key={i}>{t}</li>)}</ul>
          </span><br />
          일지도 몰라요.
        </h1>
        <p className="landing-shelf__sub">읽은 책 몇 권이면 충분해요.<br />205만 권 속에서 당신 기준으로, 이유와 함께 골라드릴게요.</p>
        <div className="landing-shelf__cta">
          <div className="landing-shelf__btns">
            <button className="landing-shelf__oauth landing-shelf__oauth--kakao" onClick={() => oauth('kakao')}>
              <KakaoMark /> 카카오로 시작하기
            </button>
            <button className="landing-shelf__oauth landing-shelf__oauth--google" onClick={() => oauth('google')}>
              <GoogleMark /> Google로 시작하기
            </button>
          </div>
          <span className="landing-shelf__hint">
            {oauthFailed ? '로그인이 중간에 끊겼어요 — 다시 시도해 주세요' : '가입과 로그인이 하나예요 — 3초면 충분해요'}
          </span>
        </div>
      </div>
    </div>
  )
}
