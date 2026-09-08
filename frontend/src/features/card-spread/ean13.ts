/** ISBN-13을 EAN-13 바코드 모듈로 바꾼다.
 *
 *  도서 카드 시안의 바코드는 장식이 아니라 실제로 읽히는 바코드다 — ISBN-13은 그 자체가
 *  EAN-13이므로 규격대로 인코딩하면 스캐너에 이 책의 ISBN이 그대로 나온다.
 *  자리수·체크디짓이 맞지 않으면 null을 돌려주고, 호출부는 바코드를 렌더하지 않는다
 *  (읽히지 않는 줄무늬를 바코드인 척 그리지 않는다).
 *
 *  구조: 시작 가드 101 + 왼쪽 6자리(자리마다 7모듈, 첫 자리가 고르는 A/B 패턴)
 *        + 중앙 가드 01010 + 오른쪽 6자리(C) + 종료 가드 101 = 95모듈. */

// L(A) / G(B) / R(C) 인코딩 표
const A = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const B = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const C = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']

/** 첫 자리가 왼쪽 6자리의 A/B 배열을 정한다 (EAN-13은 이 패턴으로 13번째 자리를 표현한다) */
const PARITY = ['AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB', 'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA']

/** EAN-13 체크디짓 — 홀수 자리 ×1, 짝수 자리 ×3의 합을 10의 배수로 채우는 값 */
function checkDigit(d: number[]) {
  const sum = d.slice(0, 12).reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10
}

/** @returns 95자 이진 문자열('1'=검정 모듈) 또는 유효하지 않은 ISBN이면 null */
export function ean13Modules(isbn13: string | null | undefined): string | null {
  const digits = (isbn13 ?? '').replace(/[^0-9]/g, '')
  if (digits.length !== 13) return null
  const d = [...digits].map(Number)
  if (checkDigit(d) !== d[12]) return null

  const parity = PARITY[d[0]]
  let out = '101'
  for (let i = 1; i <= 6; i += 1) out += (parity[i - 1] === 'A' ? A : B)[d[i]]
  out += '01010'
  for (let i = 7; i <= 12; i += 1) out += C[d[i]]
  return `${out}101`
}

/** 이진 문자열을 이어진 검정 막대 [시작모듈, 폭] 목록으로 압축한다 — rect 95개를 그리지 않으려고 */
export function ean13Bars(modules: string): [number, number][] {
  const bars: [number, number][] = []
  for (let i = 0; i < modules.length; ) {
    if (modules[i] === '0') { i += 1; continue }
    let w = 0
    while (modules[i + w] === '1') w += 1
    bars.push([i, w])
    i += w
  }
  return bars
}
