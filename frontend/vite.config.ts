import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 로컬 개발 시 /api 를 Spring Boot 로 프록시 (MSW 사용 시엔 MSW 가 먼저 가로챔).
  // 운영 백엔드에 붙여 보려면 .env.local 에 VITE_PROXY_TARGET=https://j15b102.p.ssafy.io — 단, 로그인 토큰은 운영 사이트에서 받아
  // localStorage 'auth' 를 옮겨야 한다(OAuth 콜백이 운영 프론트로 302 되기 때문). VITE_ENABLE_MSW=false 도 함께.
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:8080'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true, secure: true },
      },
    },
  }
})
