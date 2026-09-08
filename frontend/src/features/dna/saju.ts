/** 생년월일 → 일주(日柱) → 오행(五行) → 장르. 사주 기반 책 추천의 계산부.
 *
 *  이 파일이 하는 일과 하지 않는 일을 구분해 둔다.
 *
 *  하는 일: 60갑자 일주 계산은 실제 역법이다. 율리우스일(JDN)로 날짜를 정수로 바꾸고
 *  60일 주기의 나머지를 취한다. 기준점은 2019-01-27 = 갑자일이고, 이 식으로 계산하면
 *  1900-01-01 = 갑술일이 나온다(널리 쓰이는 다른 기준점과 일치한다). 60일 뒤 갑자로
 *  되돌아오는 것도 확인했다. 천간 → 오행 배속(갑을木·병정火·무기土·경신金·임계水)도 정통이다.
 *
 *  하지 않는 일: 오행에서 '어떤 장르가 맞는지'는 역법이 정해 주지 않는다. 아래 매핑은
 *  오행의 통상적 성질(목=뻗음, 화=드러냄, 토=중심, 금=벼림, 수=흐름)을 이 서비스의
 *  장르 축에 붙인 우리 쪽 해석이며, 화면에서도 그렇게 밝힌다. 운세를 예측하지 않는다. */
import { type Axis } from './dnaProfile'

const GAN = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'] as const
const ZHI = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'] as const

export const ELEMENTS = ['목', '화', '토', '금', '수'] as const
export type Element = (typeof ELEMENTS)[number]

/** 천간 → 오행. 갑을=목, 병정=화, 무기=토, 경신=금, 임계=수 (두 간이 한 오행을 나눠 갖는다) */
const GAN_ELEMENT: Element[] = ['목', '목', '화', '화', '토', '토', '금', '금', '수', '수']

/** 그레고리력 → 율리우스일. 날짜를 정수 하나로 만들어 60일 주기의 나머지를 구한다 */
function julianDay(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  )
}

export interface SajuDay {
  /** "갑자" — 일주 */
  pillar: string
  /** 일간 한 글자 — "갑" */
  gan: string
  /** 일지 한 글자 — "자" */
  zhi: string
  element: Element
}

/**
 * 생년월일의 일주와 일간 오행.
 *
 * 기준: 2019-01-27 = 갑자일. 여기서 나머지 보정값 (+9 mod 10), (+1 mod 12)이 나온다.
 * 하루 경계는 자정으로 둔다 — 정통 사주는 자시(23시~)를 다음 날로 넘기지만
 * 생년월일만 받는 이 화면에서는 시간을 모르므로 날짜 그대로 쓴다.
 */
export function sajuDay(y: number, m: number, d: number): SajuDay {
  const j = julianDay(y, m, d)
  const gan = GAN[(j + 9) % 10]
  const zhi = ZHI[(j + 1) % 12]
  return { pillar: gan + zhi, gan, zhi, element: GAN_ELEMENT[(j + 9) % 10] }
}

export interface ElementReading {
  /** 오행의 성질 한 줄 */
  nature: string
  /** 그래서 어떤 독서가 맞는지 */
  advice: string
  /** 먼저 고를 장르, 그 장르에 책이 없으면 두 번째 */
  axes: [Axis, Axis]
}

/** 오행의 성질 → 장르. 역법이 아니라 이 서비스의 해석이다(파일 머리말 참고) */
export const ELEMENT_READING: Record<Element, ElementReading> = {
  목: {
    nature: '뻗어 나가는 기운',
    advice: '새로 배우고 시야를 넓히는 독서에 힘이 실립니다.',
    axes: ['인문·사회', '에세이'],
  },
  화: {
    nature: '드러내는 기운',
    advice: '감각과 표현이 살아 있는 이야기가 잘 붙습니다.',
    axes: ['예술·역사', '소설'],
  },
  토: {
    nature: '중심을 잡는 기운',
    advice: '바로 쓸 수 있고 발이 땅에 붙은 이야기가 힘이 됩니다.',
    axes: ['경제·경영', '인문·사회'],
  },
  금: {
    nature: '벼려내는 기운',
    advice: '군더더기 없는 논리와 구조를 따라가는 독서가 맞습니다.',
    axes: ['과학·기술', '경제·경영'],
  },
  수: {
    nature: '흐르는 기운',
    advice: '사람과 마음을 따라가는 이야기에 오래 머무릅니다.',
    axes: ['소설', '에세이'],
  },
}
