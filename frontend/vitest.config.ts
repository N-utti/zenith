import path from 'node:path'
import { defineConfig } from 'vitest/config'

// 브라우저 없이 도는 단위 테스트. `npm test`. 환경은 jsdom — document.cookie 같은 DOM API 가 필요하다.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
