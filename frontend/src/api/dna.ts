import { api } from './client'

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
