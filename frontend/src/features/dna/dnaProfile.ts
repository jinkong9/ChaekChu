/** BOOK DNA B안이 쓰는 파생 지표 — mock 서재(DnaPersona) 한 벌에서
 *  레이더 6축 · 성향 5지표 · 키워드 · 독서타입 · 한 줄 요약을 규칙으로 계산한다.
 *
 *  LLM도 서버 집계도 쓰지 않는다. A안의 `summary()`와 같은 결에서,
 *  "페르소나를 바꾸면 화면이 실제로 갈라지는가"를 볼 수 있을 만큼만 파생시킨다.
 *  정식 구현에서는 GET /users/me/dna 응답이 이 계산을 대신한다. */
import type { DnaBook, DnaPersona } from './useDnaMockData'

/** 평점 → 취향 지분. A안(DnaMockPage)의 ratingWeight와 같은 곡선을 쓴다 */
const weightOf = (b: DnaBook) => (b.rating >= 5 ? 1.6 : b.rating >= 4 ? 1.2 : 0.8)

/* ── 레이더 6축 ──────────────────────────────────────────────
   시안 이미지의 축은 문학과 소설이 겹쳐 한 권이 두 축에 잡힌다.
   합이 어긋나지 않게 KDC를 겹치지 않는 6칸으로 다시 나눴다. */
export const AXES = ['소설', '에세이', '인문·사회', '경제·경영', '과학·기술', '예술·역사'] as const
export type Axis = (typeof AXES)[number]

/** KDC 분류번호 → 레이더 축 하나 (모든 번호가 정확히 한 축에 떨어진다) */
export function axisOf(classNo: string): Axis {
  if (/^8\d3/.test(classNo)) return '소설' // 813 한국소설 · 833 일본소설 · 843 영미소설…
  if (/^81[48]/.test(classNo)) return '에세이'
  if (/^32/.test(classNo)) return '경제·경영'
  if (/^[123]/.test(classNo)) return '인문·사회' // 1 철학·심리 · 2 종교 · 3 사회과학
  if (/^[45]/.test(classNo)) return '과학·기술'
  return '예술·역사' // 6 예술 · 7 언어 · 9 역사 · 0 총류 · 그 밖의 8xx(시·희곡·평론)
}

/* ── 성향 5지표 ─────────────────────────────────────────── */
export const METRICS = ['사색', '몰입', '새로움', '감성', '현실감'] as const
export type MetricKey = (typeof METRICS)[number]

export interface Metric {
  key: MetricKey
  value: number // 0~100
}

/** 0~1 비율 → 0~96%. 바닥을 깔지 않는다 — 한 번도 손대지 않은 축은 26%가 아니라 0으로 읽혀야 한다.
 *  위쪽만 96에서 잘라 한 축으로 쏠려도 막대·레이더가 테두리에 붙지 않게 한다. */
const scale = (ratio: number) => Math.min(96, Math.round(ratio * 100))

/** 축 분포의 정규화 엔트로피(0~1) — 고르게 읽을수록 1에 가깝다 */
function diversity(shares: number[]): number {
  const live = shares.filter((s) => s > 0)
  if (live.length <= 1) return 0
  const h = -live.reduce((sum, s) => sum + s * Math.log(s), 0)
  return h / Math.log(AXES.length)
}

export interface DnaProfile {
  /** 레이더용 — AXES의 고정 순서를 유지한다(도형이 매번 뒤집히면 비교가 안 된다) */
  axes: { label: Axis; value: number }[]
  /** 가장 많이 읽은 장르. axes는 고정 순서라 axes[0]은 1위가 아니다 */
  topAxis: Axis
  metrics: Metric[]
  keywords: string[]
  type: DnaType
  oneLine: string
  /** 완독 권수 — 지표 아래 근거로 같이 보여 준다 */
  finished: number
}

export interface DnaType {
  code: string
  /** "사색적 탐험가" — 2위 지표의 수식어 + 1위 지표의 이름 */
  name: string
  /** "당신은 __ ...입니다"의 가운데 구절 */
  phrase: string
  blurb: string
  likes: string[]
}

