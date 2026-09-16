import { useLandingOAuth } from './landingShared'
import './landingOku.css'

/** 랜딩 시안 D — Oku의 넓은 여백과 세리프 편집감을 빌리되,
 *  흑백 일러스트·BOOK DNA·추천 이유를 한 편의 지면처럼 보여 준다. */

function BrandMark() {
  return (
    <span className="landing-oku__brand">
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <path d="M5 8.5c4.1.1 7.2 1.6 10 4.4 2.8-2.8 5.9-4.3 10-4.4v14c-4 .1-7 1.1-10 3.5-3-2.4-6-3.4-10-3.5z" />
        <path d="M15 13v13M10 4.5l2 3M20 4.5l-2 3M15 3v4" />
      </svg>
      <span>책추책책추</span>
    </span>
  )
}

export default function LandingOku() {
  const { oauth, oauthFailed } = useLandingOAuth()

  return (
    <div className="landing-oku">
      <header className="landing-oku__header">
        <a className="landing-oku__header-brand" href="#top" aria-label="책추책책추 처음으로">책추책책추</a>
        <nav aria-label="랜딩 페이지 메뉴">
          <a href="#discover">추천 방식</a>
          <a href="#dna">BOOK DNA</a>
          <a href="#promise">우리의 기준</a>
        </nav>
        <button className="landing-oku__header-cta eo-link" onClick={() => oauth('google')}>로그인</button>
      </header>

      <main id="top">
        <section className="landing-oku__hero" aria-labelledby="landing-oku-title">
          <div className="landing-oku__hero-copy">
            <p className="landing-oku__eyebrow"><span /> 2,050,000권에서 찾는 한 권</p>
            <h1 id="landing-oku-title">당신의 책장은<br />다음 책을 알고 있어요.</h1>
            <p className="landing-oku__lead">
              읽은 책 몇 권만 알려주세요. 취향을 문장으로 읽고,<br className="landing-oku__desktop-break" />
              지금의 당신에게 맞는 책과 그 이유를 건넬게요.
            </p>
            <div className="landing-oku__actions">
              <button className="landing-oku__primary" onClick={() => oauth('kakao')}>카카오로 시작하기 <span aria-hidden>↗</span></button>
              <button className="landing-oku__secondary" onClick={() => oauth('google')}>Google로 시작하기</button>
            </div>
            <p className={`landing-oku__auth-note${oauthFailed ? ' is-error' : ''}`} role={oauthFailed ? 'alert' : undefined}>
              {oauthFailed ? '로그인이 중간에 끊겼어요. 다시 시도해 주세요.' : '가입과 로그인이 한 번에 · 무료로 시작해요'}
            </p>
          </div>

          <div className="landing-oku__hero-art">
            <img
              className="landing-oku__reader"
              src="/images/landing-shelf-reader.png"
              alt="책이 가득한 선반에서 한 권을 꺼내는 독자"
            />
            <p className="landing-oku__art-caption"><span>YOUR SHELF KNOWS</span><b>다음 한 권을 꺼내 보세요</b></p>
          </div>
          <a className="landing-oku__scroll" href="#discover">아래로 읽기 <span aria-hidden>↓</span></a>
        </section>

        <section className="landing-oku__statement" id="discover">
          <p>좋아했던 책에는<br />당신만의 기준이 남아 있으니까.</p>
          <span>표지보다 취향을 먼저 읽는 추천</span>
        </section>

        <section className="landing-oku__feature landing-oku__feature--shelf" aria-labelledby="landing-discover-title">
          <div className="landing-oku__feature-copy">
            <span className="landing-oku__number">01</span>
            <h2 id="landing-discover-title">읽은 책을 고르면,<br />취향의 결이 보여요.</h2>
            <p>완독한 책과 남긴 별점을 따라 장르, 분위기, 문체의 선호를 차분히 읽어요. 긴 설문도 정답도 필요 없어요.</p>
            <span className="landing-oku__microcopy">SELECT YOUR BOOKS · BUILD YOUR TASTE</span>
          </div>
          <div className="landing-oku__taste-map" aria-label="독서 취향을 구성하는 요소">
            <span className="landing-oku__taste-center"><small>MY READING</small><b>취향의 결</b></span>
            <span>고요한 문장</span>
            <span>낯선 세계</span>
            <span>느린 호흡</span>
            <span>내면의 성장</span>
            <span>선명한 인물</span>
            <span>긴 여운</span>
          </div>
        </section>

        <section className="landing-oku__feature landing-oku__feature--dna" id="dna" aria-labelledby="landing-dna-title">
          <div className="landing-oku__dna-card" aria-label="BOOK DNA 취향 분석 예시">
            <header><BrandMark /><span>BOOK DNA / 2026</span></header>
            <p>YOUR READING PROFILE</p>
            <h3>고요한 세계를<br />오래 바라보는 독자</h3>
            <div className="landing-oku__dna-bars">
              <span><i style={{ width: '86%' }} />사유의 깊이 <b>86</b></span>
              <span><i style={{ width: '72%' }} />문장의 밀도 <b>72</b></span>
              <span><i style={{ width: '64%' }} />낯선 세계 <b>64</b></span>
            </div>
            <footer><span>#내면의성장</span><span>#섬세한문장</span><span>#느린호흡</span></footer>
          </div>
          <div className="landing-oku__feature-copy">
            <span className="landing-oku__number">02</span>
            <h2 id="landing-dna-title">취향을 숫자가 아닌<br />당신의 언어로.</h2>
            <p>BOOK DNA는 읽은 책 사이의 공통점을 찾아, 내가 왜 이 책들을 좋아했는지 한 장의 리포트로 보여줘요.</p>
            <a href="#promise">추천의 기준 보기 <span aria-hidden>→</span></a>
          </div>
        </section>

        <section className="landing-oku__promise" id="promise" aria-labelledby="landing-promise-title">
          <div className="landing-oku__promise-head">
            <p>03 · THE NEXT BOOK</p>
            <h2 id="landing-promise-title">다음 한 권에는<br />납득할 이유까지.</h2>
          </div>
          <div className="landing-oku__promise-list">
            <article><span>01</span><h3>당신의 기록에서 시작해요</h3><p>유행보다 실제로 읽고 좋아한 책을 먼저 봅니다.</p></article>
            <article><span>02</span><h3>추천한 이유를 숨기지 않아요</h3><p>취향과 책이 만나는 지점을 짧고 선명하게 설명합니다.</p></article>
            <article><span>03</span><h3>고를수록 더 정교해져요</h3><p>선택과 평가가 쌓일수록 추천은 당신의 언어에 가까워집니다.</p></article>
          </div>
        </section>

        <section className="landing-oku__closing" aria-labelledby="landing-closing-title">
          <p>한 권을 고르는 일이 조금 더 설레도록</p>
          <h2 id="landing-closing-title">당신의 다음 책을<br />함께 찾을까요?</h2>
          <button className="landing-oku__primary" onClick={() => oauth('kakao')}>내 취향으로 시작하기 <span aria-hidden>↗</span></button>
        </section>
      </main>

      <footer className="landing-oku__footer"><BrandMark /><p>당신의 취향에서 시작하는 책 추천</p><span>© 2026 책추책책추</span></footer>
    </div>
  )
}
