/** 독서 습관 — 완독 기록의 서술 통계.
 *
 *  레이더·지표·독서타입은 FastAPI 가 계산한 '취향'이고, 여기는 그 옆의 '버릇'이다.
 *  두께·출간 연도·언어권·작가 같은 건 프로필 점수가 아니라 근거 데이터(books[])를 세면 나온다.
 *  ─ 계약 §1 의 "프론트는 서재를 집계하지 않는다"는 프로필 점수·타입에 대한 조항이고,
 *    이 줄들은 그 점수에 끼지 않는다. 나중에 서버(profile.habits)로 옮길 때도 이 식을 그대로 넘기면 된다.
 *
 *  원칙 하나: 표본이 얇으면 값을 내지 않는다. 세 권으로 낸 "78%"가 리포트 전체의 신뢰를 깎는다.
 *  다만 줄 자체는 늘 다섯 개다 — 값 자리에 「—」와 왜 비었는지를 적는다. 줄이 데이터마다 생기고 사라지면
 *  지면 아래쪽 정렬이 계정마다 달라지고, 사용자는 무엇이 있을 수 있었는지도 모른다. */
import type { DnaBookResponse } from '../../api/dna'

export interface Habit {
  id: string
  label: string
  /** 값을 눌러 갈 곳 — 없으면 그냥 숫자로 둔다 */
  to?: string
  /** 값 아래 한 줄로 서는 다음 걸음.
   *  값 자체가 갈 곳인 `to`(찜 12권 → 찜 목록)와 다르다 — 값이 가리키는 것과 다른 지면으로 데려갈 때 쓴다.
   *  값을 링크로 만들면 "한강 3권"을 누르면 그 세 권이 나올 것처럼 읽히는데, 실제로는 한강의 책 전부가 나온다. */
  action?: { to: string; label: string; aria: string }
  /** 오른쪽에 큰 글씨로 서는 값 — "긴 편", "6 : 4" */
  value: string
  /** 그 값이 무엇에서 나왔는지 한 줄 — 비었으면 왜 비었는지 */
  detail: string
  /** 표본이 모자라 값을 내지 못했다 — 화면은 값을 흐리게 적는다 */
  empty?: boolean
}

/** 이만큼은 있어야 한 줄을 만든다 */
const MIN_SAMPLE = 3
/** 완독 책 중 그 필드를 가진 비율이 이보다 낮으면 만들지 않는다 — 결측이 많은 필드로 단정하지 않는다 */
const MIN_COVERAGE = 0.5
/** '신간'의 기준 — 올해 포함 최근 3년 */
const RECENT_YEARS = 3
/** 읽는 속도를 재는 창 — 더 길게 잡으면 '요즘'이 아니고, 더 짧으면 한 권에 값이 출렁인다 */
const PACE_MONTHS = 6
const DAY = 86_400_000

/** 지분 x : y 를 백분율 두 개로 — "30% : 70%". 합 10 정수("3 : 7")로 적었을 때는 아래 줄의 실제 권수(4권 · 9권)와
 *  숫자가 달라 보여 어긋난 값처럼 읽혔다. 퍼센트는 단위가 붙어 비율이라는 게 드러난다 */
function ratio(x: number, y: number): string {
  const total = x + y
  const left = Math.round((x / total) * 100)
  return `${left}% : ${100 - left}%`
}

function enough(sample: number, total: number): boolean {
  return sample >= MIN_SAMPLE && sample / Math.max(1, total) >= MIN_COVERAGE
}

/** YYYY-MM-DD → 지금으로부터 며칠 전. 값이 이상하면 null */
function daysAgo(date: string | null, now: Date): number | null {
  if (!date) return null
  const ms = now.getTime() - new Date(`${date}T00:00:00`).getTime()
  return Number.isFinite(ms) ? Math.max(0, ms / DAY) : null
}

/** 평균 별점 → 사람이 쓰는 말. 5점 만점에서 4.3 을 넘기면 후한 쪽, 3.5 아래면 짠 쪽이다.
 *  화면에 적는 수(소수 한 자리)를 그대로 재야 한다 — 4.25 를 "평균 4.3점 · 무던한 편"으로
 *  적으면 규칙이 어긋난 것처럼 보인다. 그래서 반올림한 뒤에 판정한다. */
function ratingLabel(avg: number): string {
  if (avg >= 4.3) return '후한 편'
  if (avg >= 3.5) return '무던한 편'
  return '짠 편'
}

