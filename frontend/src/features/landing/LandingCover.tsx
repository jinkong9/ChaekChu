import bookCover from '../../assets/book-cover-archive-repaired.png'
import { LANDING_TITLES, useLandingOAuth, useTitleCycle } from './landingShared'

/** 랜딩 시안 C — 실제 책 표지가 아니라 '책추책책추의 빈 책' 한 권을 놓고,
 *  그 표지의 제목 자리에 문구를 찍는다. 내 서재 '나의 책'의 표지 한 장을 그대로 쓰되
 *  (열리는 책 구조는 빼고) 비례·팔레트·위아래 작은 글줄을 맞춰, 서비스를 펼치기 직전의
 *  첫 장처럼 읽히게 한다. 표지 문양 자리는 비어 있어 문구가 제목으로 앉는다. */

const LINE = 1.5 // 표지에 앉힌 문구 한 줄의 높이(em) — 제목 칸 높이와 같은 수여야 한다

/** 표지 문양이 비워 둔 안쪽 칸의 너비(표지 너비 대비). 글은 이 칸을 넘으면 백합 무늬 위로 올라간다 */
const FIELD = 0.62
/** 글자 크기도 표지 너비에서 뽑는다 — 화면 크기에 따라 책만 커지고 제목이 그대로면 표지가 아니라 포스터가 된다 */
const TYPE_MAX = 0.072

/** 긴 제목은 글자 수만큼 작게 앉힌다 — 실제 책 표지가 하는 일과 같다.
 *  한 줄로 두는 편이 문장("…한 권은 / 『제목』 / 일지도 몰라요")의 흐름을 지킨다.
 *  0.82 는 한글 한 글자가 차지하는 폭(자간 -0.055em 포함 약 0.68em)에서 역산한 값으로,
 *  가장 긴 제목이 빈 칸의 90%를 넘지 않게 잡았다. */
const titleSize = (title: string) =>
  `calc(var(--landing-book-w) * ${Math.min(TYPE_MAX, 0.82 / title.length).toFixed(4)})`

/** 표지 바탕·잉크는 내 서재 '나의 책'에서 그대로 가져왔다
 *  (LibraryPage.css .libd-book__front-cover-face--outside).
 *  그 책의 생김새가 바뀌면 여기도 같이 봐야 한다 — 두 곳이 어긋나면 같은 책으로 안 보인다. */
const BOOK_GROUND = '#3a5871'
const BOOK_INK = '#e8dcc0'
const BOOK_INK_FAINT = '#ded2b6'
const BOOK_SHADE = 'rgba(4, 11, 29, 0.26)'

