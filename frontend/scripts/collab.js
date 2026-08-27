/**
 * 문서 공동편집 릴레이. dev-server.js가 /collab/<문서ID> 업그레이드를 여기로 넘긴다.
 *
 * ── 백엔드가 구현해야 할 프로토콜 ──────────────────────────────
 * y-websocket과 동일하다. 바이너리 프레임이고 첫 varuint가 메시지 종류다.
 *
 *   0 = sync       y-protocols/sync       문서 상태 동기화 (step1/step2/update)
 *   1 = awareness  y-protocols/awareness  커서·참여자 정보
 *
 * 서버는 문서마다 Y.Doc을 하나 들고 있으면서, 받은 업데이트를 자기 문서에
 * 적용하고 같은 방의 나머지 연결에 그대로 중계한다.
 *
 * 이 릴레이는 메모리에만 보관한다. 실제 백엔드는 여기서 Y.Doc 상태를
 * 주기적으로 영속화해야 한다 (설계상 문서 본문의 원천이 이 상태다).
 */
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

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

  // gc: false — 클라이언트와 맞춰야 한다. 여기서 삭제 내용을 수거하면
  // 나중에 접속한 사람이 과거 버전을 복원할 수 없다 (useCollabSession.ts 참조).
  const doc = new Y.Doc({ gc: false })
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

export function handleCollabConnection(conn, name) {
  conn.binaryType = 'arraybuffer'

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
}
