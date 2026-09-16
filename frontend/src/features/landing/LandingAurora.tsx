import { useMemo, type CSSProperties } from 'react'
import { LANDING_TITLES, useLandingOAuth, useRollingTitles } from './landingShared'

/** 랜딩 시안 A — 오로라 블롭 + 먼지 입자 + 롤링 책 제목 (8/28까지의 기존 화면 그대로).
 *  크림·코랄 팔레트는 DESIGN.md 이전 방향이라 나머지 화면과는 다른 어휘를 쓴다. */

/** 롤링 제목 한 칸의 높이(em) — 아래 CSS의 .land-roll 높이와 같은 수여야 한다 */
const LINE = 1.42

const CSS = `
  .land { position: fixed; inset: 0; background: #fff8ec; color: #22224a; overflow: hidden;
          font-family: 'Pretendard Variable', Pretendard, -apple-system, 'Segoe UI', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  .land-bg { position: absolute; inset: 0; z-index: 0; filter: blur(70px); opacity: 0.55; }
  .land-blob { position: absolute; border-radius: 50%; will-change: transform; }
  .land-b1 { width: 46vw; height: 46vw; background: #ffd166; left: -8vw; top: -14vw; animation: land-m1 26s ease-in-out infinite alternate; }
  .land-b2 { width: 40vw; height: 40vw; background: #ff6b4a; right: -10vw; top: 30vh; animation: land-m2 32s ease-in-out infinite alternate; opacity: 0.5; }
  .land-b3 { width: 34vw; height: 34vw; background: #b7d9c8; left: 24vw; bottom: -16vw; animation: land-m3 38s ease-in-out infinite alternate; opacity: 0.65; }
  @keyframes land-m1 { to { transform: translate(14vw, 10vh) scale(1.18); } }
  @keyframes land-m2 { to { transform: translate(-12vw, -8vh) scale(0.86); } }
  @keyframes land-m3 { to { transform: translate(10vw, -12vh) scale(1.12); } }
  .land-dust { position: absolute; border-radius: 50%; background: #d9a13f; z-index: 1; animation: land-rise var(--dd) linear infinite; }
  @keyframes land-rise { from { transform: translateY(8vh); } to { transform: translateY(-110vh); } }
  .land-logo { position: absolute; top: 34px; left: 50%; transform: translateX(-50%); z-index: 10;
               font-weight: 700; font-size: 19px; color: #ff6b4a; letter-spacing: -0.5px; }
  .land-page { position: relative; z-index: 5; height: 100vh; display: flex; flex-direction: column;
               align-items: center; justify-content: center; text-align: center; padding: 0 6vw; }
  .land-h1 { font-family: 'Pretendard Variable', Pretendard, -apple-system, 'Segoe UI', 'Noto Sans KR', sans-serif;
             font-weight: 600; font-size: clamp(38px, 5vw, 64px); line-height: ${LINE}; letter-spacing: -1.5px; }
  .land-h1 strong { font-weight: 800; }
  .land-roll { display: inline-flex; vertical-align: bottom; overflow: hidden; height: ${LINE}em; }
  .land-roll ul { list-style: none; padding: 0; margin: 0; will-change: transform;
                  transition: transform 0.65s cubic-bezier(0.72, -0.02, 0.16, 1); }
  .land-roll li { height: ${LINE}em; display: flex; align-items: center; justify-content: center;
                  color: #ff6b4a; font-weight: 800; white-space: nowrap; }
  .land-sub { margin-top: 22px; font-size: 17px; font-weight: 400; line-height: 1.8; color: #8a84a8; letter-spacing: -0.3px; }
  .land-cta { margin-top: 44px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .land-btns { display: flex; gap: 12px; }
  .land-oauth { display: flex; align-items: center; justify-content: center; gap: 9px;
                min-width: 220px; padding: 16px 30px; border-radius: 14px; border: none; cursor: pointer;
                font: inherit; font-weight: 600; font-size: 15px; letter-spacing: -0.3px;
                transition: transform 0.18s ease, box-shadow 0.18s ease; }
  .land-oauth:hover { transform: translateY(-2px); }
  .land-kakao { background: #FEE500; color: #191919; box-shadow: 0 10px 26px rgba(210,170,0,0.28); }
  .land-kakao:hover { box-shadow: 0 15px 34px rgba(210,170,0,0.36); }
  .land-google { background: #ffffff; color: #22224a; border: 1.5px solid #e8e1cf;
                 box-shadow: 0 10px 26px rgba(34,34,74,0.10); }
  .land-google:hover { box-shadow: 0 15px 34px rgba(34,34,74,0.16); }
  .land-hint { color: #8a84a8; font-size: 13px; letter-spacing: -0.2px; }
  @media (prefers-reduced-motion: reduce) { .land-blob, .land-dust { animation: none; } .land-roll ul { transition: none; } }
`

export default function LandingAurora() {
  const { oauth, oauthFailed } = useLandingOAuth()
  const ulRef = useRollingTitles(`${LINE}em`)

  // 먼지 입자 — 위치·크기는 마운트 시 1회만 생성
  const dust = useMemo(() =>
    Array.from({ length: 22 }, (_, i) => ({
      id: i,
      size: 2 + Math.random() * 3,
      left: Math.random() * 100,
      top: 55 + Math.random() * 45,
      duration: 16 + Math.random() * 20,
      delay: -Math.random() * 24,
      opacity: 0.12 + Math.random() * 0.3,
    })), [])

  return (
    <div className="land">
      <style>{CSS}</style>
      <div className="land-bg">
        <div className="land-blob land-b1" /><div className="land-blob land-b2" /><div className="land-blob land-b3" />
      </div>
      {dust.map((d) => (
        <div key={d.id} className="land-dust" style={{
          width: d.size, height: d.size, left: `${d.left}%`, top: `${d.top}%`,
          opacity: d.opacity, animationDelay: `${d.delay}s`, '--dd': `${d.duration}s`,
        } as CSSProperties} />
      ))}
      <span className="land-logo">책추책책추</span>
      <div className="land-page">
        <h1 className="land-h1">
          당신의 다음 한 권은<br />
          <span className="land-roll">
            <ul ref={ulRef}>{[...LANDING_TITLES, LANDING_TITLES[0]].map((t, i) => <li key={i}>{t}</li>)}</ul>
          </span><br />
          일지도 몰라요.
        </h1>
        <p className="land-sub">읽은 책 몇 권이면 충분해요.<br />205만 권 속에서 당신 기준으로, 이유와 함께 골라드릴게요.</p>
        <div className="land-cta">
          <div className="land-btns">
            <button className="land-oauth land-kakao" onClick={() => oauth('kakao')}>
              <span aria-hidden>💬</span> 카카오로 시작하기
            </button>
            <button className="land-oauth land-google" onClick={() => oauth('google')}>
              <span aria-hidden>G</span> Google로 시작하기
            </button>
          </div>
          <span className="land-hint">
            {oauthFailed ? '로그인이 중간에 끊겼어요 — 다시 시도해 주세요' : '가입과 로그인이 하나예요 — 3초면 충분해요'}
          </span>
        </div>
      </div>
    </div>
  )
}
