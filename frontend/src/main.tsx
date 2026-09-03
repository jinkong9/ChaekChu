import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
})

async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MSW !== 'true') return
  const { worker } = await import('./mocks/browser')
  // Service Worker 등록이 막히는 브라우저(임베디드 프리뷰 등)에서도 앱은 떠야 한다 —
  // 여기서 reject되면 아래 then이 실행되지 않아 화면이 통째로 비어 버린다.
  return worker.start({ onUnhandledRequest: 'bypass' }).catch((e: unknown) => {
    console.warn('[MSW] 목 워커를 시작하지 못했습니다 — 실 API로 진행합니다.', e)
  })
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
})
