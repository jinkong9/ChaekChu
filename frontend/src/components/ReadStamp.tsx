import { useId } from 'react'

/** 읽은 책 도장 — 고른 표지 위에 찍히는 원형 인장.
 *  바깥에 LOVE IT · READ IT · RETURN IT 이 한 바퀴 돌고 가운데에 책 무더기가 앉는다.
 *  이미지 대신 선으로 그려 둔 건 표지 위 어느 크기에서도 획이 무너지지 않게 하기 위해서다. */
export default function ReadStamp({ className }: { className?: string }) {
  // 여러 권을 고르면 도장도 여러 개가 뜬다 — 글자가 도는 길의 id 가 겹치지 않게 한다
  const arc = `read-stamp-arc-${useId()}`
  return (
    <svg className={className} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        {/* 12시에서 시작해 시계 방향으로 한 바퀴 — 아래쪽 글자가 뒤집히는 건 둥근 인장의 생김새다 */}
        <path id={arc} fill="none" d="M 50 14 a 36 36 0 1 1 -0.01 0" />
      </defs>

      {/* 표지 위에 얹히므로 종이 한 겹을 깔아 획을 읽히게 한다 */}
      <circle cx="50" cy="50" r="49" fill="#fdfdfb" opacity="0.88" />

      <g fill="none" stroke="currentColor">
        <circle cx="50" cy="50" r="47" strokeWidth="2.8" />
        <circle cx="50" cy="50" r="32.4" strokeWidth="1.8" />
      </g>

      {/* 테두리 글자 — textLength 로 둘레를 꽉 채워 세 낱말이 고르게 벌어진다.
          rotate 는 LOVE IT 을 12시에 맞추려고 준 값이다 */}
      <text
        fill="currentColor"
        fontFamily="var(--eo-font)"
        fontSize="11"
        fontWeight="700"
        letterSpacing="0.3"
        transform="rotate(-20 50 50)"
      >
        <textPath href={`#${arc}`} startOffset="0%" textLength="222" lengthAdjust="spacing">
          LOVE IT · READ IT · RETURN IT ·
        </textPath>
      </text>

      {/* 책 무더기 — 다섯 권을 조금씩 어긋나게 쌓고 검정과 흰 권을 번갈아 둔다 */}
      <g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
        <rect x="35" y="32.4" width="30" height="7.2" rx="1.3" fill="currentColor" />
        <rect x="41.5" y="34.4" width="14" height="3.2" rx="0.7" fill="#fdfdfb" stroke="none" />

        <rect x="33" y="40.1" width="34" height="7.2" rx="1.3" fill="currentColor" />
        <path d="M 38.5 43.7 q 2.6 -2.2 5.2 0 t 5.2 0 t 5.2 0" fill="none" stroke="#fdfdfb" strokeWidth="1.2" />

        {/* 흰 권 한가운데의 잔가지 */}
        <rect x="31.5" y="47.8" width="37" height="7.2" rx="1.3" fill="none" />
        <g strokeWidth="1.2" fill="none">
          <path d="M 44 51.4 h 12" />
          <path d="M 46.4 51.4 q 1.4 -2.4 3.4 -1.4 q -1 2.4 -3.4 1.4 z" />
          <path d="M 53.6 51.4 q -1.4 2.4 -3.4 1.4 q 1 -2.4 3.4 -1.4 z" />
        </g>

        <rect x="33.5" y="55.5" width="33" height="7.2" rx="1.3" fill="currentColor" />
        <rect x="41.5" y="57.5" width="15" height="3.2" rx="0.7" fill="#fdfdfb" stroke="none" />

        <rect x="30.5" y="63.2" width="39" height="7.2" rx="1.3" fill="none" />
        <path d="M 37 66.8 q 2.6 -2.2 5.2 0 t 5.2 0 t 5.2 0" fill="none" strokeWidth="1.2" />

        {/* 책등 쪽 책장 결 */}
        <g strokeWidth="1.2">
          <path d="M 61 34.2 v 3.6 M 63 34.2 v 3.6" />
          <path d="M 63 41.9 v 3.6" />
          <path d="M 35 49.6 v 3.6 M 37 49.6 v 3.6" />
          <path d="M 62.5 57.3 v 3.6" />
          <path d="M 34 65 v 3.6 M 36 65 v 3.6" />
        </g>
      </g>

      {/* 잔별 — 레퍼런스의 반짝임 */}
      <g fill="currentColor">
        <path d="M 24.5 49.5 l 1.6 3.9 3.9 1.6 -3.9 1.6 -1.6 3.9 -1.6 -3.9 -3.9 -1.6 3.9 -1.6 z" />
        <path d="M 76 43.5 l 1.3 3.1 3.1 1.3 -3.1 1.3 -1.3 3.1 -1.3 -3.1 -3.1 -1.3 3.1 -1.3 z" />
        <circle cx="73.5" cy="57" r="1.6" />
        <circle cx="26.5" cy="41" r="1.3" />
      </g>
    </svg>
  )
}