const CSS = `
  .landing-cover { position: fixed; inset: 0; overflow: hidden;
                   background: var(--eo-paper); color: var(--eo-ink);
                   font-family: var(--eo-font); -webkit-font-smoothing: antialiased; }

  /* ---- 제호: 로그인 뒤 GNB와 같은 높이·같은 밑줄 하나 ---- */
  .landing-cover__top { position: absolute; inset: 0 0 auto; z-index: 10; display: flex; align-items: center;
                        min-height: 54px; padding: 0 var(--eo-frame);
                        border-bottom: 1px solid var(--eo-rule-soft); }
  .landing-cover__mark { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; color: var(--eo-ink); }

  /* 책 너비를 화면의 높이·너비 둘 다에서 뽑는다 — 높이만 보면 좁은 창에서 책이 넘치고,
     너비만 보면 낮은 창에서 버튼이 아래로 밀린다 */
  .landing-cover__page { --landing-book-w: max(200px, min(360px, 34vh, 74vw));
                         position: relative; height: 100%; display: flex; flex-direction: column;
                         align-items: center; justify-content: center; text-align: center;
                         padding: 54px var(--eo-frame) 0; }

  /* ---- 빈 책 한 권. 여백·모서리는 내 서재 표지 면과 같은 값 ---- */
  .landing-cover__book { position: relative; display: flex; flex-direction: column; align-items: center;
                         justify-content: space-between;
                         width: var(--landing-book-w); height: calc(var(--landing-book-w) * 1.34);
                         /* 여백 비율은 내 서재 표지 면과 같지만 기준이 다르다 — 거기선 표지가 책 안에
                            inset:0 으로 들어 있어 %가 책 너비를 봤고, 여기선 책이 지면의 자식이라
                            %가 지면 너비를 본다. 그래서 책 너비에서 직접 계산한다 */
                         padding: calc(var(--landing-book-w) * 0.16) calc(var(--landing-book-w) * 0.11)
                                  calc(var(--landing-book-w) * 0.135);
                         border-radius: 6px 14px 14px 6px;
                         color: ${BOOK_INK};
                         /* 빛이 드는 결 + 아르누보 표지 문양(문구 제거본) + 표지 바탕 */
                         background: linear-gradient(105deg, rgba(255, 255, 255, 0.10), transparent 24%, transparent 70%, ${BOOK_SHADE}),
                                     url('${bookCover}') center / 100% 100% no-repeat,
                                     ${BOOK_GROUND};
                         /* DESIGN.md가 확대된 표지에만 허용하는 깊이 */
                         box-shadow: 0 14px 36px rgba(0, 0, 0, 0.15), inset 1px 0 0 rgba(255, 255, 255, 0.16); }

  .landing-cover__imprint { font-size: clamp(6px, calc(var(--landing-book-w) * 0.026), 9px);
                            font-weight: 800; letter-spacing: 0.2em; color: ${BOOK_INK_FAINT};
                            text-shadow: 0 1px 1px rgba(14, 26, 38, 0.6); }
  .landing-cover__imprint--foot { opacity: 0.82; }

  /* ---- 표지의 제목 자리에 앉힌 문구 ---- */
  /* 자리를 표지 안에서 직접 잡는다 (내 서재 .libd-book__cover-title 와 같은 방식) —
     가운데로 흘려 두면 문양 한가운데 백합 한 쌍이 글줄 높이에 걸린다. 폭도 안쪽 여백이
     아니라 표지 너비에서 뽑는다 — 문양이 비워 둔 칸은 여백보다 좁다 */
  .landing-cover__h1 { position: absolute; left: 50%; top: 62%; transform: translate(-50%, -50%);
                       width: calc(var(--landing-book-w) * ${FIELD}); margin: 0;
                       font-size: calc(var(--landing-book-w) * ${TYPE_MAX}); font-weight: 550;
                       line-height: ${LINE}; letter-spacing: -0.055em; word-break: keep-all;
                       text-shadow: 0 1px 2px rgba(14, 26, 38, 0.45); }
  .landing-cover__line { display: block; }
  /* 제목 칸 — 열 권을 겹쳐 두고 한 권만 켠다. 한 장씩 갈아 끼우면 바뀌는 사이가 비어 깜빡인다 */
  .landing-cover__slot { display: block; position: relative; height: ${LINE}em; }
  .landing-cover__slot span { position: absolute; inset: 0; display: flex; align-items: center;
                              justify-content: center; white-space: nowrap; font-weight: 700;
                              opacity: 0; transition: opacity 220ms ease-out; }
  /* 나가는 쪽을 먼저 비우고 들어오는 쪽을 늦게 올린다 — 같이 반투명으로 겹치면 두 제목이 한꺼번에 보인다 */
  .landing-cover__slot span.is-on { opacity: 1; transition: opacity 400ms ease-out 180ms; }

  /* ---- 책 아래, 종이 위 ---- */
  .landing-cover__sub { margin: 30px 0 0; max-width: 44ch; color: var(--eo-ink-muted);
                        font-size: 12px; font-weight: 400; line-height: 1.75; letter-spacing: -0.02em;
                        text-wrap: pretty; word-break: keep-all; }
  .landing-cover__cta { margin-top: 30px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .landing-cover__btns { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
  .landing-cover__oauth { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
                          min-width: 196px; min-height: 44px; padding: 0 22px; border-radius: 999px; cursor: pointer;
                          font: inherit; font-size: 13px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
                          transition: opacity var(--eo-motion) ease-out, transform var(--eo-motion) ease-out; }
  .landing-cover__oauth:hover, .landing-cover__oauth:focus-visible { opacity: 0.82; transform: translateY(-1px); }
  /* 카카오 버튼의 노랑·글자색은 카카오 로그인 버튼 규정이라 팔레트 밖이어도 그대로 둔다 */
  .landing-cover__oauth--kakao { border: 1px solid transparent; background: #fee500; color: #191919; }
  .landing-cover__oauth--google { border: 1px solid var(--eo-rule-soft); background: var(--eo-paper); color: var(--eo-ink); }
  .landing-cover__hint { color: var(--eo-ink-faint); font-size: 11px; letter-spacing: -0.01em; }
  .landing-cover :focus-visible { outline: 2px solid var(--eo-ink); outline-offset: 3px; }

  @media (max-width: 640px) {
    .landing-cover__btns { width: 100%; max-width: 320px; }
    .landing-cover__oauth { flex: 1 1 100%; min-width: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .landing-cover__slot span { transition: none; }
  }
`

export default function LandingCover() {
  const { oauth, oauthFailed } = useLandingOAuth()
  const index = useTitleCycle(LANDING_TITLES.length)

  return (
    <div className="landing-cover">
      <style>{CSS}</style>
      <header className="landing-cover__top">
        <span className="landing-cover__mark">책추책책추</span>
      </header>
      <div className="landing-cover__page">
        <div className="landing-cover__book">
          <small className="landing-cover__imprint">BOOK EXPERIENCE</small>
          <h1 className="landing-cover__h1">
            <span className="landing-cover__line">당신의 다음 한 권은</span>
            <span className="landing-cover__slot">
              {LANDING_TITLES.map((title, i) => (
                <span key={title} className={i === index ? 'is-on' : ''} aria-hidden={i !== index}
                  style={{ fontSize: titleSize(title) }}>{title}</span>
              ))}
            </span>
            <span className="landing-cover__line">일지도 몰라요.</span>
          </h1>
          <span className="landing-cover__imprint landing-cover__imprint--foot">PAGE · 1st</span>
        </div>
        <p className="landing-cover__sub">읽은 책 몇 권이면 충분해요.<br />205만 권 속에서 당신 기준으로, 이유와 함께 골라드릴게요.</p>
        <div className="landing-cover__cta">
          <div className="landing-cover__btns">
            <button className="landing-cover__oauth landing-cover__oauth--kakao" onClick={() => oauth('kakao')}>
              <span aria-hidden>💬</span> 카카오로 시작하기
            </button>
            <button className="landing-cover__oauth landing-cover__oauth--google" onClick={() => oauth('google')}>
              <span aria-hidden>G</span> Google로 시작하기
            </button>
          </div>
          <span className="landing-cover__hint">
            {oauthFailed ? '로그인이 중간에 끊겼어요 — 다시 시도해 주세요' : '가입과 로그인이 하나예요 — 3초면 충분해요'}
          </span>
        </div>
      </div>
    </div>
  )
}
