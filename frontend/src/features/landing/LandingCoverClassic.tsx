import { LANDING_TITLES, useLandingOAuth, useRollingTitles } from './landingShared'

/** 랜딩 시안 C-2 — 별무늬 남색 입체 책 안에 제목과 로그인을 함께 넣은 이전 버전. */
const TITLES = LANDING_TITLES.map((title) => title.replace(/[《》]/g, ''))

const CSS = `
  .landing-cover2 { --book-blue: #3a5871; --book-paper: var(--eo-paper); --book-gold: #e8dcc0;
                    --title-h: clamp(62px, 6.4vw, 86px); position: fixed; inset: 0; overflow: hidden;
                    background: var(--eo-paper); color: var(--eo-ink); font-family: var(--eo-font);
                    -webkit-font-smoothing: antialiased; }
  .landing-cover2__top { position: absolute; z-index: 20; inset: 0 0 auto; min-height: 54px;
                         padding: 0 var(--eo-frame); display: flex; align-items: center;
                         border-bottom: 1px solid var(--eo-rule-soft); background: var(--eo-paper); }
  .landing-cover2__mark { font-size: 15px; font-weight: 700; letter-spacing: -.03em; }
  .landing-cover2__book { --cover-top-h: 68px; position: absolute; z-index: 2;
                          top: clamp(118px, 12vh, 146px); left: 50%;
                          width: min(78vw, 1160px); height: max(680px, calc(100vh - 84px));
                          transform: translateX(-50%); color: var(--book-gold); }
  .landing-cover2__pages-top { position: absolute; z-index: 1; left: 0; right: -4%;
                              top: calc(-1 * var(--cover-top-h)); height: var(--cover-top-h);
                              clip-path: polygon(0 100%, 6% 0, 96% 0, 100% 28%, 96.15% 100%);
                              background: repeating-linear-gradient(177deg, #f8f6ee 0 6px, #d9d6cb 7px 8px);
                              filter: drop-shadow(0 5px 8px rgba(15,22,31,.12)); }
  .landing-cover2__pages-top::after { content: ''; position: absolute; inset: 0; border-top: 3px solid #27314a; }
  .landing-cover2__foreedge { position: absolute; z-index: 1; top: calc(-1 * var(--cover-top-h));
                             right: -4%; width: 4.2%; height: calc(100% + var(--cover-top-h));
                             clip-path: polygon(100% 0, 100% 100%, 0 100%, 0 var(--cover-top-h));
                             border-radius: 0 0 20px 0;
                             background: repeating-linear-gradient(90deg, #f4f1e8 0 3px, #d7d3c7 4px 5px);
                             box-shadow: 14px 15px 24px rgba(25,33,41,.14); }
  .landing-cover2__front { position: absolute; z-index: 3; inset: 0; overflow: hidden;
                           border-radius: 4px 14px 0 0; background-color: var(--book-blue);
                           background-image:
                             linear-gradient(105deg, rgba(255,255,255,.08), transparent 23%, transparent 72%, rgba(4,11,29,.18)),
                             repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, rgba(8,19,31,.025) 1px 3px),
                             repeating-linear-gradient(90deg, rgba(255,255,255,.018) 0 1px, transparent 1px 4px);
                           box-shadow: inset 1px 0 rgba(255,255,255,.16), 0 14px 36px rgba(0,0,0,.15); }
  .landing-cover2__front::before { content: ''; position: absolute; inset: 6.8% 5.6% 5%;
                                   border: 1px solid rgba(232,220,192,.45); border-radius: 2px; }
  .landing-cover2__front::after { content: ''; position: absolute; inset: 8.4% 7.1% 6.6%;
                                  border: 1px solid rgba(232,220,192,.14); pointer-events: none; }
  .landing-cover2__spine { position: absolute; z-index: 4; inset: 0 auto 0 0; width: 7.2%;
                           background: linear-gradient(90deg, #27314a, #3a5871 72%, rgba(255,255,255,.1));
                           border-right: 1px solid rgba(232,220,192,.24); }
  .landing-cover2__edition { position: absolute; z-index: 5; top: 14.5%; left: 12%;
                             font-size: clamp(9px, 1vw, 15px); font-weight: 800; letter-spacing: .18em; }
  .landing-cover2__brand { position: absolute; z-index: 5; top: 14%; right: 8.5%;
                           display: flex; flex-direction: column; font-size: clamp(9px, .9vw, 14px);
                           font-weight: 700; line-height: 1.45; }
  .landing-cover2__brand i { font-style: normal; }
  .landing-cover2__copy { position: absolute; z-index: 6; top: 35%; left: 15%; right: 11%;
                          transform: translateY(-16%); }
  .landing-cover2__lead, .landing-cover2__tail { margin: 0; font-family: var(--font-serif-ko);
                                                font-size: clamp(27px, 3.2vw, 50px); font-weight: 500;
                                                line-height: 1.15; letter-spacing: -.055em; }
  .landing-cover2__lead { text-align: left; }
  .landing-cover2__tail { margin-top: clamp(22px, 2vw, 34px); text-align: right; }
  .landing-cover2__window { height: var(--title-h); margin-top: clamp(25px, 2.6vw, 42px); overflow: hidden;
                            color: #172233; background: var(--book-paper);
                            border: 1px solid rgba(11,11,11,.18);
                            box-shadow: inset 0 4px 9px rgba(29,35,42,.15), 0 1px rgba(255,255,255,.45); }
  .landing-cover2__window ul { margin: 0; padding: 0; list-style: none; will-change: transform;
                               transition: transform .65s cubic-bezier(.72,-.02,.16,1); }
  .landing-cover2__window li { height: var(--title-h); display: flex; align-items: center; justify-content: center;
                               font-family: var(--font-serif-ko); font-size: clamp(34px, 4.4vw, 62px);
                               font-weight: 700; letter-spacing: -.055em; white-space: nowrap; }
  .landing-cover2__cta { margin-top: clamp(30px, 3vw, 48px); }
  .landing-cover2__buttons { display: flex; gap: 12px; max-width: 760px; margin: 0 auto; }
  .landing-cover2__oauth { flex: 1; min-height: clamp(48px, 4.7vw, 62px); border-radius: 999px; cursor: pointer;
                           font: inherit; font-size: clamp(13px, 1.2vw, 17px); font-weight: 700;
                           transition: transform .16s ease, opacity .16s ease; }
  .landing-cover2__oauth:hover, .landing-cover2__oauth:focus-visible { transform: translateY(-1px); opacity: .84; }
  .landing-cover2__oauth--kakao { border: 1px solid #fee500; background: #fee500; color: #191919; }
  .landing-cover2__oauth--google { border: 1px solid rgba(23,34,51,.28); background: #fff; color: #111; }
  .landing-cover2__hint { display: block; margin-top: 17px; color: rgba(238,226,189,.72);
                          text-align: center; font-size: clamp(10px, 1vw, 14px); }
  @media (max-width: 760px) {
    .landing-cover2 { --title-h: 58px; }
    .landing-cover2__book { --cover-top-h: 54px; top: 118px; width: 94vw;
                            height: max(820px, calc(100vh - 60px)); }
    .landing-cover2__foreedge { right: -3%; width: 4%; }
    .landing-cover2__copy { top: 36%; left: 10%; right: 7%; }
    .landing-cover2__lead, .landing-cover2__tail { font-size: 27px; }
    .landing-cover2__window li { font-size: 36px; }
    .landing-cover2__buttons { flex-direction: column; gap: 9px; }
    .landing-cover2__oauth { min-height: 48px; font-size: 14px; }
    .landing-cover2__cta { margin-top: 32px; }
  }
  @media (prefers-reduced-motion: reduce) { .landing-cover2__window ul { transition: none; } }
`

