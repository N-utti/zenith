/**
 * 사외 시연판. 백엔드 없이 목 데이터로 도는 제니스를 포트 하나로 띄운다.
 *
 *   npm run demo                # 시연 빌드(dist-demo) 후 http://localhost:8080
 *   npm run demo -- --no-build  # 이미 만든 dist-demo 로 바로 띄운다
 *   npm run demo -- --build-only  # 빌드와 실명 검사만 하고 끝낸다(시연 msi 빌드 단계)
 *   PORT=9000 npm run demo
 *   HOST=0.0.0.0 npm run demo   # 다른 PC 에서도 받는다(기본은 이 PC 안에서만)
 *
 * REST 는 브라우저 안의 MSW 가 흉내 낸다(VITE_DEMO=true 빌드). MSW 로 못 하는 채팅과 문서 공동편집은
 * 개발 릴레이(chat.js·collab.js)를 그대로 붙인다. 개발 때 vite 프록시가 하던 경로 바꾸기를 여기서 한다.
 * 대화·편집은 메모리에만 있어 서버를 끄면 처음 상태로 돌아간다.
 *
 * MSW 는 서비스 워커라 https 나 localhost 에서만 켜진다. 바깥에 보이려면 https 프록시·터널을 앞에 둔다.
 * 그 프록시도 이 PC 의 127.0.0.1 로 붙으므로 기본 바인딩으로 충분하다.
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { WebSocketServer } from 'ws'
import users from '../src/mocks/users.json' with { type: 'json' }
import { findLeaks, swapNames } from './demo-names.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(root, 'dist-demo')
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '127.0.0.1'

if (!process.argv.includes('--no-build')) {
  // env 파일보다 process.env 가 이긴다. 실서버용 값(MSW 끄기, 서버 오리진)이 이 PC 에 있어도 시연판은 목으로 돈다.
  Object.assign(process.env, { VITE_DEMO: 'true', VITE_DISABLE_MSW: '', VITE_SERVER_ORIGIN: '' })
  await build({ root, build: { outDir, emptyOutDir: true } })

  // 실명이 하나라도 남으면 띄우지 않는다. 대응표(demo-names.js)에 사람이 빠진 경우다.
  const files = await readdir(outDir, { recursive: true, withFileTypes: true })
  const leaks = new Set()
  for (const f of files.filter((f) => f.isFile() && /\.(js|html|json|webmanifest)$/.test(f.name))) {
    const text = await readFile(path.join(f.parentPath, f.name), 'utf8')
    for (const leak of findLeaks(text, users)) leaks.add(leak)
  }
  if (leaks.size) {
    console.error(`[demo] 시연 빌드에 실명이 남았습니다: ${[...leaks].join(', ')}. scripts/demo-names.js 에 넣으세요.`)
    process.exit(1)
  }
  // 시연 msi 는 빌드만 쓴다(apps/desktop 의 tauri.demo.conf.json).
  if (process.argv.includes('--build-only')) process.exit(0)
}
if (!existsSync(path.join(outDir, 'index.html'))) {
  console.error('[demo] dist-demo 가 없습니다. --no-build 없이 npm run demo 로 먼저 빌드하세요.')
  process.exit(1)
}

// 채팅 명단도 화면과 같은 가상 인물이어야 한다. chat.js 는 이 users.json 객체로 명단을 만들므로,
// 이름을 먼저 바꾼 뒤에 가져온다(정적 import 로 올리면 바꾸기 전에 명단이 만들어진다).
for (const u of users) {
  u.name = swapNames(u.name)
  u.email = swapNames(u.email)
}
const { handleChatConnection, handleChatRequest, sessionUserId } = await import('./chat.js')
const { handleCollabConnection } = await import('./collab.js')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 응답을 보내다 실패하면 500. 이미 헤더가 나갔으면 연결을 끊는다(writeHead 를 또 부르면 그게 던진다). */
const fail = (res, label) => (error) => {
  console.error(`[demo] ${label} 실패:`, error)
  if (res.headersSent) res.destroy()
  else json(res, 500, { detail: '서버 오류' })
}

/** `//[` 같은 요청 대상은 URL 이 던진다. 남이 접속하는 서버라 null 로 받아 거절한다. */
function parseUrl(req) {
  try {
    return new URL(req.url ?? '/', 'http://demo')
  } catch {
    return null
  }
}

/** dist-demo 안의 파일을 준다. 없는 경로는 index.html(화면 라우팅이 받는다). */
async function serveStatic(res, pathname) {
  let file
  try {
    file = path.join(outDir, path.normalize(decodeURIComponent(pathname)))
  } catch {
    return json(res, 400, { detail: '잘못된 경로입니다.' })
  }
  if (file.startsWith(outDir + path.sep)) {
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      return res.end(body)
    } catch {
      // 없는 파일·디렉터리면 아래 index.html 로.
    }
  }
  const index = await readFile(path.join(outDir, 'index.html'))
  res.writeHead(200, { 'Content-Type': TYPES['.html'] })
  res.end(index)
}

const server = createServer((req, res) => {
  const url = parseUrl(req)
  if (!url) return json(res, 400, { detail: '잘못된 주소입니다.' })

  if (url.pathname.startsWith('/api/channels')) {
    url.pathname = url.pathname.replace(/^\/api/, '/chat')
    return handleChatRequest(req, res, url).catch(fail(res, '채팅 요청'))
  }
  // 나머지 /api 는 MSW 가 브라우저에서 받는다. 여기 닿았다면 서비스 워커가 안 켜진 것.
  if (url.pathname.startsWith('/api/')) {
    return json(res, 404, { code: 'NOT_FOUND', detail: '시연판에 없는 경로입니다.' })
  }
  serveStatic(res, url.pathname).catch(fail(res, '파일 응답'))
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  // 업그레이드는 동기라 여기서 던지면 서버가 통째로 죽는다. 무엇이 실패하든 이 연결만 끊는다.
  try {
    const url = parseUrl(req)
    if (url?.pathname === '/api/ws') {
      // 누구인지는 세션 쿠키가 말한다. dev-server.js 와 같다.
      const userId = sessionUserId(req) ?? ''
      return wss.handleUpgrade(req, socket, head, (conn) => handleChatConnection(conn, userId))
    }
    if (url?.pathname.startsWith('/api/yjs/')) {
      const room = decodeURIComponent(url.pathname.slice('/api/yjs/'.length)) || 'default'
      return wss.handleUpgrade(req, socket, head, (conn) => handleCollabConnection(conn, room))
    }
  } catch (error) {
    console.error('[demo] 업그레이드 실패:', error)
  }
  socket.destroy()
})

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `[demo] 포트 ${PORT} 가 이미 사용 중입니다. PORT=… 로 바꾸세요.` : error)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`[demo] 제니스 시연판 실행 중. http://localhost:${PORT} (받는 주소 ${HOST})`)
})
