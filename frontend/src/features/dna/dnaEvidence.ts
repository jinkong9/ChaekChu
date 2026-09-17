/** 근거 구역이 쓰는 파생값 — 전부 응답의 books[] 를 세면 나온다.
 *
 *  프로필 점수(axes·metrics·type)는 서버가 계산한 것을 그대로 쓴다. 여기서 만드는 건
 *  그 점수 옆에 붙일 "몇 권인지"다 — 지분 100%가 다섯 권인지 백 권인지는 서버 점수만으로 알 수 없고,
 *  그 수가 없으면 레이더가 아무리 커도 독자는 자기 기록이라고 느끼지 못한다. */
import type { DnaBookResponse } from '../../api/dna'
import { axisOf, type Axis } from './dnaProfile'

export interface AxisCount {
  label: Axis
  /** 서버가 준 지분(0~100) */
  share: number
  /** 그 축에서 완독한 권수 — 분류를 모르는 책은 세지 않는다 */
  count: number
}

export interface MonthCount {
  /** "4월" */
  label: string
  count: number
}

export interface AuthorCount {
  name: string
  count: number
}

export interface ReadCover {
  bookId: string
  title: string
  coverUrl: string
}

const readOnly = (records: DnaBookResponse[]) => records.filter((b) => b.status === 'READ')

/** 서버 축 순서를 그대로 두고 권수만 얹는다. 도형과 목록의 순서가 어긋나면 눈이 둘을 잇지 못한다. */
export function axisCounts(records: DnaBookResponse[], axes: { label: Axis; value: number }[]): AxisCount[] {
  const counted = new Map<Axis, number>()
  for (const book of readOnly(records)) {
    // 분류가 없는 책은 어느 축인지 알 수 없다. 기본값(예술·역사)으로 밀어 넣으면 없는 취향이 생긴다
    if (!book.classNo) continue
    const axis = axisOf(book.classNo)
    counted.set(axis, (counted.get(axis) ?? 0) + 1)
  }
  return axes.map((a) => ({ label: a.label, share: a.value, count: counted.get(a.label) ?? 0 }))
}

/** 최근 N개월의 월별 완독 권수 — 오래된 달이 왼쪽이다 */
export function monthlyFinished(records: DnaBookResponse[], months = 6, now = new Date()): MonthCount[] {
  const buckets: MonthCount[] = []
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`
  const counted = new Map<string, number>()
  for (const book of readOnly(records)) {
    if (!book.finishedDate) continue
    const d = new Date(`${book.finishedDate}T00:00:00`)
    if (!Number.isFinite(d.getTime())) continue
    counted.set(key(d), (counted.get(key(d)) ?? 0) + 1)
  }
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({ label: `${d.getMonth() + 1}월`, count: counted.get(key(d)) ?? 0 })
  }
  return buckets
}

/** 1~5점 분포. 별점을 남기지 않은 책은 빠진다 */
export function ratingSpread(records: DnaBookResponse[]): number[] {
  const spread = [0, 0, 0, 0, 0]
  for (const book of readOnly(records)) {
    if (book.rating && book.rating >= 1 && book.rating <= 5) spread[book.rating - 1] += 1
  }
  return spread
}

/** 많이 읽은 작가 — 대표 저자(첫 이름) 기준, 두 권 이상만 */
export function topAuthors(records: DnaBookResponse[], limit = 4): AuthorCount[] {
  const counted = new Map<string, number>()
  for (const book of readOnly(records)) {
    const name = book.authors[0]?.trim()
    if (name) counted.set(name, (counted.get(name) ?? 0) + 1)
  }
  return [...counted.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

/** 표지 벽에 깔 완독 책 — 최근에 끝낸 것부터, 완독일이 없는 책은 뒤로 */
export function readCovers(records: DnaBookResponse[], limit = 42): ReadCover[] {
  return readOnly(records)
    .filter((b): b is DnaBookResponse & { coverUrl: string } => !!b.coverUrl)
    .sort((a, b) => (b.finishedDate ?? '').localeCompare(a.finishedDate ?? ''))
    .slice(0, limit)
    .map((b) => ({ bookId: b.bookId, title: b.title, coverUrl: b.coverUrl }))
}
