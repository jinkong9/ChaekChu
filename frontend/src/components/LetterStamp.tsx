import LibrarySeal from './LibrarySeal'
import { Perforated } from './Stamp'

/** 사연 우표 — 추천 이유를 우표와 같은 판형(5:7)의 손글씨 엽서로 만든 것.
 *  추천 화면에서 표지 우표와 나란히 폴더 밖으로 미끄러져 나온다.
 *  폴더에서 옆으로 빠져나와야 해서 가로가 아닌 세로 판형이다. */

const PAPER = '#eeede2'
const INK = '#0b0b0b'

export default function LetterStamp({ reason, to, width = 230, notch }: {
  reason: string
  /** 인사말의 수신인 — 없으면 '독자' */
  to?: string | null
  width?: number
  notch?: string
}) {
  const pad = width * 0.065
  const line = width * 0.068   // 좁은 세로 엽서에서도 사연이 충분히 들어가는 손글씨 크기

  return (
    <Perforated width={width} notch={notch} frame={PAPER}>
      <div className="relative flex flex-col paper-grain"
        style={{
          aspectRatio: '5 / 7', color: INK, padding: pad,
          backgroundColor: PAPER,
          // 바랜 카드지 — 중앙은 밝고 모서리는 오래 눌린 듯 미세하게 누렇게 만든다.
          backgroundImage:
            'radial-gradient(120% 95% at 48% 38%, rgba(255,255,255,.58), transparent 62%),' +
            'radial-gradient(75% 55% at 4% 100%, rgba(135,107,61,.12), transparent 72%),' +
            'linear-gradient(102deg, rgba(33,48,73,.025), transparent 22%, rgba(150,125,77,.05) 100%)',
        }}>
        {/* 오래된 엽서의 얇은 이중 재단선 */}
        <div className="absolute pointer-events-none" style={{ inset: pad * 0.42, border: `1px solid ${INK}42` }} />
        <div className="absolute pointer-events-none" style={{ inset: pad * 0.67, border: `1px solid ${INK}18` }} />

        {/* 인쇄 헤더 — 레퍼런스의 POSTCARD 타이포와 작은 제작 표기 */}
        <div className="relative z-10 flex items-end justify-between" style={{ padding: `0 ${pad * 0.25}px ${pad * 0.7}px` }}>
          <div>
            <p className="font-medium leading-none" style={{ fontSize: width * 0.082, letterSpacing: '0.08em' }}>POSTCARD</p>
            <p className="uppercase" style={{ fontSize: width * 0.025, letterSpacing: '0.16em', marginTop: width * 0.018 }}>a book chosen for you</p>
          </div>
          {/* 보낸 이 표기는 글자 대신 장서인으로 — 엽서 우측 상단에 찍힌 도장 */}
          <LibrarySeal className="shrink-0" style={{ width: width * 0.22, height: width * 0.22, color: INK, opacity: 0.86 }} />
        </div>

        <div className="relative z-10 flex flex-1 min-h-0 flex-col" style={{ borderTop: `1px solid ${INK}62` }}>
          {/* 추천 이유가 카드 전체 폭을 사용하도록 펼쳐 줄바꿈과 시선 이동을 줄인다. */}
          <div className="flex min-h-0 flex-1 flex-col" style={{ padding: `${pad * 0.82}px ${pad * 0.7}px ${pad * 0.55}px ${pad * 0.3}px` }}>
            <p className="font-hand" style={{ fontSize: line, lineHeight: 1.5 }}>{to ?? '독자'}님께,</p>
            <p className="font-hand" style={{ fontSize: line, lineHeight: 1.52, marginTop: line * 0.36 }}>{reason}</p>
            <p className="font-hand mt-auto self-end" style={{ fontSize: line * 0.68, opacity: 0.78 }}>책추책책추 드림</p>
          </div>

        </div>
      </div>
    </Perforated>
  )
}
