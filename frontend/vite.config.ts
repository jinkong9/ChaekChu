import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 로컬 개발 시 Spring Boot로 프록시 (MSW 사용 시엔 MSW가 먼저 가로챔)
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
