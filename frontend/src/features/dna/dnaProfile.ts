/** FastAPI Book DNA profile을 화면 컴포넌트가 사용하는 표시 모델로 변환한다. */
import type { DnaProfileResponse } from '../../api/dna'

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
  SCIENCE: '과학·기술', ART: '예술·역사', HISTORY: '예술·역사',
}

function axisFromScore(score: { code: string; label: string }): Axis {
  return AXIS_BY_CODE[score.code]
    ?? (AXES.includes(score.label as Axis) ? score.label as Axis : '예술·역사')
}

function metricFromScore(score: { code: string; label: string }): MetricKey {
  const byCode: Record<string, MetricKey> = {
    REFLECTION: '사색', THINKING: '사색', IMMERSION: '몰입', NOVELTY: '새로움',
    EMOTION: '감성', REALISM: '현실감',
  }
  return byCode[score.code]
    ?? (METRICS.includes(score.label as MetricKey) ? score.label as MetricKey : '새로움')
}

function score(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
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
  const type = profile.type
    ? { code: profile.type.code, name: profile.type.name, phrase: profile.type.phrase, blurb: profile.type.summary, likes: [] }
    : { code: 'UNKNOWN', name: '독서가', phrase: '책을 통해 나만의 세계를 만들어 가는', blurb: '아직 분석할 책이 충분하지 않아요.', likes: [] }
  const keywords = profile.keywords.map((item) => item.label || item.code)
  const topAxis = [...axes].sort((a, b) => b.value - a.value)[0]?.label ?? '소설'
  return { axes, topAxis, metrics, keywords, type, oneLine: type.blurb, finished }
}
