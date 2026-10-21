import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { wsUrl } from '@/lib/serverOrigin'
import { docKeys } from './api'
import { docCacheName, docCacheUsable } from './localCache'

export interface CollabSession {
  doc: Y.Doc
  provider: WebsocketProvider
  /** 이 문서를 처음 여는지. 초안을 심을지 판단하는 데 쓴다. */
  isEmpty: boolean
  /**
   * 오프라인 편집이 브라우저 사본에 남는지. 앞사람 사본을 못 지운 세션은 사본 없이 열어(`localCache`)
   * 편집이 이 화면의 메모리에만 있다. 세션을 열 때 정해지고, 나중에 바뀌지 않는다.
   */
  persistent: boolean
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
 *   - IndexedDB         : 오프라인 영속. 사람이 바뀌면 지우고, 못 지웠으면 쓰지 않는다(`localCache`)
 *
 * 세션은 docId마다 새로 만들어야 하므로 호출하는 컴포넌트를 docId로 key 한다.
 */
export function useCollabSession(docId: string): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null)
  const [reopened, setReopened] = useState(false)

  useEffect(() => {
    // gc: false. 삭제된 내용을 수거하지 않는다. 수거해 버리면 과거 스냅샷을
    // 복원할 수 없어 버전 기록·되돌리기가 성립하지 않는다. 대신 문서가 계속
    // 커지므로, 릴레이(scripts/collab.js · backend realtime/yjs.py)도 같은 설정이어야 한다.
    const doc = new Y.Doc({ gc: false })
    const provider = new WebsocketProvider(relayUrl(), docId, doc)
    const persistence = docCacheUsable() ? new IndexeddbPersistence(docCacheName(docId), doc) : null
    // StrictMode의 두 번째 마운트에서 이미 정리된 세션을 넘기지 않도록 막는다.
    let cancelled = false
    // 백엔드는 붙을 때 access 가 만료돼 있거나, 60초마다 하는 재검증에서 세션이 회수돼 있으면
    // 4401 로 닫는다(재검증은 만료를 보지 않는다, 백엔드 #343). y-websocket 은
    // 44xx 를 영구 종료로 보고 다시 붙지 않으므로, HTTP 와 같은 refresh 경로(lib/api.ts)로 세션을
    // 살린 뒤 한 번 다시 붙인다. 살아나지 않으면 진짜 로그아웃. 화면은 오프라인 편집으로 남는다.
    provider.on('closed', (event) => {
      if (event.code === 4403) {
        // 열람 권한이 회수됐다(백엔드 #421, 붙을 때나 60초 재검증). 다시 붙어도 같다. 볼 수 없게 된
        // 내용을 이 브라우저에 남기지 않고(사용자 결정) 문서·트리를 다시 받는다. 문서 화면은 그 403 으로
        // 권한 없음 화면이 된다(`DocPane`). 그사이 친 글은 남지 않는다. 같은 브라우저의 다른 탭과
        // 잇는 통로도 끊는다(y-websocket 은 서버가 닫아도 그건 열어 둔다).
        // ponytail: 같은 문서를 연 다른 탭은 사본이 지워진 뒤 자기 4403(60초 안)까지 편집마다 닫힌 DB 에
        // 쓰다 예외를 낸다(사본 자체는 안 남는다). 사람이 바뀔 때 사본을 지우는 `localCache` 도 같다.
        provider.disconnect()
        void persistence?.clearData()
        void queryClient.invalidateQueries({ queryKey: docKeys.tree })
        void queryClient.invalidateQueries({ queryKey: docKeys.detail(docId) }).then(() => {
          // 다시 받은 문서가 열리면(그사이 권한이 돌아왔거나 판정이 잠깐 엇갈렸다) 이 세션은 릴레이도
          // 사본도 끊긴 채라 친 글이 어디에도 안 남는다. 세션을 새로 연다. 되풀이하지 않게 한 번만.
          if (cancelled || reopened) return
          if (queryClient.getQueryState(docKeys.detail(docId))?.status === 'error') return
          setSession(null)
          setReopened(true)
        })
        return
      }
      if (event.code !== 4401) return
      void api('/me').then(
        () => provider.connect(),
        () => undefined,
      )
    })

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
        persistent: persistence !== null,
      })
    }

    const afterLocal = () => {
      if (cancelled) return
      // 로컬만 보고 "빈 문서"라 판단하면, 릴레이에 이미 내용이 있는 문서에
      // 초안을 덧씌운다. 서버 상태까지 받아 본 뒤에 판단한다.
      if (provider.synced) return settle()
      provider.once('sync', settle)
      relayTimeout = window.setTimeout(settle, RELAY_WAIT_MS)
    }
    if (persistence) persistence.once('synced', afterLocal)
    else afterLocal()

    return () => {
      cancelled = true
      window.clearTimeout(relayTimeout)
      provider.destroy()
      void persistence?.destroy()
      doc.destroy()
    }
  }, [docId, reopened])

  return session
}

