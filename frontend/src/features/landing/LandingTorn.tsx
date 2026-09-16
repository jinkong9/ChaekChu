import { LANDING_TITLES, useLandingOAuth, useRollingTitles } from './landingShared'

/** 랜딩 시안 E — 잡지 표지 한 장. 거의 흰 종이에 잉크만 얹고, 지면 한가운데를 가로로
 *  찢어 그 사이로 다음 책 제목이 지나간다. 제목은 찢긴 자리에 인쇄된 것처럼 보여야 해서
 *  겹화살괄호를 뗀다 — 창 대신 찢긴 틈이 제목을 감싼다. */
const TORN_TITLES = LANDING_TITLES.map((title) => title.replace(/[《》]/g, ''))

/** 찢긴 가장자리를 만드는 난수. 씨앗을 고정해 새로고침마다 같은 모양이 나오게 한다 —
 *  종이가 매번 다르게 찢어지면 화면이 아니라 애니메이션으로 읽힌다. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** 찢긴 가장자리 한 줄. 굵은 결(파도) + 잔섬유(지터) + 가끔 크게 패는 자리(노치)를 겹친다.
 *  점을 성기게 두거나 한 가지 주파수만 쓰면 톱니로 보인다 — 찢긴 종이는 결이 불규칙하다. */
function tornEdge(seed: number, baseline: number, amp: number, points = 132) {
  const rand = seeded(seed)
  const edge: string[] = []
  for (let i = 0; i <= points; i++) {
    const t = i / points
    const wave = Math.sin(t * Math.PI * 3.1 + seed) * amp * 0.5
      + Math.sin(t * Math.PI * 8.3 + seed * 1.7) * amp * 0.22
    const fiber = (rand() - 0.5) * amp * 0.85
    const notch = rand() < 0.07 ? (rand() - 0.5) * amp * 2.4 : 0
    edge.push(`${(t * 100).toFixed(2)}% ${(baseline + wave + fiber + notch).toFixed(2)}%`)
  }
  return edge
}

/* 벌어진 폭(28%~74%)은 제목 칸보다 넉넉해야 한다 — 좁으면 제목이 틈 밖 종이 위로 올라앉는다 */
const UPPER_EDGE = tornEdge(11, 28, 5.2)
const LOWER_EDGE = tornEdge(29, 74, 5.2)
/** 위쪽 종이 — 윗변은 반듯하고 아랫변만 찢겨 있다 (오른쪽에서 왼쪽으로 훑어 닫는다) */
const UPPER_CLIP = `polygon(0% 0%, 100% 0%, ${[...UPPER_EDGE].reverse().join(', ')})`
/** 아래쪽 종이 — 윗변만 찢겨 있다 */
const LOWER_CLIP = `polygon(${LOWER_EDGE.join(', ')}, 100% 100%, 0% 100%)`

