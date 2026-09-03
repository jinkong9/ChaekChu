import type { CSSProperties } from 'react'

/** 유산지(글라신) 봉투 — 안에 든 것이 흐릿하게 비쳐 보이는 반투명 종이.
 *  봉투와 폴더가 같은 재질을 써야 해서 여기 한 곳에 둔다.
 *
 *  반투명만으로는 부족하다 — 뒤에 깔린 표지가 선명하게 겹쳐 보이면 종이가 아니라 유리로 읽힌다.
 *  그래서 반드시 뒤엣것을 흐려야 하는데, 흐리는 방법은 두 가지다:
 *  뒤를 통째로 흐리는 backdrop-filter(blur 인자)와, 안에 든 것만 직접 흐리는 방법.
 *  전자는 레이어마다 비싸므로 목록에서는 후자를 쓴다 (StampFolder 참고). */

export const GLASS_LINE = 'rgba(34,34,74,0.18)'  // 유산지 위에 인쇄한 접힘선·테두리

/** @param tint 종이의 불투명도 — 높을수록 안이 덜 비친다 (0.45~0.75 사이가 적당)
 *  @param blur backdrop-filter 흐림(px). 0이면 붙이지 않는다 —
 *    backdrop-filter는 레이어마다 비싸서, 목록처럼 수십 개가 깔리는 자리에서는
 *    봉투에 걸지 말고 안에 든 표지 자체를 blur해 같은 그림을 훨씬 싸게 만든다. */
export function glassine(tint = 0.62, blur = 0): CSSProperties {
  return {
    // 결(--paper-fiber)이 위, 종이색 그러데이션이 아래. 결은 알파가 낮아 반투명을 해치지 않는다.
    backgroundImage:
      'var(--paper-fiber), ' +
      `linear-gradient(118deg, rgba(255,255,255,${Math.min(tint + 0.12, 0.92).toFixed(2)}) 0%, ` +
      `rgba(239,240,238,${Math.max(tint - 0.05, 0.08).toFixed(2)}) 50%, rgba(207,211,210,${Math.max(tint - 0.1, 0.06).toFixed(2)}) 100%)`,
    backgroundSize: '240px 240px, auto',
    ...(blur > 0 ? { backdropFilter: `blur(${blur}px) saturate(0.8)`, WebkitBackdropFilter: `blur(${blur}px) saturate(0.8)` } : {}),
  }
}
