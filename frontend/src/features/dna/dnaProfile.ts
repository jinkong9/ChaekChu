/** FastAPI Book DNA profile을 화면 컴포넌트가 사용하는 표시 모델로 변환한다.
 *
 *  여기서 점수를 다시 계산하지 않는다. 서버가 준 code·label·score를 화면 어휘로 옮기고,
 *  서버가 보내지 않는 것(독서타입의 긴 설명·'이런 책을 좋아해요')만 code로 이어 붙인다. */
import type { DnaProfileResponse, DnaScore } from '../../api/dna'

export const AXES = ['소설', '에세이', '인문·사회', '경제·경영', '과학·기술', '예술·역사'] as const
export type Axis = (typeof AXES)[number]

/** 콘텐츠 카드가 KDC를 표시할 때 사용하는 보조 분류 함수 */
export function axisOf(classNo: string): Axis {
  if (/^8\d3/.test(classNo)) return '소설'
  if (/^81[48]/.test(classNo)) return '에세이'
  if (/^32/.test(classNo)) return '경제·경영'
  if (/^[123]/.test(classNo)) return '인문·사회'
  if (/^[45]/.test(classNo)) return '과학·기술'
  return '예술·역사'
}

export const METRICS = ['사색', '몰입', '새로움', '감성', '현실감'] as const
export type MetricKey = (typeof METRICS)[number]

export interface Metric {
  key: MetricKey
  value: number
}

export interface DnaProfile {
  axes: { label: Axis; value: number }[]
  topAxis: Axis
  metrics: Metric[]
  keywords: string[]
  type: DnaType
  oneLine: string
  finished: number
}

export interface DnaType {
  code: string
  name: string
  phrase: string
  blurb: string
  likes: string[]
}

const AXIS_BY_CODE: Record<string, Axis> = {
  FICTION: '소설', ESSAY: '에세이', HUMANITIES: '인문·사회', BUSINESS: '경제·경영',
  SCIENCE: '과학·기술', ART: '예술·역사', ART_HISTORY: '예술·역사', HISTORY: '예술·역사',
}

/** 공개 축 코드 → 화면 라벨. 사전에 없으면 코드를 그대로 돌려준다(선언 vs 행동 줄에서 쓴다) */
export function axisLabel(code: string): string {
  return AXIS_BY_CODE[code] ?? code
}

function axisFromScore(score: { code: string; label: string }): Axis {
  return AXIS_BY_CODE[score.code]
    ?? (AXES.includes(score.label as Axis) ? score.label as Axis : '예술·역사')
}

function metricFromScore(score: { code: string; label: string }): MetricKey {
  const byCode: Record<string, MetricKey> = {
    REFLECTION: '사색', THINKING: '사색', IMMERSION: '몰입', EXPLORATION: '새로움', NOVELTY: '새로움',
    EMPATHY: '감성', EMOTION: '감성', REALISM: '현실감',
  }
  return byCode[score.code]
    ?? (METRICS.includes(score.label as MetricKey) ? score.label as MetricKey : '새로움')
}