const CSS = `
  .landing-torn { --torn-paper: #efeeeb; --torn-ink: #17191b; --torn-under: #ffffff;
                  --torn-title-h: clamp(48px, 7.6vw, 98px);
                  position: fixed; inset: 0; overflow: hidden;
                  color: var(--torn-ink); font-family: var(--eo-font);
                  -webkit-font-smoothing: antialiased;
                  /* 표지의 바탕 — 거의 흰 종이에 결과 가장자리 그늘만. 색은 여기서만 정한다 */
                  background-image: var(--paper-noise), var(--paper-fiber),
                                    radial-gradient(ellipse 120% 90% at 50% 38%, #f6f5f3 0%, #eceae7 58%, #e2e0dc 100%);
                  background-blend-mode: multiply, multiply, normal;
                  background-color: var(--torn-paper); }

  /* 표지를 두르는 검정 괘선 한 줄 — 잡지 표지의 판면을 만든다 */
  .landing-torn__frame { position: absolute; inset: clamp(10px, 1.4vw, 18px); z-index: 1;
                         border: 1px solid rgba(23, 25, 27, 0.82); pointer-events: none; }

  .landing-torn__sheet { position: relative; z-index: 2; display: flex; flex-direction: column;
                         height: 100%; padding: clamp(24px, 3.4vw, 40px) clamp(28px, 4.4vw, 62px)
                                                clamp(20px, 2.6vw, 32px);
                         text-align: center; }

  /* ---- 제호 ---- */
  .landing-torn__meta { display: flex; justify-content: space-between; align-items: baseline;
                        font-family: var(--font-serif-ko); font-size: clamp(9px, 0.95vw, 12px);
                        font-weight: 600; letter-spacing: 0.04em; }
  /* 제호는 지면의 주인이 아니다 — 가장 큰 글자는 찢긴 틈의 책 제목이어야 한다 */
  .landing-torn__wordmark { margin: clamp(2px, 0.6vw, 8px) 0 0; font-family: var(--font-serif-ko);
                            font-size: clamp(23px, 3.2vw, 42px); font-weight: 600; line-height: 1.02;
                            letter-spacing: -0.045em; }
  .landing-torn__deck { display: flex; align-items: center; gap: clamp(10px, 1.4vw, 18px);
                        margin-top: clamp(8px, 1.2vw, 15px);
                        font-family: var(--font-serif-ko); font-size: clamp(9px, 0.95vw, 12px);
                        font-weight: 600; letter-spacing: 0.34em; white-space: nowrap; }
  .landing-torn__deck::before, .landing-torn__deck::after { content: ''; flex: 1; height: 1px;
                                                           background: rgba(23, 25, 27, 0.5); }

  /* ---- 찢긴 지면 ---- */
  .landing-torn__story { display: flex; flex: 1; flex-direction: column; justify-content: center;
                         min-height: 0; padding: clamp(6px, 1.4vh, 18px) 0; }
  .landing-torn__lead, .landing-torn__tail { margin: 0; font-family: var(--font-serif-ko); font-weight: 500;
                                             line-height: 1.2; letter-spacing: -0.045em; }
  .landing-torn__lead { font-size: clamp(21px, 2.7vw, 36px); }
  .landing-torn__tail { margin-top: clamp(4px, 0.8vw, 10px); text-align: center;
                        font-size: clamp(19px, 2.4vw, 32px); }

  /* 찢긴 띠. 위·아래 종이가 각각 제 가장자리만 찢겨 있고 그 사이로 아래층이 보인다 */
  /* 벌어진 폭은 이 높이의 46%다 — 제목 칸(--torn-title-h)보다 넉넉해야 한다 */
  .landing-torn__rip { position: relative; width: 100%; height: clamp(136px, 19vw, 236px);
                       margin: clamp(6px, 1vw, 12px) 0; }
  /* 틈 — 찢고 나면 드러나는 밝은 아래층. 위쪽이 살짝 파여 보이게 안쪽 그늘을 얹는다 */
  /* 아래층은 바탕보다 확실히 밝아야 찢겨 열린 것으로 읽힌다. 위 종이가 드리우는
     그늘을 깊게 넣어 틈이 파인 자리가 되게 한다 */
  .landing-torn__gap { position: absolute; inset: 0; overflow: hidden;
                       background-image: var(--paper-noise),
                                         linear-gradient(var(--torn-under), var(--torn-under));
                       background-blend-mode: multiply, normal;
                       box-shadow: inset 0 16px 18px -10px rgba(28, 28, 25, 0.55),
                                   inset 0 -10px 13px -8px rgba(28, 28, 25, 0.3); }
  /* 위·아래 종이. drop-shadow 는 clip-path 모양을 그대로 따라가서, 찢긴 결마다
     흰 속살(첫 그림자)과 틈으로 지는 그늘(둘째 그림자)이 같이 생긴다 */
  .landing-torn__leaf { position: absolute; inset: 0; pointer-events: none;
                        background-image: var(--paper-noise), var(--paper-fiber),
                                          linear-gradient(var(--torn-paper), var(--torn-paper));
                        background-blend-mode: multiply, multiply, normal; }
  .landing-torn__leaf--upper { clip-path: ${UPPER_CLIP};
                               filter: drop-shadow(0 1.5px 0 rgba(255, 255, 255, 0.96))
                                       drop-shadow(0 5px 5px rgba(30, 30, 27, 0.34)); }
  .landing-torn__leaf--lower { clip-path: ${LOWER_CLIP};
                               filter: drop-shadow(0 -1.5px 0 rgba(255, 255, 255, 0.92))
                                       drop-shadow(0 -4px 4px rgba(30, 30, 27, 0.2)); }

  /* 왼쪽 끝에서 말려 올라간 종이. 원통으로 보이도록 가로 그라데이션으로 빛과 그늘을 번갈아 둔다 */
  /* 왼쪽 끝에서 말려 올라간 종이. 축이 세로인 원통이라 밝고 어두운 띠가 가로로 번갈아 놓인다.
     왼쪽 끝은 원통의 마구리라 반원으로 둥글고, 오른쪽은 편평한 지면으로 이어진다 */
  .landing-torn__curl { position: absolute; z-index: 4; left: -2%; top: 20%;
                        width: clamp(84px, 10.4vw, 140px); height: clamp(66px, 8vw, 104px);
                        border-radius: 50% 7px 7px 50% / 50% 9px 9px 50%;
                        transform: rotate(-5deg); transform-origin: left center;
                        background-image: var(--paper-noise),
                                          linear-gradient(93deg, #efeeea 0%, #ffffff 13%, #f4f3f0 24%,
                                                          #cbcac5 43%, #b9b8b3 52%, #eceae6 68%,
                                                          #fdfdfb 80%, #cdccc7 94%, #dedcd8 100%);
                        background-blend-mode: multiply, normal;
                        box-shadow: 16px 15px 20px rgba(28, 28, 25, 0.32),
                                    inset 0 1px 0 rgba(255, 255, 255, 0.9),
                                    inset 0 -2px 3px rgba(28, 28, 25, 0.16); }
  /* 말린 끝에 남아 늘어진 조각 — 아래로 처지고 제 그림자를 따로 드리운다 */
  .landing-torn__curl::after { content: ''; position: absolute; left: 4%; top: 78%;
                               width: 46%; height: 82%;
                               clip-path: polygon(4% 0, 96% 9%, 86% 40%, 100% 66%, 58% 100%, 18% 82%, 0 34%);
                               background-image: var(--paper-noise),
                                                 linear-gradient(104deg, #fbfaf8 0%, #e6e5e1 38%,
                                                                 #c8c7c2 72%, #ddddd8 100%);
                               background-blend-mode: multiply, normal;
                               filter: drop-shadow(7px 9px 8px rgba(28, 28, 25, 0.28)); }

  /* 틈 사이로 지나가는 제목 띠 */
  .landing-torn__window { position: absolute; z-index: 3; left: 50%; top: 52%;
                          width: 76%; height: var(--torn-title-h); overflow: hidden;
                          transform: translate(-50%, -50%); }
  .landing-torn__window ul { list-style: none; margin: 0; padding: 0; will-change: transform;
                             transition: transform 0.65s cubic-bezier(0.72, -0.02, 0.16, 1); }
  .landing-torn__window li { display: flex; height: var(--torn-title-h); align-items: center;
                             justify-content: center; font-family: var(--font-serif-ko);
                             font-size: clamp(29px, 5.9vw, 76px); font-weight: 600;
                             letter-spacing: -0.055em; white-space: nowrap; }

  /* ---- 아래 ---- */
  .landing-torn__cta { display: flex; flex-direction: column; align-items: center;
                       gap: clamp(7px, 1vw, 11px); }
  .landing-torn__buttons { display: flex; gap: 9px; width: min(520px, 84vw); }
  .landing-torn__oauth { display: inline-flex; flex: 1; align-items: center; justify-content: center; gap: 8px;
                         min-height: 46px; border-radius: 0; cursor: pointer; font: inherit;
                         font-size: 13px; font-weight: 700; letter-spacing: -0.02em;
                         transition: transform 0.16s ease, opacity 0.16s ease; }
  .landing-torn__oauth:hover, .landing-torn__oauth:focus-visible { transform: translateY(-1px); opacity: 0.8; }
  .landing-torn__oauth--kakao { border: 1px solid var(--torn-ink); background: var(--torn-ink); color: #f6f5f2; }
  .landing-torn__oauth--google { border: 1px solid rgba(23, 25, 27, 0.5); background: rgba(255, 255, 255, 0.5);
                                 color: var(--torn-ink); }
  .landing-torn__oauth svg { display: block; flex: none; width: 17px; height: 17px; }
  .landing-torn__hint { font-family: var(--font-serif-ko); font-size: clamp(9px, 0.95vw, 11px);
                        letter-spacing: 0.02em; color: rgba(23, 25, 27, 0.56); }

  @media (max-width: 640px) {
    .landing-torn__meta { font-size: 8px; letter-spacing: 0.02em; }
    .landing-torn__deck { letter-spacing: 0.2em; }
    .landing-torn__rip { height: 148px; }
    .landing-torn__window { width: 86%; }
    .landing-torn__buttons { flex-direction: column; width: 100%; max-width: 320px; }
    .landing-torn__oauth { flex: none; }
  }
  @media (prefers-reduced-motion: reduce) { .landing-torn__window ul { transition: none; } }
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

export default function LandingTorn() {
  const { oauth, oauthFailed } = useLandingOAuth()
  const ulRef = useRollingTitles('var(--torn-title-h)')

  return (
    <div className="landing-torn">
      <style>{CSS}</style>
      <span className="landing-torn__frame" aria-hidden="true" />
      <div className="landing-torn__sheet">
        <header>
          <div className="landing-torn__meta">
            <span>PERSONAL READING JOURNAL</span>
            <span>VOL. 01</span>
          </div>
          <h1 className="landing-torn__wordmark">책추책책추</h1>
          <div className="landing-torn__deck">THE NEXT BOOK</div>
        </header>

        <section className="landing-torn__story" aria-label="찢긴 지면 사이로 다음 책 제목이 흐른다">
          <p className="landing-torn__lead">당신의 다음 한 권은</p>
          <div className="landing-torn__rip">
            <div className="landing-torn__gap" aria-hidden="true" />
            <div className="landing-torn__window">
              <ul ref={ulRef}>
                {[...TORN_TITLES, TORN_TITLES[0]].map((title, index) => <li key={index}>{title}</li>)}
              </ul>
            </div>
            <div className="landing-torn__leaf landing-torn__leaf--upper" aria-hidden="true" />
            <div className="landing-torn__leaf landing-torn__leaf--lower" aria-hidden="true" />
            <div className="landing-torn__curl" aria-hidden="true" />
          </div>
          <p className="landing-torn__tail">일지도 몰라요.</p>
        </section>

        <div className="landing-torn__cta">
          <div className="landing-torn__buttons">
            <button className="landing-torn__oauth landing-torn__oauth--kakao" onClick={() => oauth('kakao')}>
              <KakaoMark /> 카카오로 시작하기
            </button>
            <button className="landing-torn__oauth landing-torn__oauth--google" onClick={() => oauth('google')}>
              <GoogleMark /> Google로 시작하기
            </button>
          </div>
          <span className="landing-torn__hint">
            {oauthFailed ? '로그인이 중간에 끊겼어요 — 다시 시도해 주세요' : '읽은 책 몇 권이면 충분해요 · 가입과 로그인이 한 번에'}
          </span>
        </div>
      </div>
    </div>
  )
}
