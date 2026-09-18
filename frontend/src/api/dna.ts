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

/** 503 DNA_UNAVAILABLE — AI·Qdrant 쪽만 쉬는 상태(계약 §5). 저장된 프로필도 없을 때만 온다.
 *  서재·검색·추천은 멀쩡하므로 전역 오류로 번지지 않게 이 화면에서만 안내한다. */
export const isDnaUnavailable = (err: unknown) => apiErrorCode(err) === 'DNA_UNAVAILABLE'

/* ── 익명 책 이상형 월드컵 (BOOK_DNA_API_CONTRACT §8, #189) ── */

/** 대진 한 쪽 — 선택 중에는 이것만 온다. 제목·저자·표지·ISBN·bookId 는 없다 */
export interface WorldCupChoice {
  choiceId: string
  synopsis: string
}

export interface WorldCupSession {
  sessionId: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  /** 처음 편성된 인원(16). 지금 라운드의 인원은 roundSize >> (roundNumber - 1) */
  roundSize: number
  roundNumber: number
  matchNumber: number
  matchesInRound: number
  /** COMPLETED 면 빈 배열 */
  choices: WorldCupChoice[]
  /** COMPLETED 일 때만 — 그때 처음으로 책의 정체가 내려온다 */
  champion: ServerBookSummary | null
}

/** 세션을 만들고 첫 대진을 받는다. 후보는 대출 상위 요약 풀에서 서버가 16권을 무작위로 편성한다 */
export async function createWorldCupSession(): Promise<WorldCupSession> {
  const response = await api.post<WorldCupSession>('/users/me/dna/world-cup/sessions')
  return response.data
}

/** 한 쪽을 고르고 다음 대진을 받는다. 서버가 행 잠금으로 중복 선택을 막으니 화면도 응답 전에는 다시 보내지 않는다 */
export async function pickWorldCup(sessionId: string, choiceId: string): Promise<WorldCupSession> {
  const response = await api.post<WorldCupSession>(`/users/me/dna/world-cup/sessions/${sessionId}/picks`, { choiceId })
  return response.data
}

/** 503 WORLD_CUP_UNAVAILABLE — 요약 풀이 16권에 못 미친다(적재 전·배치 실패). 이 대화상자 안에서만 안내한다 */
export const isWorldCupUnavailable = (err: unknown) => apiErrorCode(err) === 'WORLD_CUP_UNAVAILABLE'
/** 404 NOT_FOUND — 세션이 만료(24h)됐거나 내 것이 아니다. 새 세션으로 다시 시작하면 된다 */
export const isWorldCupSessionGone = (err: unknown) => apiErrorCode(err) === 'NOT_FOUND'
