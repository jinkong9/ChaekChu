import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'

const [, , sourceArg, destinationArg] = process.argv

if (!sourceArg || !destinationArg) {
  throw new Error('Usage: node scripts/build-popular-ring-data.mjs <source.json> <destination.json>')
}

const source = resolve(sourceArg)
const destination = resolve(destinationArg)
const raw = JSON.parse(await readFile(source, 'utf8'))

const ageOrder = ['10대', '20대', '30대', '40대', '50대+']
const genderOrder = ['남', '여']

const toHttps = (value) => value?.replace(/^http:/, 'https:') ?? null
const cleanAuthor = (value) => value
  ?.replace(/^지은이:\s*/u, '')
  .replace(/\s*;\s*/gu, ' · ')
  .trim() ?? ''

const coverDirectory = resolve(dirname(destination), '..', 'covers', 'popular')
const cachedCoverUrl = (fileName) => `/covers/popular/${fileName}`

const cacheCover = async (url) => {
  if (!url) return null
  const extension = new URL(url).pathname.split('.').pop()?.toLowerCase() || 'jpg'
  const fileName = `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.${extension}`
  const filePath = resolve(coverDirectory, fileName)

  try {
    await access(filePath)
    return cachedCoverUrl(fileName)
  } catch {
    // 캐시에 없을 때만 원본 서버에서 한 번 내려받는다.
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await writeFile(filePath, Buffer.from(await response.arrayBuffer()))
    return cachedCoverUrl(fileName)
  } catch (error) {
    console.warn(`Cover cache skipped: ${url} (${error.message})`)
    return url
  }
}

const segments = raw
  .slice()
  .sort((a, b) => {
    const age = ageOrder.indexOf(a.age) - ageOrder.indexOf(b.age)
    return age || genderOrder.indexOf(a.gender) - genderOrder.indexOf(b.gender)
  })
  .map((segment) => {
    const genderCode = segment.gender === '여' ? 'F' : 'M'
    const ageCode = segment.age.replace(/\D/gu, '') || '50P'
    return {
      id: `${ageCode}_${genderCode}`,
      label: `${segment.age} ${segment.gender === '여' ? '여성' : '남성'}`,
      gender: segment.gender,
      age: segment.age,
      startDate: segment.startDt,
      endDate: segment.endDt,
      items: segment.docs
        .slice()
        .sort((a, b) => Number(a.ranking) - Number(b.ranking))
        .slice(0, 20)
        .map((book) => ({
          id: `${book.isbn13}-${genderCode}-${ageCode}-${book.ranking}`,
          ranking: Number(book.ranking),
          title: book.bookname,
          author: cleanAuthor(book.authors),
          publisher: book.publisher,
          publicationYear: book.publication_year,
          isbn13: book.isbn13,
          loanCount: Number(book.loan_count),
          classNo: book.class_no,
          coverUrl: toHttps(book.coverOriginal),
          coverLargeUrl: toHttps(book.coverLarge),
        })),
    }
  })

const result = {
  generatedAt: new Date().toISOString(),
  source: 'segment_popular_500.json',
  segmentCount: segments.length,
  itemCount: segments.reduce((sum, segment) => sum + segment.items.length, 0),
  segments,
}

await mkdir(coverDirectory, { recursive: true })
const remoteCovers = [...new Set(segments.flatMap((segment) => segment.items.map((book) => book.coverUrl)).filter(Boolean))]
const coverMap = new Map()
let nextCover = 0
const cacheWorker = async () => {
  while (nextCover < remoteCovers.length) {
    const url = remoteCovers[nextCover]
    nextCover += 1
    coverMap.set(url, await cacheCover(url))
  }
}
await Promise.all(Array.from({ length: Math.min(8, remoteCovers.length) }, cacheWorker))
segments.forEach((segment) => segment.items.forEach((book) => {
  book.coverUrl = coverMap.get(book.coverUrl) ?? book.coverUrl
}))

await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

const uniqueCovers = new Set(segments.flatMap((segment) => segment.items.map((book) => book.coverUrl)))
console.log(`Wrote ${result.itemCount} slots across ${result.segmentCount} segments (${uniqueCovers.size} cached covers) to ${destination}`)
