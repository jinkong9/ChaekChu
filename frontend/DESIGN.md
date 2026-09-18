---
name: "책추책책추 — Editorial Orbit"
description: "따뜻한 종이 위에 검정 잉크와 책 표지의 색만 남기는, 여백 중심의 편집형 인터페이스"
colors:
  paper: "#fdfdfb"
  paper-raised: "rgba(253, 253, 251, 0.98)"
  ink: "#0b0b0b"
  ink-muted: "rgba(11, 11, 11, 0.56)"
  ink-faint: "rgba(11, 11, 11, 0.42)"
  rule: "rgba(11, 11, 11, 0.25)"
  rule-soft: "rgba(11, 11, 11, 0.18)"
  placeholder: "#e9e9e5"
typography:
  display:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "clamp(48px, 7.4vw, 116px)"
    fontWeight: 700
    lineHeight: 0.96
    letterSpacing: "-0.075em"
  headline:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "clamp(19px, 2.7vw, 42px)"
    fontWeight: 550
    lineHeight: 1.04
    letterSpacing: "-0.055em"
  section-title:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "19px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  utility:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "10px"
    fontWeight: 450
    lineHeight: 1.2
    letterSpacing: "0"
rounded:
  square: "0px"
  subtle: "2px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  frame: "28px"
  section: "38px"
  page: "48px"
components:
  primary-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 17px"
    height: "40px"
  text-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0"
    height: "40px"
  popover:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "18px"
    border: "1px solid {colors.rule-soft}"
  book-tile:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0"
---

# Overview

**Creative North Star: Editorial Orbit / 편집된 궤도.** 이 시스템은 서점의 진열대보다 잘 편집된 독립출판물의 지면에 가깝다. 따뜻한 흰 종이 위에는 검정 잉크, 얇은 규칙선, 충분한 여백만 두고 실제 책 표지가 화면의 색과 리듬을 만든다. 홈의 원형 WebGL 링은 이 철학을 가장 강하게 보여 주는 시그니처이지만, 다른 화면이 모두 링을 가져야 하는 것은 아니다. 다른 기능은 같은 종이, 타이포 위계, 선, 이미지 처리, 짧은 움직임을 공유하면 된다.

현재 기준 구현은 `src/features/popular-ring/popular-ring.css`와 `src/features/popular-ring/PopularRingPage.tsx`다. 기존 `src/index.css`의 네이비·코랄·크림·Jua 카드 테마는 이전 방향이므로, 새 화면을 만들거나 기존 화면을 이 스타일로 옮길 때 홈의 토큰을 우선한다. 전역 토큰을 실제로 교체하기 전에는 페이지 루트에서 이 시스템을 스코프한다.

# Colors

**표지가 색을 담당한다.** 인터페이스 자체는 거의 무채색으로 유지하고, 책 표지·콘텐츠 이미지가 유일한 풍부한 색원이 되게 한다. 장식용 그라데이션, 다색 배경, 보라색 포인트, 발광 효과는 사용하지 않는다.

- `paper #fdfdfb`: 모든 기본 화면의 따뜻한 종이 배경. 순백색 대신 사용한다.
- `paper-raised rgba(253,253,251,.98)`: 필터·팝오버처럼 배경과 분리되어야 하는 떠 있는 면.
- `ink #0b0b0b`: 제목, 활성 상태, 주요 버튼, 포커스 링.
- `ink-muted rgba(11,11,11,.56)`: 저자·출판사·설명 등 보조 정보.
- `ink-faint rgba(11,11,11,.42)`: 힌트, 날짜, 비활성 보조 문구. 중요한 정보에는 쓰지 않는다.
- `rule rgba(11,11,11,.25)`: 섹션 구분선과 선택 가능한 항목의 기본 밑줄.
- `rule-soft rgba(11,11,11,.18)`: 팝오버 내부 구분선과 낮은 위계의 테두리.
- `placeholder #e9e9e5`: 표지가 없거나 아직 준비되지 않은 이미지 자리.

본문 대비가 필요한 정보는 `ink` 또는 `ink-muted`를 쓰고, `ink-faint`는 안내성 문장에만 제한한다. 활성 상태는 새 색을 추가하지 않고 검정 농도, 굵기, 밑줄로 표현한다.

# Typography

**크기는 계층을 만들고, 굵기는 상태를 알린다.** 기본 서체는 Pretendard Variable이다. 홈 스타일로 이관된 화면에서는 전역의 Jua 또는 IBM Plex Sans KR 설정을 그대로 상속하지 않는다.

