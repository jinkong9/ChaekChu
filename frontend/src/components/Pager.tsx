/** 쪽 이동 — 검색 결과와 서재 기록 수정이 함께 쓴다.
 *
 *  1·끝 쪽은 항상 두고, 현재 쪽 좌우로 PAGE_WINDOW 만큼, 벌어진 곳은 '…'.
 *  활성 쪽은 새 색을 쓰지 않고 굵기와 밑줄로만 말한다 (DESIGN.md — 잉크는 하나다).
 *  오른쪽 끝의 「m–n / 총계」는 지금 보는 구간을 숫자로 한 번 더 적는다.
 *
 *  검색 화면에 있던 것을 그대로 옮겼다. 서재의 기록 수정도 서재가 커지면
 *  같은 문제(한 화면에 수천 행)를 만나서, 문법을 새로 만들지 않고 이 자리를 나눠 쓴다. */

/** 페이지 번호 창 — 현재 쪽 좌우로 이만큼 */
const PAGE_WINDOW = 4

/** 쪽 번호 목록 — 1·끝은 항상, 현재 ±PAGE_WINDOW, 벌어진 곳은 '…'(null) */
function pageNumbers(current: number, last: number): (number | null)[] {
  if (last <= PAGE_WINDOW * 2 + 3) return Array.from({ length: last }, (_, i) => i + 1)
  const set = new Set<number>([1, last])
  for (let p = current - PAGE_WINDOW; p <= current + PAGE_WINDOW; p++) if (p >= 1 && p <= last) set.add(p)
  const sorted = [...set].sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push(null); out.push(p) })
  return out
}

export default function Pager({ page, lastPage, from, to, total, onPage, label = '쪽 이동' }: {
  page: number
  lastPage: number
  /** 지금 쪽의 첫 항목 번호(1부터) */
  from: number
  /** 지금 쪽의 마지막 항목 번호 */
  to: number
  /** 셀 수 있는 전체 항목 수 */
  total: number
  onPage: (next: number) => void
  label?: string
}) {
  if (lastPage <= 1) return null

  return (
    <nav className="mt-6 flex flex-wrap items-center justify-center gap-1 text-[12px] tabular-nums" aria-label={label}>
      <button type="button" className="eo-link min-w-[30px] text-center disabled:opacity-30"
        disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="이전 쪽">←</button>
      {pageNumbers(page, lastPage).map((p, i) =>
        p === null
          ? <span key={`gap-${i}`} className="min-w-[30px] text-center text-ink-faint">…</span>
          : <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}
              className={`min-h-[30px] min-w-[30px] border-b-2 px-1 transition-colors duration-150 ${
                p === page ? 'border-ink font-bold text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
              {p}
            </button>)}
      <button type="button" className="eo-link min-w-[30px] text-center disabled:opacity-30"
        disabled={page === lastPage} onClick={() => onPage(page + 1)} aria-label="다음 쪽">→</button>
      <span className="eo-utility ml-3">{from.toLocaleString()}–{to.toLocaleString()} / {total.toLocaleString()}</span>
    </nav>
  )
}
