import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'

export interface CollabSession {
  doc: Y.Doc
  provider: WebsocketProvider
  /** 이 문서를 처음 여는지. 초안을 심을지 판단하는 데 쓴다. */
  isEmpty: boolean
}

/**
 * 릴레이는 같은 오리진의 /collab 으로 붙는다. vite가 개발용 y-websocket
 * 서버(:1234)로 넘겨준다. 운영에서는 프록시 대상만 실제 백엔드로 바꾸면 되고
 * 앱 코드는 그대로다.
 */
function relayUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/collab`
}

/** 릴레이가 죽어 있어도 편집은 계속돼야 하므로, 서버 동기화를 무한정 기다리지 않는다. */
const RELAY_WAIT_MS = 1200

/**
 * 문서 하나에 대한 협업 세션을 연다.
 *
 * 본문의 원천은 서버 REST가 아니라 Y.Doc이다. 세 경로로 동기화된다.
 *   - WebSocket 릴레이  : 다른 사람 / 다른 브라우저
 *   - BroadcastChannel  : 같은 브라우저의 다른 탭 (y-websocket 내장)
 *   - IndexedDB         : 오프라인 영속
 *
 * 세션은 docId마다 새로 만들어야 하므로 호출하는 컴포넌트를 docId로 key 한다.
 */
export function useCollabSession(docId: string): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null)

  useEffect(() => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(relayUrl(), docId, doc)
    const persistence = new IndexeddbPersistence(`moa.doc.${docId}`, doc)

    // StrictMode의 두 번째 마운트에서 이미 정리된 세션을 넘기지 않도록 막는다.
    let cancelled = false
    let settled = false
    let relayTimeout: number | undefined

    const settle = () => {
      if (cancelled || settled) return
      settled = true
      window.clearTimeout(relayTimeout)
      setSession({
        doc,
        provider,
        isEmpty: doc.getXmlFragment('default').length === 0,
      })
    }

    persistence.once('synced', () => {
      if (cancelled) return
      // 로컬만 보고 "빈 문서"라 판단하면, 릴레이에 이미 내용이 있는 문서에
      // 초안을 덧씌운다. 서버 상태까지 받아 본 뒤에 판단한다.
      if (provider.synced) return settle()
      provider.once('sync', settle)
      relayTimeout = window.setTimeout(settle, RELAY_WAIT_MS)
    })

    return () => {
      cancelled = true
      window.clearTimeout(relayTimeout)
      provider.destroy()
      void persistence.destroy()
      doc.destroy()
    }
  }, [docId])

  return session
}