- Display: 브랜드 워드마크 전용. `clamp(48px, 7.4vw, 116px)`, 700, 행간 `.96`, 자간 `-.075em`. 다른 긴 제목에 남용하지 않는다.
- Headline: 선택된 책이나 화면의 핵심 제목. `clamp(19px, 2.7vw, 42px)`, 550, 행간 `1.04`, 자간 `-.055em`, 최대 2줄.
- Section title: 목록·기능 섹션명. `19px`, 650, 행간 `1.25`.
- Body: 설명과 메타데이터. `12px`, 400, 행간 `1.5`.
- Label: 버튼·순위·상태. `11px`, 650, 행간 `1.2`.
- Utility: 날짜·개수·아주 낮은 위계의 보조 정보. `10px`, 450, 행간 `1.2`, 숫자는 tabular-nums.

제목은 `text-wrap: balance`를 사용하고 밀집된 목록은 한 줄 말줄임, 핵심 책 제목은 2줄 line clamp를 사용한다. 줄바꿈이 레이아웃 위치를 바꾸지 않도록 제목 영역 높이를 예약한다. 본문은 `text-wrap: pretty`를 권장한다.

# Layout

**선과 여백으로 그룹을 만든다.** 둥근 카드 상자를 반복하는 대신 섹션 시작점에 1px 규칙선을 놓고, 넉넉한 위아래 간격으로 정보 덩어리를 구분한다. 데스크톱 프레임 여백은 `28px`, 모바일은 `16px`를 기준으로 한다.

- 데스크톱 목록: 10열 그리드, 간격 `18px`.
- 태블릿 `<= 900px`: 5열.
- 모바일 `<= 640px`: 2열, 열 간격 `14px`, 행 간격 `24px`.
- 페이지 상단 도구 영역: 기본 높이 `40px`; 모바일 주요 터치 대상은 최소 `44px`를 확보한다.
- 섹션: 상단 `25px`, 하단 `38px`, 헤더와 콘텐츠 사이 `24px`.
- 콘텐츠 폭과 시그니처 그래픽은 고정 좌표 대신 `min()`, `max()`, `clamp()`, `aspect-ratio`, 컨테이너 크기에서 파생한 CSS 변수로 계산한다.

목록은 먼저 핵심 10개를 보여 주고 추가 항목은 사용자가 펼치게 한다. 필터 이동은 실제 섹션 ref를 기준으로 하며, 항목 이름이나 픽셀 좌표를 하드코딩하지 않는다. 고정 헤더·툴바는 `safe-area-inset-*`를 고려한다.

# Elevation & Depth

**기본 상태는 평면, 선택된 대상만 깊이를 얻는다.** 카드 전체에 그림자를 두지 않는다. 기본 섹션과 목록은 그림자 없이 종이 위에 직접 놓인다.

- 표지 확대: `0 14px 36px rgba(0,0,0,.15)`과 `1px rgba(0,0,0,.10)` 외곽선.
- 팝오버: `0 18px 50px rgba(0,0,0,.08)`과 `1px rule-soft` 테두리.
- 그리드 표지: 기본 그림자 없음. hover 시 `translateY(-3px)`와 opacity 변화만 사용.
- 강한 블러, 글로우, 큰 면적의 backdrop-filter는 사용하지 않는다.

레이어 순서는 콘텐츠 `0`, 링 라벨 `20`, 중앙 콘텐츠 `40`, 힌트 `45`, 도구막대 `60`, 로딩 `70`, 팝오버 `90`의 고정 스케일을 따른다.

# Shapes

**대부분은 직선이고, 하나의 결정적인 CTA만 캡슐형이다.** 필터, 목록, 표지, 섹션 면은 `0px` 또는 시각 보정용 `2px` 이하를 쓴다. 주요 CTA에는 `999px` pill을 허용한다.

- 표지 비율: 기본 `aspect-ratio: .7`; 원본 비율이 중요한 확대 표지는 `object-fit: contain`.
- 구분: 박스 테두리보다 밑줄과 상단 규칙선을 우선한다.
- 아이콘: 꼭 필요한 경우에만 단순 선형 SVG를 사용한다. `+`, `−`처럼 텍스트로 충분한 기호는 텍스트를 사용한다.
- 클릭 영역: 시각 요소가 작아도 버튼 전체 높이는 데스크톱 `40px`, 모바일 `44px`를 목표로 한다.

# Components

### Global navigation

따뜻한 종이 또는 흰색 면 위에 한 줄로 배치한다. 브랜드는 `ink`와 700, 활성 메뉴는 `ink`·굵기·2px 밑줄로 표시한다. 비활성 메뉴는 `ink-faint`이며 hover에서 `ink`로 돌아온다. 헤더 하단선은 전체 화면에 단 하나만 사용한다.

### Primary pill button

검정 배경, 종이색 텍스트, 높이 `40px`, 좌우 패딩 `17px`, 굵기 700. hover/focus에서 opacity `.68`, `translateY(-1px)`, `140ms ease-out`. 한 화면에 한두 개의 핵심 행동에만 쓴다.

