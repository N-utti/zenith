/**
 * 개발 서버 두 개를 한 번에 띄운다.
 *
 *   npm run dev       # vite(5173) + 개발 실시간 서버(1234)
 *
 * 각각 별도 자식 프로세스로 돌린다. 한 프로세스 안에서 돌리면(vite 플러그인 등)
 * 실시간 서버가 포트 충돌로 종료할 때 vite 까지 같이 죽는다.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = (script, args = []) => spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' })

const relay = run('scripts/dev-server.js')
// `npm run dev -- --host` 처럼 준 인자는 vite 에게 넘긴다.
const vite = run('node_modules/vite/bin/vite.js', process.argv.slice(2))

// 실시간 서버는 포트가 이미 잡혀 있으면 스스로 끝낸다(따로 켜 둔 `npm run server` 가 있을 때).
// 그건 정상이므로 vite 를 따라 죽이지 않는다.
relay.on('exit', (code) => {
  if (code) console.warn('[dev] 실시간 서버 없이 계속한다. 따로 켜 둔 `npm run server` 가 있으면 그게 그대로 쓰인다.')
})

// vite 가 끝나면(Ctrl+C 포함) 실시간 서버도 접는다.
vite.on('exit', (code) => {
  relay.kill()
  process.exit(code ?? 0)
})
