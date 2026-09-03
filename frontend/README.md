# Frontend — 도서 추천 서비스

React 19.2 · TypeScript 5.9 · Vite 7.3 · React Router 7 · TanStack Query 5 · Zustand 5 · Tailwind 4 · MSW

## 디자인 가이드

새 화면을 만들거나 기존 화면을 홈 화면 스타일로 정리할 때는 [DESIGN.md](./DESIGN.md)를 기준으로 작업합니다.
색상, 타이포그래피, 여백, 버튼, 책 표지, 반응형 레이아웃, 모션과 성능 규칙이 정리되어 있습니다.

## 실행

```bash
# Node.js 24 LTS 필요
npm ci
cp .env.example .env   # VITE_ENABLE_MSW=true면 백엔드 없이 mock으로 동작
npm run dev
```

## 구조

```
src/
  api/        # axios 클라이언트 + API 타입 (types.ts = 계약 초안, OpenAPI 확정 시 동기화)
  components/ # Layout(GNB), ProtectedRoute
  lib/        # trackEvent — 행동 이벤트 전송 (recommendation_id·rank 왕복)
  mocks/      # MSW 핸들러 — 계약 초안 기준 mock 응답
  pages/      # 6개 화면 (화면정의서 ID 매핑: ONB/REC/EXP/BOOK/LIB)
  stores/     # zustand (auth)
```

## 규칙

- API 응답 타입은 `src/api/types.ts`에만 정의하고 화면에서 직접 재정의하지 않는다.
- 행동 이벤트는 반드시 `trackEvent()`를 통해 보낸다 (직접 POST 금지).
- `package-lock.json`을 커밋하고 CI는 `npm ci`를 사용한다.
