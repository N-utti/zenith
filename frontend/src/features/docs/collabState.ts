import { useEffect, useState, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'

export type CollabStatus = 'connecting' | 'connected' | 'disconnected'

/** awareness에 실어 보내는 참여자 정보. CollaborationCaret이 그대로 받아 쓴다. */
export interface CollabUser {
  name: string
  color: string
  clientId: number
}

/**
 * 아바타 hue를 커서 색으로 재사용해 목록·커서의 사람 색을 맞춘다.
 *
 * hex로 내보내는 게 중요하다. TipTap이 선택 영역 배경을 만들 때 색을 직접
 * 파싱하는데 `oklch()`를 이해하지 못하고 키 입력마다 경고를 뱉는다.
 */
export function hueToColor(hue: number): string {
  const saturation = 0.62
  const lightness = 0.48
  const chroma = saturation * Math.min(lightness, 1 - lightness)

  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12
    const value = lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0')
  }

  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/**
 * 제목도 본문과 같은 Y.Doc 안에 둔다.
 * 별도 경로로 관리하면 동시 편집 중 제목만 어긋나고, 서버 연동 시
 * 저장 지점이 둘로 갈라진다.
 */
export function useCollabTitle(doc: Y.Doc, fallback: string) {
  const meta = doc.getMap<string>('meta')

  const title = useSyncExternalStore(
    (onChange) => {
      meta.observe(onChange)
      return () => meta.unobserve(onChange)
    },
    () => meta.get('title') ?? fallback,
    () => fallback,
  )

  return {
    title,
    setTitle: (next: string) => meta.set('title', next),
    /** 아직 아무도 제목을 손대지 않았는지. 초안 심을 때 쓴다. */
    hasTitle: meta.get('title') !== undefined,
  }
}

/**
 * 릴레이 연결 상태.
 *
 * 화면에 드러내는 게 중요하다. 릴레이가 죽어 있으면 편집은 되는데 남에게
 * 전달만 안 되므로, 표시가 없으면 "공동편집이 원래 안 되는" 것처럼 보인다.
 */
export function useCollabStatus(provider: WebsocketProvider): CollabStatus {
  const [status, setStatus] = useState<CollabStatus>(() =>
    provider.wsconnected ? 'connected' : 'connecting',
  )

  useEffect(() => {
    const onStatus = (event: { status: CollabStatus }) => setStatus(event.status)
    provider.on('status', onStatus)
    return () => provider.off('status', onStatus)
  }, [provider])

  return status
}

/** 지금 이 문서를 함께 보고 있는 사람들. 본인은 제외한다. */
export function usePresence(provider: WebsocketProvider): CollabUser[] {
  const read = () =>
    [...provider.awareness.getStates().entries()]
      .filter(([clientId]) => clientId !== provider.doc.clientID)
      .map(([clientId, state]) => ({
        clientId,
        name: String((state as { user?: CollabUser }).user?.name ?? '알 수 없음'),
        color: String((state as { user?: CollabUser }).user?.color ?? '#888'),
      }))

  const [users, setUsers] = useState<CollabUser[]>(read)

  useEffect(() => {
    const onChange = () => setUsers(read)
    provider.awareness.on('change', onChange)
    return () => provider.awareness.off('change', onChange)
    // read는 provider만 참조한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  return users
}
