import type { CSSProperties } from 'react'

/** 장서인 — 책 무더기 위로 「책추책책추」가 서는 원형 인장.
 *  추천 엽서 우측 상단에 찍힌다. 「읽은 책」 도장(ReadStamp)과는 다른 판이다 —
 *  저쪽은 고른 표지에 찍는 확인 도장이고, 이쪽은 보낸 이를 밝히는 장서인이다.
 *  이미지 대신 선으로 그린 건 작게 찍혀도 획이 뭉개지지 않게 하기 위해서다. */
export default function LibrarySeal({ className, style }: { className?: string; style?: CSSProperties }) {
  /** 네 갈래 반짝임 — 꼭짓점 사이가 안으로 패인 별 */
  const star = (cx: number, cy: number, r: number) =>
    `M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`

  return (
    <svg className={className} style={style} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="46.6" fill="none" stroke="currentColor" strokeWidth="2.2" />

      {/* 보낸 이 — 테두리를 돌지 않고 아래쪽에 바로 세워 읽히게 둔다 */}
      <text x="50" y="80" fill="currentColor" textAnchor="middle"
        fontFamily="var(--eo-font)" fontSize="12.5" fontWeight="700" letterSpacing="0.2">책추책책추</text>

      {/* 테두리 글자를 걷어낸 만큼 그림을 조금 키우고 위로 올려 원 한가운데에 앉힌다 */}
      <g transform="translate(50 48) scale(1.08) translate(-50 -53)">
      {/* 책 무더기 — 다섯 권을 어긋나게 쌓고, 넷째 권만 검정으로 눌러 무게를 준다 */}
      <g stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <rect x="36" y="30.5" width="29" height="7" rx="1.2" />
        <rect x="42.5" y="32.4" width="16" height="3.2" rx="0.6" strokeWidth="1.1" />

        <rect x="33.5" y="37.5" width="33" height="7" rx="1.2" />
        <path d="M 39 41 q 2.5 -2.1 5 0 t 5 0 t 5 0" strokeWidth="1.1" />

        {/* 셋째 권 한가운데의 잔가지 */}
        <rect x="35.5" y="44.5" width="31" height="7" rx="1.2" />
        <g strokeWidth="1.1">
          <path d="M 44.5 48 h 11" />
          <path d="M 46.8 48 q 1.4 -2.3 3.3 -1.3 q -1 2.3 -3.3 1.3 z" />
          <path d="M 53.2 48 q -1.4 2.3 -3.3 1.3 q 1 -2.3 3.3 -1.3 z" />
        </g>

        <rect x="32.5" y="51.5" width="35" height="7" rx="1.2" fill="currentColor" />
        <rect x="40.5" y="53.4" width="19" height="3.2" rx="0.6" fill="#fdfdfb" stroke="#fdfdfb" strokeWidth="1.1" />

        <rect x="30.5" y="58.5" width="38" height="7" rx="1.2" />
        <path d="M 37.5 62 q 2.5 -2.1 5 0 t 5 0 t 5 0" strokeWidth="1.1" />

        {/* 책등 반대쪽에 보이는 책장 결 */}
        <g strokeWidth="1.05">
          <path d="M 61 32.2 v 3.6 M 62.8 32.2 v 3.6" />
          <path d="M 62.5 39.2 v 3.6 M 64.3 39.2 v 3.6" />
          <path d="M 62.5 46.2 v 3.6" />
          <path d="M 37 53.2 v 3.6 M 38.8 53.2 v 3.6" />
          <path d="M 64.5 60.2 v 3.6 M 66.3 60.2 v 3.6" />
        </g>
      </g>

      {/* 반짝임과 점 — 테두리 글자와 아래 이름 사이를 띄우는 구실도 한다 */}
      <g fill="currentColor">
        <path d={star(71.5, 27.5, 4.2)} />
        <path d={star(29.5, 42.5, 3.4)} />
        <path d={star(73.5, 52.5, 2.8)} />
        <circle cx="15.5" cy="55" r="1.9" />
        <circle cx="84.5" cy="55" r="1.9" />
        <circle cx="65.5" cy="30.5" r="1.2" />
        <circle cx="26.5" cy="49.5" r="1.2" />
      </g>
      </g>
    </svg>
  )
}
