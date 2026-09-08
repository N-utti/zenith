import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { api } from '@/lib/api'
import { wsUrl } from '@/lib/serverOrigin'

export interface CollabSession {
  doc: Y.Doc
  provider: WebsocketProvider
  /** 이 문서를 처음 여는지. 초안을 심을지 판단하는 데 쓴다. */
  isEmpty: boolean
}

/**
 * 릴레이는 백엔드의 /api/yjs/{docId} 다(04 §4.2). 신원은 핸드셰이크에 실리는 세션 쿠키가 말하고
 * `?token=` 은 없다(11 §7.5). MSW 모드에서는 vite 가 개발용 릴레이(:1234)로 넘겨준다(vite.config.ts).
 * 데스크탑 셸에서만 사내 서버 주소가 앞에 붙는다.
 */
function relayUrl(): string {
  return wsUrl('/api/yjs')
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
    // gc: false. 삭제된 내용을 수거하지 않는다. 수거해 버리면 과거 스냅샷을
    // 복원할 수 없어 버전 기록·되돌리기가 성립하지 않는다. 대신 문서가 계속
    // 커지므로, 릴레이(scripts/collab.js · backend realtime/yjs.py)도 같은 설정이어야 한다.
    const doc = new Y.Doc({ gc: false })
    const provider = new WebsocketProvider(relayUrl(), docId, doc)
    // 백엔드는 60초마다 쿠키를 재검증하고 access 가 만료돼 있으면 4401 로 닫는다. y-websocket 은
    // 44xx 를 영구 종료로 보고 다시 붙지 않으므로, HTTP 와 같은 refresh 경로(lib/api.ts)로 세션을
    // 살린 뒤 한 번 다시 붙인다. 살아나지 않으면 진짜 로그아웃. 화면은 오프라인 편집으로 남는다.
    provider.on('closed', (event) => {
      if (event.code !== 4401) return
      void api('/me').then(() => provider.connect(), () => undefined)
    })
    const persistence = new IndexeddbPersistence(`zenith.doc.${docId}`, doc)

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
