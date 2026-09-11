/** KDC(한국십진분류) 대분류 10개 — 표준 고정값이라 상수로 둔다.
 *  중·소분류 라벨은 서버 사전(`GET /kdc`, 미구현)이 생기면 그때 붙인다 — 지금은 결과 행의 `category` 문자열이 대신한다.
 *  검색 필터는 코드 prefix 로 나간다(§4.1 `kdc=8`). 화면에서는 `#문학` 토큰으로 보인다. */
export interface KdcMainClass {
  code: string
  label: string
}

export const KDC_MAIN: readonly KdcMainClass[] = [
  { code: '0', label: '총류' },
  { code: '1', label: '철학' },
  { code: '2', label: '종교' },
  { code: '3', label: '사회과학' },
  { code: '4', label: '자연과학' },
  { code: '5', label: '기술과학' },
  { code: '6', label: '예술' },
  { code: '7', label: '언어' },
  { code: '8', label: '문학' },
  { code: '9', label: '역사' },
] as const

/** `kdc` 쿼리값이 서버가 받는 꼴(1~3자리 숫자)인지 — URL 을 손으로 고쳐 들어와도 400 을 미리 막는다 */
export const isValidKdc = (v: string | null | undefined): v is string => !!v && /^\d{1,3}$/.test(v)

/** 코드 → 표시 라벨. 대분류는 상수, 그 아래는 사전이 없으니 코드 그대로("81")를 보여 준다 */
export function kdcLabel(code: string): string {
  const main = KDC_MAIN.find((k) => k.code === code[0])
  if (!main) return code
  return code.length === 1 ? main.label : `${main.label} ${code}`
}
