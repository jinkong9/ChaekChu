import type { ReactNode } from 'react'
import { motion } from 'motion/react'

/** 우표첩 — 앞판이 왼쪽 모서리를 축으로 열리고, 안에 든 것들이 오른쪽으로 계단식으로 미끄러져 나온다.
 *  z축은 안쪽 바닥 < 내용물 < 앞판 순서로 고정한다: 닫혀 있으면 내용물이 앞판에 완전히 가려지고,
 *  열리면 앞판 오른쪽 밖으로 빠져나온 만큼만 보인다. (추천 C안 전용) */

export interface FolderSlot {
  key: string
  node: ReactNode
  /** 열렸을 때 오른쪽으로 밀려나는 거리(px) */
  out: number
  /** 열렸을 때의 기울기(deg) — 손으로 꺼낸 듯 조금씩 어긋나게 */
  tilt?: number
  top?: number
  left?: number
}

export default function StampFolder({
  open, width, height, label, sub, color = '#ffd166', shade = '#e9b73c', slots, className = '',
}: {
  open: boolean
  width: number
  height: number
  label: string
  sub?: string
  color?: string
  /** 앞판보다 어두운 안쪽 바닥 색 */
  shade?: string
  slots: FolderSlot[]
  className?: string
}) {
  const spring = { type: 'spring', stiffness: 170, damping: 22 } as const

  return (
    <div className={`relative ${className}`} style={{ width, height, perspective: 1400 }}>
      {/* 안쪽 바닥 — 앞판보다 위로 조금 더 나와 '무언가 들어 있는 두께'를 만든다 */}
      <div className="absolute rounded-xl" style={{ left: 0, right: 0, top: -7, bottom: 0, background: shade }} />
      {/* 안에 든 종이의 끝 — 닫혀 있어도 비어 있지 않다는 표시. 열리면 진짜 내용물이 나오므로 사라진다 */}
      <motion.div className="absolute rounded-t-sm"
        style={{ left: width * 0.09, right: width * 0.09, top: -12, height: 14, background: '#fffdf6', boxShadow: '0 -1px 0 rgba(34,34,74,0.12) inset' }}
        initial={false} animate={{ opacity: open ? 0 : 1 }} transition={{ duration: 0.18 }} />

      {slots.map((s, i) => (
        <motion.div key={s.key} className="absolute"
          style={{ left: s.left ?? 12, top: s.top ?? 10, zIndex: 10 + i }}
          initial={false}
          animate={{ x: open ? s.out : 0, rotate: open ? (s.tilt ?? 0) : 0 }}
          transition={{ ...spring, delay: open ? 0.06 + i * 0.07 : i * 0.03 }}>
          {s.node}
        </motion.div>
      ))}

      {/* 앞판 — 왼쪽 모서리를 축으로 열린다 */}
      <motion.div className="absolute inset-0 rounded-xl overflow-hidden"
        style={{
          zIndex: 20, transformOrigin: 'left center', transformStyle: 'preserve-3d',
          background: `linear-gradient(105deg, ${color} 62%, ${shade} 100%)`,
        }}
        initial={false}
        animate={{ rotateY: open ? -34 : 0, boxShadow: open ? '10px 12px 26px -10px rgba(34,34,74,0.45)' : '3px 5px 14px -8px rgba(34,34,74,0.4)' }}
        transition={spring}>
        <div className="absolute left-0 right-0" style={{ bottom: height * 0.16, paddingLeft: width * 0.11 }}>
          <p className="font-hand leading-none" style={{ fontSize: width * 0.125, color: '#22224a' }}>{label}</p>
          {sub && <p className="mt-1.5 leading-none" style={{ fontSize: width * 0.055, color: '#22224a', opacity: 0.5 }}>{sub}</p>}
        </div>
        {/* 앞판 아래 인쇄선 두 줄 */}
        <div className="absolute" style={{ left: width * 0.11, right: width * 0.11, bottom: height * 0.1, height: 1, background: 'rgba(34,34,74,0.13)' }} />
        <div className="absolute" style={{ left: width * 0.11, right: width * 0.11, bottom: height * 0.06, height: 1, background: 'rgba(34,34,74,0.13)' }} />
      </motion.div>
    </div>
  )
}
