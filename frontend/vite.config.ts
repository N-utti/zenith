import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // MSW를 끄면(VITE_DISABLE_MSW=true) 이 프록시로 실제 FastAPI에 붙는다.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // 문서 공동편집 릴레이(`npm run collab`). 앱은 항상 같은 오리진의
      // /collab 으로 붙으므로, 운영에서는 이 대상만 실제 백엔드로 바꾸면 된다.
      '/collab': {
        target: 'ws://localhost:1234',
        ws: true,
        rewrite: (path) => path.replace(/^\/collab/, ''),
      },
    },
  },
})