/** 소수 한 자리 — 정수면 정수로 (2.0권보다 2권이 읽기 좋다) */
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function buildHabits(books: DnaBookResponse[], now = new Date()): Habit[] {
  // 습관은 완독 기록에서 나온다 — 찜(WISH)은 아직 읽지 않은 책이라 버릇을 말해 주지 않는다
  const read = books.filter((b) => b.status === 'READ')
  const habits: Habit[] = []

  // ── 읽는 속도 ───────────────────────────────
  // 완독일이 있는 책만 센다. 온보딩에서 seed 로 담은 책은 완독일이 없어 속도에 끼면 안 된다
  const window = PACE_MONTHS * 30
  const ages = read.map((b) => daysAgo(b.finishedDate, now)).filter((d): d is number => d != null)
  if (ages.length >= MIN_SAMPLE) {
    const recent = ages.filter((d) => d <= window).length
    if (recent > 0) {
      habits.push({
        id: 'pace',
        label: '읽는 속도',
        value: `월 ${trim(Math.round((recent / PACE_MONTHS) * 10) / 10)}권`,
        detail: `최근 ${PACE_MONTHS}개월 동안 ${recent}권을 끝냈어요`,
      })
    } else {
      // 최근 창이 비었다고 줄을 지우지 않는다 — '요즘 안 읽는다'도 습관이다
      const months = Math.round(Math.min(...ages) / 30)
      habits.push({
        id: 'pace',
        label: '읽는 속도',
        value: '쉬어 가는 중',
        detail: `마지막 완독은 ${months}개월 전이에요`,
      })
    }
  } else {
    habits.push({
      id: 'pace',
      label: '읽는 속도',
      value: '—',
      detail: `완독일이 있는 기록이 ${MIN_SAMPLE}권 넘게 쌓이면 보여드려요`,
      empty: true,
    })
  }

  // ── 신간 vs 구간 ─────────────────────────────
  // '스테디셀러'라고 부르지 않는다 — 그건 대출이 꾸준하다는 뜻이고, 출간 연도로는 말할 수 없다
  const years = read.map((b) => b.publicationYear).filter((y): y is number => typeof y === 'number' && y > 0)
  if (enough(years.length, read.length)) {
    const cutoff = now.getFullYear() - (RECENT_YEARS - 1)
    const fresh = years.filter((y) => y >= cutoff).length
    habits.push({
      id: 'recency',
      label: '신간 vs 구간',
      value: ratio(fresh, years.length - fresh),
      detail: `${cutoff}년 이후 출간 ${fresh}권 · 그 이전 ${years.length - fresh}권`,
    })
  } else {
    habits.push({
      id: 'recency',
      label: '신간 vs 구간',
      value: '—',
      detail: '출간 연도를 아는 완독 책이 더 쌓이면 보여드려요',
      empty: true,
    })
  }

  // ── 선호하는 작가 ───────────────────────────
  const byAuthor = new Map<string, number>()
  for (const b of read) {
    const author = b.authors[0]?.trim()
    if (author) byAuthor.set(author, (byAuthor.get(author) ?? 0) + 1)
  }
  const repeated = [...byAuthor.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
  if (repeated.length > 0) {
    const [topAuthor, topCount] = repeated[0]
    habits.push({
      id: 'author',
      label: '선호하는 작가',
      value: `${topAuthor} ${topCount}권`,
      detail: `두 권 넘게 읽은 작가가 ${repeated.length}명`,
      // 읽은 권수를 세어 놓고 끝내면 "그래서?"가 남는다 — 그 작가의 나머지를 볼 데로 보낸다.
      // scope=author 는 검색 화면의 「저자」 범위(§4.1) — 제목에 이름이 섞인 책이 끼지 않는다
      action: {
        to: `/search?q=${encodeURIComponent(topAuthor)}&scope=author`,
        // 보이는 글자에 이름을 또 넣으면 바로 위 값("한강 3권")과 같은 말이 두 번이다.
        // 다만 링크 목록만 훑는 화면 낭독기에는 「이 작가」가 누구인지 남지 않으므로 읽는 이름에는 넣는다
        label: '이 작가의 책 더 보기',
        aria: `${topAuthor}의 책 검색 결과 보기`,
      },
    })
  } else {
    habits.push({
      id: 'author',
      label: '선호하는 작가',
      value: '—',
      detail: '두 권 넘게 읽은 작가가 아직 없어요',
      empty: true,
    })
  }

  // ── 별점 습관 ───────────────────────────────
  // 얼마나 후한지(평균)와 얼마나 남기는지(기록률)는 같은 버릇의 두 면이라 한 줄에 묶는다
  const rated = read.map((b) => b.rating).filter((r): r is number => typeof r === 'number' && r > 0)
  if (rated.length >= MIN_SAMPLE) {
    // 화면에 적는 값과 판정에 쓰는 값을 하나로 — 반올림을 먼저 한다
    const avg = Math.round((rated.reduce((a, r) => a + r, 0) / rated.length) * 10) / 10
    habits.push({
      id: 'rating',
      label: '별점 습관',
      value: ratingLabel(avg),
      detail: `평균 ${avg.toFixed(1)}점 · 완독 ${read.length}권 중 ${rated.length}권에 남겼어요`,
    })
  } else {
    habits.push({
      id: 'rating',
      label: '별점 습관',
      value: '—',
      detail: `별점을 ${MIN_SAMPLE}권 넘게 남기면 보여드려요`,
      empty: true,
    })
  }

  // ── 쌓아 둔 책 ──────────────────────────────
  const wish = books.filter((b) => b.status === 'WISH').length
  habits.push({
    id: 'wish',
    label: '쌓아 둔 책',
    value: `${wish}권`,
    detail: wish > 0 ? '찜해 두고 아직 펼치지 않은 책이에요' : '찜해 둔 책이 아직 없어요',
    // 값 자체가 갈 곳이라 `action` 이 아니라 `to` 다 — 「12권」을 누르면 그 12권이 나온다(서재의 찜 탭은 주소가 기억한다)
    to: '/library?tab=wish',
    empty: wish === 0,
  })

  return habits
}