/** 제목만 바꾸려고 연 연결이 서버 상태를 받아 오기까지 기다리는 한도. */
const TITLE_SYNC_WAIT_MS = 5000
/** 바꾼 제목이 소켓으로 나가기를 기다렸다가 닫는다. 바로 닫으면 보내기 전에 끊길 수 있다. */
const TITLE_FLUSH_MS = 300

/**
 * 문서를 열지 않고 제목만 바꾼다(사이드바의 이름 변경).
 *
 * 제목의 원천은 Y.Doc 이다(`collabState` 의 `useCollabTitle`). 서버 사본(`PATCH /docs/{id}`)만
 * 고치면 문서를 열 때 Y.Doc 의 옛 제목이 다시 보이고, 다음 편집이 그 옛 제목을 서버에 도로
 * 덮어쓴다. 그래서 릴레이에 잠깐 붙어 서버 상태를 받은 **뒤에** 제목을 쓴다. 받기 전에 쓰면
 * 그사이 다른 사람이 고친 제목과 순서 없이 겨뤄 어느 쪽이 남을지 모른다.
 *
 * 본문은 건드리지 않는다. 브라우저 사본(IndexedDB)도 안 연다. 다음에 열 때 릴레이에서 받는다.
 * 릴레이에 못 붙으면 거절한다. 그때 서버 사본만 고치면 위의 어긋남이 생긴다.
 */
export function setCollabTitle(docId: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc({ gc: false })
    const provider = new WebsocketProvider(relayUrl(), docId, doc)
    // 이 연결은 접속자가 아니다. 그대로 두면 빈 상태가 나가서, 그 문서를 보고 있는 사람의
    // 접속자 줄에 「알 수 없음」 한 명이 잠깐 떴다 사라진다. 소켓이 열리기 전에 비운다.
    provider.awareness.setLocalState(null)
    let done = false
    let written = false
    const finish = (error?: Error) => {
      if (done) return
      done = true
      window.clearTimeout(timeout)
      provider.destroy()
      doc.destroy()
      if (error) reject(error)
      else resolve()
    }
    const unreachable = new Error('문서 서버에 연결하지 못해 이름을 바꾸지 못했습니다.')
    const timeout = window.setTimeout(() => finish(unreachable), TITLE_SYNC_WAIT_MS)
    // 서버가 거절한 연결(로그인이 풀렸다 4401, 볼 권한이 없다 4403, 문서가 없거나 휴지통에 있다 4404)은 다시 붙어도
    // 같다(y-websocket 은 44xx 를 영구 종료로 보고 `closed` 를 낸다). 5초를 기다리게 하지 않는다.
    provider.on('closed', () =>
      finish(
        new Error(
          '이 문서의 이름을 바꿀 수 없습니다. 지워졌거나, 볼 권한이 없거나, 로그인이 풀렸습니다.',
        ),
      ),
    )
    provider.on('sync', (synced: boolean) => {
      if (!synced || done || written) return
      written = true
      window.clearTimeout(timeout)
      doc.getMap<string>('meta').set('title', title)
      // 그사이 끊겼으면 제목이 서버에 못 갔다. 성공으로 넘기면 서버 사본만 새 이름이 된다.
      window.setTimeout(
        () => finish(provider.wsconnected ? undefined : unreachable),
        TITLE_FLUSH_MS,
      )
    })
  })
}