/** 1위 지표가 독서타입의 이름·설명을, 2위 지표가 수식어를 준다 */
const TYPE_TABLE: Record<MetricKey, Omit<DnaType, 'name'> & { adj: string; noun: string }> = {
  사색: {
    code: 'THINKER',
    adj: '사색적',
    noun: '사색가',
    phrase: '문장 사이에 오래 머무르며 생각을 넓히는',
    blurb: '빨리 읽는 것보다 오래 남는 것을 택하는 당신. 한 문단에서 멈춰 자기 생각을 덧대는 시간을 아까워하지 않는 독자입니다.',
    likes: ['생각할 거리를 주는 책', '천천히 곱씹게 되는 문장', '질문으로 끝나는 이야기'],
  },
  몰입: {
    code: 'DIVER',
    adj: '깊이 있는',
    noun: '탐독가',
    phrase: '한번 잡은 이야기를 끝까지 따라가는',
    blurb: '한 권을 붙들면 끝을 봐야 하는 당신. 넓게 훑기보다 하나를 깊이 파고들 때 가장 즐거운 독자입니다.',
    likes: ['첫 장부터 붙잡는 이야기', '한 작가를 깊이 따라가는 독서', '두께가 부담스럽지 않은 책'],
  },
  새로움: {
    code: 'EXPLORER',
    adj: '호기심 많은',
    noun: '탐험가',
    phrase: '깊이 있는 이야기를 통해 세상을 탐험하는',
    blurb: '익숙한 이야기 속에서도 새로운 시선을 찾고, 책을 통해 더 넓은 세상을 탐험하는 당신. 깊이 있는 질문과 다채로운 관점을 사랑하는 균형 잡힌 독자입니다.',
    likes: ['생각할 거리를 주는 책', '사람과 사회를 다룬 이야기', '익숙하지 않은 주제를 탐험하는 책'],
  },
  감성: {
    code: 'EMPATH',
    adj: '감성적인',
    noun: '공감가',
    phrase: '사람의 마음이 움직이는 순간을 따라 읽는',
    blurb: '정보보다 마음이 먼저 움직이는 당신. 등장인물의 사정을 오래 기억하고, 문장의 온도를 기준으로 책을 고르는 독자입니다.',
    likes: ['마음이 오래 남는 이야기', '관계와 사람을 다룬 책', '따뜻한 문장으로 쓰인 에세이'],
  },
  현실감: {
    code: 'OBSERVER',
    adj: '현실적인',
    noun: '관찰자',
    phrase: '읽은 것을 곧장 자기 삶에 대어 보는',
    blurb: '읽고 끝내지 않는 당신. 책에서 얻은 근거와 방법을 실제 판단에 옮겨 보며 세상을 이해하는 독자입니다.',
    likes: ['근거가 분명한 책', '바로 써먹을 수 있는 이야기', '세상의 구조를 설명하는 책'],
  },
}

/** 1위 지표별 한 줄 요약 — 화면 하단 "당신의 한 줄 요약" */
const ONE_LINE: Record<MetricKey, string> = {
  사색: '좋은 질문 앞에서 한참 멈춰 서는 독자예요.',
  몰입: '한 권에 깊이 빠져 끝까지 따라가는 독자예요.',
  새로움: '좋은 이야기를 통해 조금 더 나은 내가 되고 싶은 독자예요.',
  감성: '사람의 마음이 움직이는 순간을 오래 기억하는 독자예요.',
  현실감: '읽은 것을 곧장 삶에 옮겨 보는 독자예요.',
}

/** 축별 키워드 후보 — 많이 읽은 축부터 두 개씩 뽑아 최대 10개를 만든다 */
const AXIS_KEYWORDS: Record<Axis, string[]> = {
  소설: ['삶', '사람', '관계', '이야기'],
  에세이: ['일상', '위로', '마음', '문장'],
  '인문·사회': ['심리', '사회', '성장', '생각'],
  '경제·경영': ['일', '선택', '자기계발', '돈'],
  '과학·기술': ['호기심', '질문', '자연', '기술'],
  '예술·역사': ['역사', '예술', '도시', '시간'],
}

export function buildProfile(persona: DnaPersona): DnaProfile {
  const books = persona.books
  const total = books.reduce((s, b) => s + weightOf(b), 0) || 1

  const byAxis = new Map<Axis, number>(AXES.map((a) => [a, 0]))
  for (const b of books) byAxis.set(axisOf(b.classNo), byAxis.get(axisOf(b.classNo))! + weightOf(b))
  const share = (a: Axis) => byAxis.get(a)! / total

  const axes = AXES.map((label) => ({ label, value: scale(share(label) * 1.9) }))

  const loved = books.filter((b) => b.rating >= 4).reduce((s, b) => s + weightOf(b), 0) / total
  const raw: Record<MetricKey, number> = {
    사색: share('인문·사회') * 1.4 + share('에세이') * 0.8,
    몰입: loved * 0.6 + share('소설') * 0.7,
    새로움: diversity(AXES.map(share)),
    감성: share('소설') * 0.85 + share('에세이') * 0.7,
    현실감: (share('경제·경영') + share('과학·기술') + share('예술·역사')) * 1.3,
  }
  const metrics = METRICS.map((key) => ({ key, value: scale(raw[key]) })).sort((a, b) => b.value - a.value)

  const t = TYPE_TABLE[metrics[0].key]
  const type: DnaType = { ...t, name: `${TYPE_TABLE[metrics[1].key].adj} ${t.noun}` }

  // 많이 읽은 축부터 두 개씩 — 같은 키워드가 두 번 나오지 않게 Set으로 받는다
  const ranked = [...AXES].sort((a, b) => share(b) - share(a)).filter((a) => share(a) > 0)
  const keywords = new Set<string>()
  for (let take = 2; take <= 4 && keywords.size < 10; take++)
    for (const a of ranked) {
      if (keywords.size >= 10) break
      AXIS_KEYWORDS[a].slice(0, take).forEach((k) => keywords.size < 10 && keywords.add(k))
    }

  const topAxis = [...axes].sort((a, b) => b.value - a.value)[0].label

  return { axes, topAxis, metrics, keywords: [...keywords], type, oneLine: ONE_LINE[metrics[0].key], finished: books.length }
}
