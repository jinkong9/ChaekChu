import { Perforated } from './Postcard'

/** 사연 우표 — 추천 이유를 우표와 같은 판형(5:7)의 손글씨 엽서로 만든 것.
 *  추천 C안(우표첩)에서 표지 우표와 나란히 폴더 밖으로 미끄러져 나온다.
 *  가로 엽서(Postcard)는 B안 전용 — 폴더에서 옆으로 빠져나오려면 세로 판형이어야 줄이 맞는다. */

const PAPER = '#f6f1e3'
const INK = '#2b3a86'

export default function LetterStamp({ reason, to, postmark, rank, width = 230, notch }: {
  reason: string
  /** 인사말의 수신인 — 없으면 '독자' */
  to?: string | null
  /** 소인(날짜 도장)에 찍을 문구 */
  postmark?: string
  /** 우표의 액면가 자리에 찍는 순위 */
  rank?: number
  width?: number
  notch?: string
}) {
  const pad = width * 0.075
  const line = width * 0.078   // 손글씨 크기

  return (
    <Perforated width={width} notch={notch} frame={PAPER}>
      <div className="relative flex flex-col"
        style={{
          aspectRatio: '5 / 7', color: INK, padding: pad,
          // 오래된 종이 — 미세한 얼룩 두 겹으로 균일한 색면을 깬다
          backgroundImage:
            'radial-gradient(120% 90% at 12% 8%, rgba(255,255,255,0.55), transparent 60%),' +
            'radial-gradient(80% 70% at 92% 96%, rgba(160,132,80,0.13), transparent 70%)',
        }}>
        {/* 우표 안쪽 인쇄선 */}
        <div className="absolute pointer-events-none" style={{ inset: pad * 0.55, border: `1px solid ${INK}2e` }} />

        {/* 소인 — 종이 오른쪽 위에 비스듬히. 글줄과 겹치되 흐려서 읽기를 방해하지 않는다 */}
        {postmark && (
          <div className="absolute flex items-center justify-center rounded-full pointer-events-none"
            style={{
              right: pad * 0.8, top: pad * 0.8,
              width: width * 0.19, height: width * 0.19, border: `${Math.max(1.5, width * 0.008)}px solid ${INK}`,
              opacity: 0.32, transform: 'rotate(-12deg)',
            }}>
            <span className="font-hand leading-none" style={{ fontSize: width * 0.042 }}>{postmark}</span>
          </div>
        )}

        <p className="font-hand" style={{ fontSize: line, lineHeight: 1.5 }}>
          {to ?? '독자'}님께,
        </p>
        <p className="font-hand" style={{ fontSize: line, lineHeight: 1.5, marginTop: line * 0.35 }}>
          {reason}
        </p>

        <div className="mt-auto flex items-end justify-between" style={{ paddingTop: line * 0.4 }}>
          {/* 액면가 자리 = 오늘의 순위 */}
          <span className="font-hand leading-none" style={{ fontSize: line * 1.25 }}>
            No.{rank ?? 1}
          </span>
          <span className="font-hand leading-none" style={{ fontSize: line * 0.68, opacity: 0.72 }}>책추책책추 드림</span>
        </div>
      </div>
    </Perforated>
  )
}
