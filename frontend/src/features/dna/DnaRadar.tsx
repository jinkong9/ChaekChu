/** 장르 레이더 — 리포트의 두 본문 안(지금 안·새 안)이 같은 도형을 쓴다.
 *  그래서 한 곳에 두고 양쪽이 불러 쓴다. 안이 갈려도 도형은 갈리지 않아야 비교가 된다. */
import type { DnaProfile } from './dnaProfile'

const RADAR_SIZE = 250
const RADAR_R = 62

function radarPoint(i: number, count: number, r: number) {
  const a = (Math.PI * 2 * i) / count - Math.PI / 2
  return [RADAR_SIZE / 2 + Math.cos(a) * r, RADAR_SIZE / 2 + Math.sin(a) * r] as const
}

/** 서버 axes 는 여섯 축의 합이 100 이 되게 정규화된 '지분'이다(계약 §4.4). 100 을 꽉 찬 반지름으로 삼으면
 *  고르게 읽는 사람은 반지름 17%짜리 바늘이 되어 도형이 아무 말도 하지 못한다.
 *  그래서 모양은 1위 축을 테두리에 두고 그 비율로 그리고, 숫자는 실제 지분 %로 적는다 —
 *  모양은 균형을, 숫자는 크기를 말하게 나눈다. */
export default function Radar({ axes, tone }: { axes: DnaProfile['axes']; tone?: string }) {
  const n = axes.length
  const peak = Math.max(...axes.map((a) => a.value), 1)
  const ring = (r: number) =>
    axes.map((_, i) => radarPoint(i, n, r).map((v) => v.toFixed(1)).join(',')).join(' ')
  const shape = axes
    .map((a, i) => radarPoint(i, n, (a.value / peak) * RADAR_R).map((v) => v.toFixed(1)).join(','))
    .join(' ')

  return (
    <svg
      className="dnar-radar"
      viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
      role="img"
      aria-label={`장르 지분 — ${axes.map((a) => `${a.label} ${a.value}%`).join(', ')}`}
    >
      {[0.34, 0.67, 1].map((k) => (
        <polygon key={k} className="dnar-radar__grid" points={ring(RADAR_R * k)} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = radarPoint(i, n, RADAR_R)
        return <line key={a.label} className="dnar-radar__spoke" x1={RADAR_SIZE / 2} y1={RADAR_SIZE / 2} x2={x} y2={y} />
      })}
      <polygon className="dnar-radar__shape" points={shape} style={tone ? { ['--tone' as string]: tone } : undefined} />
      {axes.map((a, i) => {
        const [x, y] = radarPoint(i, n, RADAR_R + 22)
        // 위·아래 꼭짓점은 가운데 정렬, 옆면은 도형 바깥쪽으로 밀어 낸다
        const anchor = i === 0 || i === n / 2 ? 'middle' : x > RADAR_SIZE / 2 ? 'start' : 'end'
        return (
          <text key={a.label} x={x} y={y} textAnchor={anchor} className="dnar-radar__label">
            <tspan>{a.label}</tspan>
            <tspan className="dnar-radar__value" x={x} dy="12">
              {a.value}%
            </tspan>
          </text>
        )
      })}
    </svg>
  )
}
