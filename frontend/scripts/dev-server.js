/**
 * 개발용 실시간 서버.
 *
 * 백엔드가 아직 없으므로 두 가지를 대신한다.
 *   /collab/<문서ID>   문서 공동편집 (Yjs)     → collab.js
 *   /chat/*            채팅 REST + WebSocket   → chat.js
 *
 *   npm run server     # http://localhost:1234
 *
 * 앱은 이 포트에 직접 붙지 않는다. 항상 같은 오리진(/collab, /api/chat)으로
 * 붙고 vite가 여기로 넘긴다(vite.config.ts). 운영에서는 프록시 대상만 실제
 * 백엔드로 바꾸면 앱 코드는 그대로다.
 *
 * MSW가 REST를 대신하는데도 채팅만 여기 있는 이유는, MSW가 브라우저 안에서만
 * 돌기 때문이다. A가 보낸 메시지를 B의 MSW는 알지 못한다.
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { handleCollabConnection } from './collab.js'
import { handleChatConnection, handleChatRequest } from './chat.js'

const PORT = Number(process.env.PORT ?? 1234)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // vite 프록시를 거치므로 오리진은 항상 같다. 개발 편의로만 열어 둔다.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (url.pathname.startsWith('/chat')) {
    return handleChatRequest(req, res, url).catch((error) => {
      console.error('[chat] 요청 처리 실패:', error)
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ detail: '서버 오류' }))
    })
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ detail: '없는 경로입니다.' }))
})

// noServer — 경로를 보고 우리가 직접 업그레이드를 나눠 준다.
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname.startsWith('/collab/')) {
    const room = decodeURIComponent(url.pathname.slice('/collab/'.length))
    return wss.handleUpgrade(req, socket, head, (conn) => {
      handleCollabConnection(conn, room || 'default')
    })
  }

  if (url.pathname === '/chat/ws') {
    const userId = url.searchParams.get('userId') ?? ''
    return wss.handleUpgrade(req, socket, head, (conn) => {
      handleChatConnection(conn, userId)
    })
  }

  socket.destroy()
})

// 바인딩은 비동기다. 실패를 잡지 않으면 "실행 중"만 찍히고 아무 요청도
// 받지 못하는 유령 프로세스가 된다 (포트를 이미 다른 서버가 물고 있을 때).
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[dev-server] 포트 ${PORT}가 이미 사용 중입니다. 기존 서버를 끄거나 PORT=… 로 바꾸세요.`,
    )
  } else {
    console.error('[dev-server] 오류:', error)
  }
  process.exit(1)
})

server.listen(PORT, () => {
  console.log(`[dev-server] 실행 중 — http://localhost:${PORT}`)
  console.log('           /collab/<문서ID>  공동편집 · /chat/*  채팅')
})
