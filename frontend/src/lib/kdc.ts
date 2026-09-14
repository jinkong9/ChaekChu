import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/** KDC(한국십진분류) 대분류 10개 — 표준 고정값이라 상수로 둔다. 서버 사전(`GET /kdc?depth=1`)과 같은 값이지만
 *  첫 화면 칩을 요청 없이 바로 그리려고 여기 둔다. 중·소분류 라벨은 사전(§4.7)에서 받는다.
 *  검색 필터는 코드 prefix 로 나간다(§4.1 `kdc=8` · `81` · `813`). 화면에서는 `#문학 › 한국문학` 토큰으로 보인다. */
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

/** GET /kdc 의 한 행 (§4.7). code 자릿수 = depth */
export interface KdcCode {
  code: string
  label: string
  depth: 1 | 2 | 3
  parentCode: string | null
}

/** `kdc` 쿼리값이 서버가 받는 꼴(1~3자리 숫자)인지 — URL 을 손으로 고쳐 들어와도 400 을 미리 막는다 */
export const isValidKdc = (v: string | null | undefined): v is string => !!v && /^\d{1,3}$/.test(v)

/** GET /kdc?parent= (§4.7) — 부모 코드의 자식 한 단계. 소분류를 물으면 `items: []`(404 아님). 사전이 비어도 `[]` */
export async function fetchKdcChildren(parent: string): Promise<KdcCode[]> {
  const res = await api.get<{ items: KdcCode[] }>('/kdc', { params: { parent } })
  return res.data.items
}

/** 부모 코드의 자식 목록 — 949행짜리 고정 표라 하루 동안 다시 묻지 않는다(서버도 `Cache-Control: max-age=86400`).
 *  parent 가 비면 요청하지 않는다(대분류는 상수). */
export function useKdcChildren(parent: string | null | undefined) {
  return useQuery({
    queryKey: ['kdc', 'children', parent],
    queryFn: () => fetchKdcChildren(parent!),
    enabled: isValidKdc(parent),
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  })
}

/** 코드의 단계별 조상 코드 — "813" → ["8", "81", "813"] */
export const kdcAncestors = (code: string): string[] => Array.from({ length: code.length }, (_, i) => code.slice(0, i + 1))

/** 코드 → 표시 라벨. 대분류는 상수에서, 그 아래는 사전에서 받은 자식 목록을 넘겨주면 이름을 붙인다.
 *  사전이 아직 없거나 못 찾으면 코드 그대로("81")를 보여 준다 — 빈 칸보다 낫다. */
export function kdcLabel(code: string, dict: ReadonlyMap<string, string> = new Map()): string {
  const main = KDC_MAIN.find((k) => k.code === code[0])
  if (!main) return code
  return kdcAncestors(code)
    .map((c, i) => (i === 0 ? main.label : dict.get(c) ?? c))
    .join(' › ')
}