export default function LandingCoverClassic() {
  const { oauth, oauthFailed } = useLandingOAuth()
  const ulRef = useRollingTitles('var(--title-h)')
  return (
    <div className="landing-cover2">
      <style>{CSS}</style>
      <header className="landing-cover2__top"><span className="landing-cover2__mark">책추책책추</span></header>
      <main className="landing-cover2__book">
        <div className="landing-cover2__pages-top" aria-hidden="true" />
        <div className="landing-cover2__foreedge" aria-hidden="true" />
        <div className="landing-cover2__front">
          <div className="landing-cover2__spine" aria-hidden="true" />
          <span className="landing-cover2__edition">THE NEXT READING · 01</span>
          <span className="landing-cover2__brand" aria-label="책추책책추"><i>책</i><i>추</i><i>책</i><i>책</i><i>추</i></span>
          <section className="landing-cover2__copy" aria-labelledby="landing-cover2-title">
            <h1 id="landing-cover2-title" className="landing-cover2__lead">당신의 다음 한 권은</h1>
            <div className="landing-cover2__window">
              <ul ref={ulRef}>{[...TITLES, TITLES[0]].map((title, i) => <li key={i}>{title}</li>)}</ul>
            </div>
            <p className="landing-cover2__tail">일지도 몰라요.</p>
            <div className="landing-cover2__cta">
              <div className="landing-cover2__buttons">
                <button className="landing-cover2__oauth landing-cover2__oauth--kakao" onClick={() => oauth('kakao')}>💬 &nbsp; 카카오로 시작하기</button>
                <button className="landing-cover2__oauth landing-cover2__oauth--google" onClick={() => oauth('google')}>G &nbsp; Google로 시작하기</button>
              </div>
              <span className="landing-cover2__hint">
                {oauthFailed ? '로그인이 중간에 끊겼어요 — 다시 시도해 주세요' : '가입과 로그인이 하나예요 — 3초면 충분해요'}
              </span>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
