/**
 * 문서 공동편집용 개발 릴레이.
 *
 * 백엔드 WebSocket 엔드포인트가 생기기 전까지 그 자리를 대신한다.
 * MSW가 REST를 대신하는 것과 같은 역할이다.
 *
 *   npm run collab      # ws://localhost:1234
 *
 * 앱은 이 포트에 직접 붙지 않는다. 항상 같은 오리진의 /collab 으로 붙고
 * vite가 여기로 넘긴다 (vite.config.ts). 운영에서는 프록시 대상만 실제
 * 백엔드로 바꾸면 앱 코드는 그대로다.
 *
 * ── 백엔드가 구현해야 할 프로토콜 ──────────────────────────────
 * y-websocket과 동일하다. 바이너리 프레임이고 첫 varuint가 메시지 종류다.
 *
 *   0 = sync       y-protocols/sync    문서 상태 동기화 (step1/step2/update)
 *   1 = awareness  y-protocols/awareness  커서·참여자 정보
 *
 * 접속 경로의 마지막 세그먼트가 문서 ID다. 서버는 문서마다 Y.Doc을 하나
 * 들고 있으면서, 받은 업데이트를 자기 문서에 적용하고 같은 방의 나머지
 * 연결에 그대로 중계한다.
 *
 * 이 릴레이는 메모리에만 보관한다. 실제 백엔드는 여기서 Y.Doc 상태를
 * 주기적으로 영속화해야 한다 (설계상 문서 본문의 원천이 이 상태다).
 */
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const PORT = Number(process.env.PORT ?? 1234)

/** @type {Map<string, {doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<import('ws').WebSocket, Set<number>>}>} */
const rooms = new Map()

function send(conn, encoder) {
  if (conn.readyState !== conn.OPEN) return
  conn.send(encoding.toUint8Array(encoder), (error) => {
    if (error) conn.close()
  })
}

function broadcast(room, encoder, except) {
  const payload = encoding.toUint8Array(encoder)
  for (const conn of room.conns.keys()) {
    if (conn === except || conn.readyState !== conn.OPEN) continue
    conn.send(payload, (error) => {
      if (error) conn.close()
    })
  }
}

function getRoom(name) {
  const existing = rooms.get(name)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  // 서버 자신은 참여자가 아니다. 커서를 만들지 않는다.
  awareness.setLocalState(null)

  const room = { doc, awareness, conns: new Map() }

  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    // 보낸 쪽에는 되돌려 주지 않는다.
    broadcast(room, encoder, origin)
  })

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = [...added, ...updated, ...removed]

    // 연결이 끊길 때 유령 커서를 지우려면 어느 연결이 어느 clientId를
    // 들고 있는지 알아야 한다.
    const controlled = room.conns.get(origin)
    if (controlled) {
      for (const clientId of added) controlled.add(clientId)
      for (const clientId of removed) controlled.delete(clientId)
    }

    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    )
    broadcast(room, encoder, null)
  })

  rooms.set(name, room)
  console.log(`[collab] 방 열림: ${name}`)
  return room
}

const wss = new WebSocketServer({ port: PORT })

// 바인딩은 비동기다. 실패를 잡지 않으면 "실행 중"만 찍히고 아무 요청도
// 받지 못하는 유령 프로세스가 된다 (포트를 이미 다른 릴레이가 물고 있을 때).
wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[collab] 포트 ${PORT}가 이미 사용 중입니다. 기존 릴레이를 끄거나 PORT=… 로 바꾸세요.`,
    )
  } else {
    console.error('[collab] 서버 오류:', error)
  }
  process.exit(1)
})

wss.on('listening', () => {
  console.log(`[collab] 개발 릴레이 실행 중 — ws://localhost:${PORT}`)
})

wss.on('connection', (conn, request) => {
  conn.binaryType = 'arraybuffer'

  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const name = decodeURIComponent(path.slice(1)) || 'default'
  const room = getRoom(name)
  room.conns.set(conn, new Set())
  console.log(`[collab] ${name} 접속 (${room.conns.size}명)`)

  conn.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    const encoder = encoding.createEncoder()

    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        // origin을 conn으로 넘겨야 위 doc.on('update')가 발신자를 걸러낸다.
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn)
        // 타입 바이트만 남았으면 돌려줄 내용이 없다는 뜻이다.
        if (encoding.length(encoder) > 1) send(conn, encoder)
        break
      }

      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        )
        break
    }
  })

  conn.on('close', () => {
    const controlled = room.conns.get(conn)
    room.conns.delete(conn)
    if (controlled?.size) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], null)
    }
    console.log(`[collab] ${name} 해제 (${room.conns.size}명)`)
    // 아무도 없으면 방을 접는다. 실제 백엔드라면 여기서 영속화한다.
    if (room.conns.size === 0) {
      room.doc.destroy()
      rooms.delete(name)
    }
  })

  // 접속하자마자 서버 상태를 물어보고, 이미 있는 참여자들을 알려 준다.
  const sync = encoding.createEncoder()
  encoding.writeVarUint(sync, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(sync, room.doc)
  send(conn, sync)

  const states = room.awareness.getStates()
  if (states.size > 0) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    )
    send(conn, encoder)
  }
})
