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
    // 0.0.0.0 바인딩. 같은 네트워크의 다른 기기(휴대폰 등)에서 접속할 수 있다.
    host: true,
    port: 5173,
    // 위에서부터 먼저 일치하는 규칙이 이긴다. /api/chat 이 /api 보다 앞이어야 한다.
    proxy: {
      // 채팅은 MSW로 만들 수 없다(브라우저마다 따로 돌아 메시지가 공유되지 않는다).
      // 개발 서버(`npm run server`)가 REST와 WebSocket을 함께 맡는다.
      '/api/chat': {
        target: 'http://localhost:1234',
        ws: true,
        rewrite: (path) => path.replace(/^\/api\/chat/, '/chat'),
      },
      // MSW를 끄면(VITE_DISABLE_MSW=true) 이 프록시로 실제 FastAPI에 붙는다.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // 문서 공동편집. 앱은 항상 같은 오리진의 /collab 으로 붙으므로,
      // 운영에서는 이 대상만 실제 백엔드로 바꾸면 된다.
      '/collab': {
        target: 'ws://localhost:1234',
        ws: true,
      },
    },
  },
})
