import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { BroadcastProvider } from './BroadcastProvider'

export interface CollabSession {
  doc: Y.Doc
  provider: BroadcastProvider
  /** 이 문서를 처음 여는지. 초안을 심을지 판단하는 데 쓴다. */
  isEmpty: boolean
}

/**
 * 문서 하나에 대한 협업 세션을 연다.
 *
 * 본문의 원천은 서버가 아니라 Y.Doc이다. 지금은 IndexedDB에 영속되고
 * BroadcastChannel로 탭 사이를 동기화한다. 백엔드 WebSocket이 생기면
 * BroadcastProvider만 WebsocketProvider로 바꾸면 된다.
 *
 * 세션은 docId마다 새로 만들어야 하므로 호출하는 컴포넌트를 docId로 key 한다.
 */
export function useCollabSession(docId: string): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null)

  useEffect(() => {
    const doc = new Y.Doc()
    const provider = new BroadcastProvider(docId, doc)
    const persistence = new IndexeddbPersistence(`moa.doc.${docId}`, doc)

    // StrictMode의 두 번째 마운트에서 이미 정리된 세션을 넘기지 않도록 막는다.
    let cancelled = false

    persistence.once('synced', () => {
      if (cancelled) return
      setSession({
        doc,
        provider,
        isEmpty: doc.getXmlFragment('default').length === 0,
      })
    })

    return () => {
      cancelled = true
      provider.destroy()
      void persistence.destroy()
      doc.destroy()
    }
  }, [docId])

  return session
}
