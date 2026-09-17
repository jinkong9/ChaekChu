/** 뽑기 기계 — 가챠의 첫 화면.
 *
 *  "완전 랜덤"이라는 말만 적어 두고 버튼 하나를 두면 그냥 버튼이다. 손잡이가 있는 기계를
 *  세워 두면 누르기 전에 이미 뽑는 일이 시작된다. 그래서 이 그림이 곧 버튼이다.
 *
 *  사진이나 3D 렌더가 아니라 선으로 그린다(DESIGN.md: 종이와 잉크, 색은 표지가 담당).
 *  유리구를 채우는 색은 이 화면에서도 표지에서 온다 — 캡슐 안의 작은 책이 실제 후보 열넉 권이다. */
import { coverAtWidth } from '../../lib/coverUrl'

/** 캡슐 자리 — 유리구(중심 160,150 · 반지름 90) 안에 다섯 줄로 눕힌다.
 *  줄마다 담기는 수가 달라야 병에 쏟아 넣은 것처럼 보인다. 중심에서 67 을 넘지 않아야 캡슐이 유리를 뚫지 않는다. */
const SLOTS: [number, number][] = [
  [124, 110], [196, 110],
  [104, 132], [156, 132], [208, 132],
  [98, 158], [144, 158], [190, 158], [224, 158],
  [112, 184], [160, 184], [208, 184],
  [138, 208], [184, 208],
]
/** 캡슐 반지름과 그 안에 든 책의 크기 — 대각선이 지름을 넘지 않아야 책이 캡슐 밖으로 나오지 않는다 */
const CAP_R = 23
const BOOK_W = 24
const BOOK_H = 33

export default function GachaMachine({ covers, onPull, disabled }: { covers: string[]; onPull: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="dnar-machine" onClick={onPull} disabled={disabled} aria-label="손잡이를 돌려 한 권 뽑기">
      <svg viewBox="0 0 320 392" role="img" aria-hidden="true">
        {/* 명판과 그것을 뚜껑에 붙드는 목 */}
        <g className="dnar-machine__plate">
          <rect className="dnar-machine__shell" x="150" y="38" width="20" height="24" />
          <rect x="96" y="16" width="128" height="26" rx="4" />
          <circle cx="104" cy="29" r="1.4" className="dnar-machine__screw" />
          <circle cx="216" cy="29" r="1.4" className="dnar-machine__screw" />
          <text x="160" y="33.5" textAnchor="middle">RANDOM BOOK</text>
        </g>

        {/* 유리구 */}
        <circle className="dnar-machine__glass" cx="160" cy="150" r="90" />

        {/* 캡슐 — 안에 든 작은 책이 오늘의 후보들이다 */}
        {SLOTS.map(([cx, cy], i) => {
          const cover = covers[i % Math.max(1, covers.length)]
          return (
            <g key={`${cx}-${cy}`}>
              <circle className="dnar-machine__capsule" cx={cx} cy={cy} r={CAP_R} />
              {cover && (
                <image
                  href={coverAtWidth(cover, BOOK_W) ?? cover}
                  x={cx - BOOK_W / 2}
                  y={cy - BOOK_H / 2}
                  width={BOOK_W}
                  height={BOOK_H}
                  preserveAspectRatio="xMidYMid slice"
                  opacity="0.88"
                />
              )}
              <circle className="dnar-machine__capsule-edge" cx={cx} cy={cy} r={CAP_R} />
              {/* 유리에 비친 빛 한 줄 */}
              <path className="dnar-machine__gleam" d={`M${cx - 15} ${cy - 11}a19 19 0 0 1 11-7`} />
            </g>
          )
        })}
        {/* 유리구 전체에 도는 빛 */}
        <path className="dnar-machine__gleam" d="M100 120a74 74 0 0 1 36-30" />

        {/* 뚜껑 — 캡슐보다 나중에 그려 유리구의 정수리를 덮는다 */}
        <path className="dnar-machine__shell" d="M91 92a90 90 0 0 1 138 0z" />
        <rect className="dnar-machine__shell" x="89" y="87" width="142" height="9" rx="4.5" />

        {/* 몸통 */}
        <path className="dnar-machine__shell" d="M128 232h64v20h-64z" />
        <path className="dnar-machine__shell" d="M85 252h150l13 118H72z" />
        <rect className="dnar-machine__shell" x="66" y="370" width="188" height="16" rx="4" />

        {/* 손잡이 둘레의 안내 — 기계에 새겨진 문구 */}
        <path id="dnar-twist" fill="none" d="M120 300a40 40 0 0 1 80 0" />
        <text className="dnar-machine__engrave">
          <textPath href="#dnar-twist" startOffset="50%" textAnchor="middle">
            TWIST FOR A NEW STORY
          </textPath>
        </text>

        {/* 손잡이 — 누르면 돌아간다 */}
        <g className="dnar-machine__knob">
          <circle className="dnar-machine__knob-face" cx="160" cy="300" r="21" />
          <rect className="dnar-machine__knob-grip" x="145" y="297" width="30" height="6" rx="3" />
        </g>
        <path className="dnar-machine__arrow" d="M127 289a26 26 0 0 0-2 12" />
        <path className="dnar-machine__arrow" d="M193 289a26 26 0 0 1 2 12" />

        {/* 배출구 — 이미 한 알이 떨어져 있다 */}
        <rect className="dnar-machine__slot" x="132" y="332" width="56" height="28" rx="3" />
        <circle className="dnar-machine__capsule" cx="160" cy="346" r="10" />
        <circle className="dnar-machine__capsule-edge" cx="160" cy="346" r="10" />
      </svg>
    </button>
  )
}
