import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

/**
 * 같은 브라우저의 탭 사이를 BroadcastChannel로 잇는 Yjs provider.
 *
 * 백엔드 WebSocket이 아직 없으므로 실시간 공동편집을 여기서 검증한다.
 * 서버가 생기면 이 클래스를 `y-websocket`의 WebsocketProvider로 갈아끼우면 된다 —
 * 프로토콜(sync + awareness)과 노출 인터페이스(`awareness`, `destroy()`)를
 * y-websocket과 똑같이 맞춰 둔 이유가 그것이다.
 */

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

export class BroadcastProvider {
  readonly room: string
  readonly doc: Y.Doc
  readonly awareness: Awareness
  private readonly channel: BroadcastChannel
  private readonly onDocUpdate: (update: Uint8Array, origin: unknown) => void
  private readonly onAwarenessUpdate: (changed: {
    added: number[]
    updated: number[]
    removed: number[]
  }) => void
  private readonly onUnload: () => void
  private destroyed = false

  constructor(room: string, doc: Y.Doc) {
    this.room = room
    this.doc = doc
    this.awareness = new Awareness(doc)
    this.channel = new BroadcastChannel(`moa.collab.${room}`)
    this.channel.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.receive(new Uint8Array(event.data))
    }

    this.onDocUpdate = (update, origin) => {
      // 다른 탭에서 받아 적용한 변경을 되돌려 보내지 않는다.
      if (origin === this) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      this.send(encoder)
    }
    doc.on('update', this.onDocUpdate)

    this.onAwarenessUpdate = ({ added, updated, removed }) => {
      const changed = [...added, ...updated, ...removed]
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, changed))
      this.send(encoder)
    }
    this.awareness.on('update', this.onAwarenessUpdate)

    // 탭이 갑자기 닫혀도 남은 탭에서 유령 커서가 남지 않게 정리한다.
    this.onUnload = () => this.clearLocalAwareness()
    window.addEventListener('beforeunload', this.onUnload)

    this.handshake()
  }

  /** 뒤늦게 연 탭이 기존 탭의 문서·참여자 상태를 따라잡는다. */
  private handshake() {
    const sync = encoding.createEncoder()
    encoding.writeVarUint(sync, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(sync, this.doc)
    this.send(sync)

    const query = encoding.createEncoder()
    encoding.writeVarUint(query, MESSAGE_QUERY_AWARENESS)
    this.send(query)
  }

  private send(encoder: encoding.Encoder) {
    if (this.destroyed) return
    // BroadcastChannel은 구조화 복제를 쓰므로 버퍼를 그대로 넘길 수 있다.
    this.channel.postMessage(encoding.toUint8Array(encoder).buffer)
  }

  private receive(data: Uint8Array) {
    const decoder = decoding.createDecoder(data)
    const encoder = encoding.createEncoder()

    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        // origin을 this로 넘겨야 onDocUpdate가 메아리를 걸러낸다.
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
        // 타입 바이트만 있으면 응답할 내용이 없다는 뜻이다.
        if (encoding.length(encoder) > 1) this.send(encoder)
        break
      }

      case MESSAGE_AWARENESS:
        applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this)
        break

      case MESSAGE_QUERY_AWARENESS: {
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
        )
        this.send(encoder)
        break
      }
    }
  }

  private clearLocalAwareness() {
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'provider destroyed')
  }

  destroy() {
    if (this.destroyed) return
    this.clearLocalAwareness()
    this.destroyed = true

    window.removeEventListener('beforeunload', this.onUnload)
    this.awareness.off('update', this.onAwarenessUpdate)
    this.doc.off('update', this.onDocUpdate)
    this.awareness.destroy()
    this.channel.close()
  }
}