### Ghost pill button

주요 캡슐과 나란히 서는 두 번째 행동. 같은 판형(높이 `40px`, 좌우 패딩 `17px`, `999px`)에 바탕을 비우고 `1px rule` 테두리만 남긴다. hover/focus는 테두리를 `ink`로 올린다. 이미 담긴 상태(`aria-pressed`)는 테두리 `ink`와 `rgba(11,11,11,.07)` 바탕으로 알린다. 채운 캡슐은 한 화면에 하나로 지킨다.

### Underline text button

배경과 박스 테두리 없이 2px 밑줄만 둔다. 높이 `40px`, `15px/700`을 기본으로 하고 보조 disclosure는 `11px/600`과 1px 선을 사용한다. hover/focus는 opacity 또는 잉크 농도만 바꾼다.

### Filter popover

폭은 `min(430px, viewport - 56px)`, 패딩 `18px`, 정사각 모서리, 얇은 테두리와 낮은 그림자를 사용한다. 내부 항목은 2열이며 이름과 숫자를 별도 그리드 열로 정렬한다. 열기·닫기는 opacity와 `translateY`만 `160ms ease-out`으로 움직인다.

### Book tile

순위, 표지, 제목, 저자 순서다. 표지는 `.7` 비율이며 제목은 한 줄 말줄임, 저자는 더 옅은 잉크를 쓴다. hover에서 표지만 살짝 위로 이동하고 카드 배경이나 별도 테두리를 추가하지 않는다. 이미지는 `loading="lazy"`, `decoding="async"`; 화면의 선택된 한 권만 eager 로드한다.

### Book preview

텍스트와 표지는 한 덩어리로 중앙 정렬하며, 제목 길이와 화면 크기에 관계없이 두 슬롯의 기준 위치를 유지한다. 제목은 약 10자 근처의 공백을 우선해 최대 2줄로 나누고, 1줄일 때 메타 정보가 위로 당겨지도록 실제 렌더 높이를 측정한다. 표지는 링과 겹치지 않도록 컨테이너 반경에서 크기와 이동량을 파생한다.

### Disclosure and section navigation

처음에는 10개를 노출하고 `11–20위 보기 +`처럼 결과 범위를 명시한다. 펼침 영역은 `aria-expanded`와 `aria-controls`를 연결하고 opacity/translate만 160ms 안에 움직인다. 필터에서 섹션을 고르면 실제 DOM 섹션으로 부드럽게 이동하며 reduced motion에서는 즉시 이동한다.

### Loading, empty, and error states

로딩은 레이아웃과 같은 구조의 skeleton 또는 2px 진행선으로 보여 준다. 무한 애니메이션은 화면 밖에서 중지한다. 빈 상태는 설명 하나와 다음 행동 하나를 함께 제공한다. 오류는 발생한 작업 근처에 짧게 표시하고 재시도 행동을 제공한다.

# Do's and Don'ts

### Do

- 한 화면의 UI 색은 종이와 잉크로 제한하고, 실제 책 표지가 색을 담당하게 한다.
- 섹션은 카드보다 1px 선과 여백으로 구분한다.
- 제목과 본문은 balance/pretty wrapping을 사용하고 제목 높이를 예약한다.
- 상태는 굵기, 밑줄, 농도, 위치의 작은 변화로 표현한다.
- 상호작용 피드백은 transform·opacity 위주, `130–180ms ease-out`, 최대 `200ms`로 유지한다.
- 키보드 포커스는 `2px ink` outline과 `3–4px` offset으로 분명히 표시한다.
- `prefers-reduced-motion`에서 스크롤·애니메이션을 즉시 또는 거의 즉시 끝낸다.
- 이미지의 lazy loading, 비동기 decoding, 제한된 동시 로딩을 기본으로 한다.

### Don't

- 모든 콘텐츠를 둥근 흰 카드에 넣거나 큰 2px 테두리를 반복하지 않는다.
- 홈 스타일 화면에 네이비·코랄·노랑 포인트를 섞지 않는다.
- 장식용 그라데이션, 글로우, 큰 블러, 무거운 그림자를 추가하지 않는다.
- 위치를 제목 글자 수, 항목 이름, 특정 해상도의 픽셀 좌표에 맞춰 하드코딩하지 않는다.
- width, height, top, left, margin을 애니메이션하지 않는다.
- 모든 표지 200개를 eager 로드하거나 고해상도 이미지를 작은 슬롯에 그대로 쓰지 않는다.
- 아이콘 대신 이모지를 사용하지 않는다.
- 시그니처 워드마크의 강한 자간을 일반 제목과 본문에 복제하지 않는다.
