export interface PopularBook {
  id: string
  ranking: number
  title: string
  author: string
  publisher: string
  publicationYear: string
  isbn13: string
  loanCount: number
  classNo: string
  coverUrl: string | null
  coverLargeUrl: string | null
}

export interface PopularSegment {
  id: string
  label: string
  gender: '남' | '여'
  age: string
  startDate: string
  endDate: string
  items: PopularBook[]
}

export interface PopularRingData {
  generatedAt: string
  source: string
  segmentCount: number
  itemCount: number
  segments: PopularSegment[]
}

export interface PopularSelection {
  book: PopularBook
  segment: PopularSegment
}
