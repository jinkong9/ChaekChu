/** 표지 URL을 실제로 그려질 크기에 맞춰 고른다.
 *
 *  mock·DB에는 가장 큰 판(알라딘 cover500)을 원본으로 저장해 두고, 화면에서 줄여 쓴다.
 *  궤도 홈은 표지 30여 장을 한 번에 띄우므로 전부 500px로 받으면 3MB가 넘는다.
 *  반대로 작은 판만 저장하면 정면 확대·hover 미리보기에서 뭉갠다. */

/** 알라딘이 실제로 내려주는 폭 (cover300·cover400은 404) */
const ALADIN = [
  { seg: 'coversum', w: 85 },
  { seg: 'cover', w: 160 },
  { seg: 'cover200', w: 200 },
  { seg: 'cover500', w: 500 },
]

/** kakaocdn이 허용하는 폭 (R320x464 등은 403) */
const KAKAO = [
  { seg: 'R120x174', w: 120 },
  { seg: 'R240x0', w: 240 },
  { seg: 'R320x0', w: 320 },
]

/** 목표의 90%만 넘으면 그 단계를 쓴다. 사진을 1.1배까지 늘리는 건 눈에 안 띄는데,
 *  딱 떨어지게 고르면 218px 목표에 200px 판을 두고 500px 판을 받는 낭비가 생긴다. */
const pick = (table: { seg: string; w: number }[], target: number) =>
  (table.find((t) => t.w >= target * 0.9) ?? table[table.length - 1]).seg

/** @param cssWidth 이 표지가 화면에서 차지할 최대 CSS 폭(px) */
export function coverAtWidth(url: string | null | undefined, cssWidth: number): string | null {
  if (!url) return null
  // 고해상도 화면에서 흐려지지 않게 2배까지 잡는다 (그 이상은 체감 차이 대비 용량이 아깝다)
  const target = cssWidth * Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 2)

  if (url.includes('image.aladin.co.kr')) {
    return url.replace(/\/(coversum|cover|cover150|cover200|cover500)\//, `/${pick(ALADIN, target)}/`)
  }
  if (url.includes('kakaocdn.net')) {
    return url.replace(/\/thumb\/R\d+x\d+\./, `/thumb/${pick(KAKAO, target)}.`)
  }
  return url
}
