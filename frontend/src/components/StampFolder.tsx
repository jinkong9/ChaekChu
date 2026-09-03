import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { glassine, GLASS_LINE } from '../lib/glassine'

/** 우표첩 — 오른쪽 접합부가 살짝 벌어지고, 안에 든 것들이 그 틈으로 계단식으로 미끄러져 나온다.
 *  z축은 안쪽 바닥 < 내용물 < 앞판 순서로 고정한다: 닫혀 있으면 내용물이 앞판 너머로 흐릿하게만 비치고,
 *  열리면 앞판 오른쪽 밖으로 빠져나온 만큼이 또렷해진다. (추천 화면 전용) */

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
  open, width, height, label, sub, slots, className = '',
}: {
  open: boolean
  width: number
  height: number
  label: string
  sub?: string
  slots: FolderSlot[]
  className?: string
}) {
  const spring = { type: 'spring', stiffness: 170, damping: 22 } as const
  const ring = `0 0 0 1px ${GLASS_LINE} inset`
  // 몸통은 좌우가 같은 직선 — 오른쪽 어깨를 왼쪽처럼 곧게 폈다.
  // 모양의 재미는 덮개가 맡고, 몸통은 반듯한 슬리브로 둔다.
  const sideMouth = `polygon(0 0, 100% 0, 100% 100%, 0 100%)`

  const FLAP_R = 0.3   // 덮개 폭 / 봉투 폭
  const FLAP_SHAPE = 'polygon(0 0, 76% 0, 94% 5%, 100% 9%, 100% 91%, 94% 95%, 76% 100%, 0 100%)'
  const FLAP_PATH = 'M0 0 L76 0 L94 5 L100 9 L100 91 L94 95 L76 100 L0 100'

  return (
    <div className={`relative ${className}`} style={{ width, height, perspective: 1400 }}>
      {/* 뒤판 — 레퍼런스처럼 어깨가 사선으로 꺾이는 보관 봉투 실루엣 */}
      <div className="absolute"
        style={{ left: 0, right: 0, top: 0, bottom: 0, clipPath: sideMouth, ...glassine(0.52, 1.5), boxShadow: ring }} />

      {slots.map((s, i) => (
        <motion.div key={s.key} className="absolute"
          style={{ left: s.left ?? 12, top: s.top ?? 10, zIndex: 10 + i }}
          initial={false}
          animate={{ x: open ? s.out : 0, rotate: open ? (s.tilt ?? 0) : 0, filter: open ? 'blur(0px)' : 'blur(3px)' }}
          transition={{ ...spring, delay: open ? 0.25 + i * 0.09 : i * 0.03 }}>
          {s.node}
        </motion.div>
      ))}

      {/* 앞판 — 두 겹의 유산지를 겹쳐 재질의 밀도와 접합선을 만든다. */}
      <motion.div className="absolute inset-0 overflow-hidden"
        style={{
          zIndex: 20,
          clipPath: sideMouth,
          ...glassine(0.46, 2.4),
        }}
        initial={false}
        animate={{
          boxShadow: open ? `4px 8px 20px -10px rgba(34,34,74,0.28), ${ring}` : `3px 5px 14px -8px rgba(34,34,74,0.26), ${ring}`,
        }}
        transition={spring}>
        {/* 열접착된 좌우/하단 띠 — 레퍼런스의 하얗게 겹친 모서리 */}
        <div className="absolute bottom-0 left-0 top-0" style={{ width: width * 0.075, background: 'linear-gradient(90deg, rgba(255,255,255,.52), rgba(230,233,235,.18))', borderRight: `1px solid rgba(255,255,255,.5)` }} />
        <div className="absolute bottom-0 left-0 right-0" style={{ height: height * 0.065, background: 'linear-gradient(0deg, rgba(255,255,255,.52), rgba(230,233,235,.12))', borderTop: `1px solid rgba(255,255,255,.48)` }} />
        <div className="absolute left-0 right-0 top-0" style={{ height: height * 0.065, background: 'linear-gradient(180deg, rgba(255,255,255,.52), rgba(230,233,235,.12))', borderBottom: `1px solid rgba(255,255,255,.48)` }} />

        {/* 접힌 모서리의 삼각 겹침 */}
        <div className="absolute left-0 top-0" style={{ width: width * 0.16, height: height * 0.2, background: 'rgba(255,255,255,.24)', clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />

        <div className="absolute left-0 right-0" style={{ bottom: height * 0.16, paddingLeft: width * 0.11 }}>
          <p className="font-hand leading-none" style={{ fontSize: width * 0.125, color: '#22224a' }}>{label}</p>
          {sub && <p className="mt-1.5 leading-none" style={{ fontSize: width * 0.055, color: '#22224a', opacity: 0.5 }}>{sub}</p>}
        </div>
        {/* 앞판 아래 인쇄선 두 줄 */}
        <div className="absolute" style={{ left: width * 0.11, right: width * 0.11, bottom: height * 0.1, height: 1, background: GLASS_LINE }} />
        <div className="absolute" style={{ left: width * 0.11, right: width * 0.11, bottom: height * 0.06, height: 1, background: GLASS_LINE }} />
      </motion.div>

      {/* 젖혀진 덮개가 몸통에 드리우는 그늘 — 덮개가 '들렸다'를 몸통 쪽에서도 보여 준다 */}
      <motion.div className="absolute z-[21] pointer-events-none"
        style={{ right: 0, top: 0, width: width * 0.34, height, clipPath: sideMouth,
          background: 'linear-gradient(270deg, rgba(34,34,74,.16), rgba(34,34,74,0) 70%)' }}
        initial={false} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.3 }} />

      {/* 접힌 골 — 열리면 몸통과 덮개 사이에 그늘이 진다. 두 장이 한 장에서 꺾였다는 표시다 */}
      <motion.div className="absolute z-[23] pointer-events-none"
        style={{ right: -1, top: height * 0.07, bottom: height * 0.07, width: 4,
          background: 'linear-gradient(90deg, rgba(34,34,74,.26), rgba(34,34,74,.04))' }}
        initial={false} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.25 }} />

      {/* 오른쪽 덮개 — 봉투를 뜯듯 왼쪽에서 오른쪽으로 젖혀지고, 그 틈으로 우표가 빠져나온다.
       *  경첩은 봉투의 오른쪽 모서리(transformOrigin: right)다. 안쪽 모서리를 축으로 잡으면
       *  아무리 돌려도 자유단이 축보다 오른쪽으로 나갈 수 없어 '접히는' 그림이 된다.
       *  -180도로 완전히 넘겨 덮개가 봉투 오른쪽에 좌우반전된 채로 펼쳐 눕는다.
       *  눕은 반투명 종이는 흰 배경과 색으로는 구분되지 않으므로 외곽선·면 결·그림자로 세운다.
       *  z는 열린 뒤 우표 아래로 내린다 — 봉투에서 나온 우표가 펼쳐진 덮개 위를 지나야 한다.
       *  다만 젖혀지는 동안 내리면 앞판 뒤로 사라지므로, 덮개가 몸통을 벗어난 뒤에 바꾼다. */}
      <motion.div className="absolute"
        style={{
          right: 0, top: 0, width: width * FLAP_R, height,
          transformOrigin: 'right center', transformStyle: 'preserve-3d',
        }}
        initial={false}
        animate={{ rotateY: open ? -180 : 0, zIndex: open ? 6 : 22 }}
        transition={{
          rotateY: { type: 'spring', stiffness: 150, damping: 18 },
          zIndex: { delay: open ? 0.24 : 0, duration: 0 },
        }}>
        {/* 덮개 겉면 전체를 좌우로 뒤집는다 — 회전(rotateY)과 별개의 층이라
            닫힘·열림 두 상태에 같은 반전이 그대로 걸린다. 모양·인장·밝은 선이 함께 뒤집힌다. */}
        <div className="absolute inset-0" style={{ transform: 'scaleX(-1)' }}>
          <motion.div className="absolute inset-0"
            initial={false}
            // 그림자는 상자가 아니라 잘라 낸 실루엣을 따라야 해서 box-shadow가 아닌 drop-shadow를 쓴다
            // 젖혀지면 요소가 뒤집혀 좌우 오프셋도 같이 뒤집히므로, 열린 그림자는 아래로만 떨군다
            animate={{ filter: open ? 'drop-shadow(0 10px 12px rgba(34,34,74,.22))' : 'drop-shadow(1px 0 0 rgba(34,34,74,.1))' }}
            transition={{ duration: 0.3 }}>
            {/* 종이 재질 */}
            <div className="absolute inset-0"
              style={{
                clipPath: FLAP_SHAPE,
                ...glassine(0.58, 1.5),
                // 자유단에 밝은 선을 둬 젖혀진 끝이 눈에 잡히게 한다
                borderLeft: `1px solid rgba(255,255,255,.85)`,
              }} />
            {/* 외곽선 — 흰 배경 위에서 유산지는 색만으로는 보이지 않는다.
                clip-path에 걸린 box-shadow는 같이 잘려 나가므로 선을 따로 그린다.
                viewBox가 세로로 크게 늘어나니 stroke는 non-scaling으로 고정한다. */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
              <path d={FLAP_PATH}
                fill="none" stroke="rgba(34,34,74,.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </svg>
          </motion.div>
          <div className="absolute top-1/2 -translate-y-1/2 rounded-full"
            style={{ right: -width * 0.055, width: width * 0.12, aspectRatio: '1', ...glassine(0.36, 1), border: `1px solid rgba(255,255,255,.36)`, boxShadow: '0 2px 8px rgba(34,34,74,.08)' }} />
        </div>
      </motion.div>
    </div>
  )
}
