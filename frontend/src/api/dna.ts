import { api } from './client'
import { apiErrorCode } from './books'
import type { ServerBookSummary } from './types'

export interface DnaBookResponse {
  bookId: string
  isbn13: string
  title: string
  authors: string[]
  publisher: string | null
  publicationYear: number | null
  coverUrl: string | null
  pageCount: number | null
  category: string | null
  classNo: string | null
  status: 'READ' | 'WISH'
  rating: number | null
  finishedDate: string | null
  /** AI 인덱스에서 찾아 프로필 계산에 반영된 책인지(§3.4, 09-16). false 면 readCount 에는 들지만 basedOnCount 에는 안 든 책.
   *  백엔드 MR(feat/BE-dna-profile-store) 머지 전 응답에는 없다 — 화면은 `=== false` 로만 판단한다 */
  analyzed?: boolean
}

export interface DnaScore {
  code: string
  label: string
  score: number
}

export interface DnaProfileResponse {
  status: 'READY' | 'INSUFFICIENT_DATA'
  basedOnCount: number
  axes: DnaScore[]
  metrics: DnaScore[]
  keywords: DnaScore[]
  type: {
    code: string
    name: string
    phrase: string
    summary: string
  } | null
  evidence: {
    readBookCount: number
    ratedBookCount: number
    topGenres: string[]
    topTags: string[]
  }
}

export interface DnaResponse {
  generatedAt: string
  dnaVersion: string
  modelVersion: string
  indexVersion: string
  tagVersion: string
  declaredTags: string[]
  readCount: number
  books: DnaBookResponse[]
  profile: DnaProfileResponse
}

export async function fetchMyDna(): Promise<DnaResponse> {
  const response = await api.get<DnaResponse>('/users/me/dna')
  return response.data
}

export interface WorldCupChoice {
  choiceId: string
  synopsis: string
}

export interface WorldCupSessionResponse {
  sessionId: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  roundSize: number
  roundNumber: number
  matchNumber: number
  matchesInRound: number
  choices: WorldCupChoice[]
  champion: ServerBookSummary | null
}

export async function createDnaWorldCupSession(): Promise<WorldCupSessionResponse> {
  const response = await api.post<WorldCupSessionResponse>('/users/me/dna/world-cup/sessions')
  return response.data
}

export async function pickDnaWorldCupChoice(sessionId: string, choiceId: string): Promise<WorldCupSessionResponse> {
  const response = await api.post<WorldCupSessionResponse>(
    `/users/me/dna/world-cup/sessions/${encodeURIComponent(sessionId)}/picks`,
    { choiceId },
  )
  return response.data
}

/** 503 DNA_UNAVAILABLE — AI·Qdrant 쪽만 쉬는 상태(계약 §5). 저장된 프로필도 없을 때만 온다.
 *  서재·검색·추천은 멀쩡하므로 전역 오류로 번지지 않게 이 화면에서만 안내한다. */
export const isDnaUnavailable = (err: unknown) => apiErrorCode(err) === 'DNA_UNAVAILABLE'