function score(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** 독서타입마다 덧붙이는 카피. 서버 type은 code·name·phrase·summary까지만 주고,
 *  긴 설명과 '이런 책을 좋아해요'는 화면의 몫이다 — 집계가 아니라 고정 문구라 여기 둔다.
 *  서버가 모르는 code를 보내면 빈 목록이 아니라 서버 summary만 쓰고 목록은 숨긴다. */
const TYPE_COPY: Record<string, { blurb: string; likes: string[] }> = {
  THINKER: {
    blurb: '빨리 읽는 것보다 오래 남는 것을 택하는 당신. 한 문단에서 멈춰 자기 생각을 덧대는 시간을 아까워하지 않는 독자입니다.',
    likes: ['생각할 거리를 주는 책', '천천히 곱씹게 되는 문장', '질문으로 끝나는 이야기'],
  },
  DIVER: {
    blurb: '한 권을 붙들면 끝을 봐야 하는 당신. 넓게 훑기보다 하나를 깊이 파고들 때 가장 즐거운 독자입니다.',
    likes: ['첫 장부터 붙잡는 이야기', '한 작가를 깊이 따라가는 독서', '두께가 부담스럽지 않은 책'],
  },
  EXPLORER: {
    blurb: '익숙한 이야기 속에서도 새로운 시선을 찾고, 책을 통해 더 넓은 세상을 탐험하는 당신. 깊이 있는 질문과 다채로운 관점을 사랑하는 균형 잡힌 독자입니다.',
    likes: ['생각할 거리를 주는 책', '사람과 사회를 다룬 이야기', '익숙하지 않은 주제를 탐험하는 책'],
  },
  EMPATH: {
    blurb: '정보보다 마음이 먼저 움직이는 당신. 등장인물의 사정을 오래 기억하고, 문장의 온도를 기준으로 책을 고르는 독자입니다.',
    likes: ['마음이 오래 남는 이야기', '관계와 사람을 다룬 책', '따뜻한 문장으로 쓰인 에세이'],
  },
  OBSERVER: {
    blurb: '읽고 끝내지 않는 당신. 책에서 얻은 근거와 방법을 실제 판단에 옮겨 보며 세상을 이해하는 독자입니다.',
    likes: ['근거가 분명한 책', '바로 써먹을 수 있는 이야기', '세상의 구조를 설명하는 책'],
  },
}

/** 취향 키워드가 아닌 신호 태그 — 책의 시장 상태지 읽는 사람의 성향이 아니라 칩에서 뺀다 */
const SIGNAL_CODES = new Set(['NEW_BOOK', 'TRENDING', 'STEADY'])

/** 서버가 공개 사전에 없는 태그를 줄 때 label 자리에 code가 그대로 온다(§2.2).
 *  '#TIME_TRAVEL' 같은 칩을 만들지 않고 그런 키워드는 숨긴다. */
const isRawCode = (item: DnaScore) => item.label === item.code && /^[A-Z][A-Z0-9_]*$/.test(item.code)

function keywordLabels(keywords: DnaScore[]): string[] {
  return keywords
    .filter((item) => !SIGNAL_CODES.has(item.code) && !isRawCode(item))
    .map((item) => item.label)
}

/** FastAPI 계산 결과를 재계산하지 않고 그대로 화면용 모델로 옮긴다. */
export function profileFromApi(profile: DnaProfileResponse, finished: number): DnaProfile {
  const axes = (profile.axes.length > 0
    ? profile.axes
    : AXES.map((label) => ({ code: label, label, score: 0 })))
    .map((item) => ({ label: axisFromScore(item), value: score(item.score) }))
  const metrics = (profile.metrics.length > 0
    ? profile.metrics
    : METRICS.map((label) => ({ code: label, label, score: 0 })))
    .map((item) => ({ key: metricFromScore(item), value: score(item.score) }))
  const copy = profile.type ? TYPE_COPY[profile.type.code] : undefined
  const type = profile.type
    ? {
        code: profile.type.code,
        name: profile.type.name,
        phrase: profile.type.phrase,
        // 긴 설명이 없는 타입이면 서버 한 줄 요약으로 대신한다 — 빈 칸을 두지 않는다
        blurb: copy?.blurb ?? profile.type.summary,
        likes: copy?.likes ?? [],
      }
    : { code: 'UNKNOWN', name: '독서가', phrase: '책을 통해 나만의 세계를 만들어 가는', blurb: '아직 분석할 책이 충분하지 않아요.', likes: [] }
  const keywords = keywordLabels(profile.keywords)
  const topAxis = [...axes].sort((a, b) => b.value - a.value)[0]?.label ?? '소설'
  // 한 줄 요약은 서버 문장을 그대로 쓴다. 타입 패널의 긴 설명과 같은 문장이 두 번 나오지 않게 blurb 와 분리한다
  return { axes, topAxis, metrics, keywords, type, oneLine: profile.type?.summary ?? type.blurb, finished }
}
