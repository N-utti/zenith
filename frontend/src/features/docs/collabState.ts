import { useEffect, useState, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'

export type CollabStatus = 'connecting' | 'connected' | 'disconnected'

/** awareness에 실어 보내는 참여자 정보. CollaborationCaret이 그대로 받아 쓴다. */
export interface CollabUser {
  name: string
  color: string
  clientId: number
  isSelf: boolean
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
 * 본문 폭 단계. 좁은 것부터. 첫 항목이 기본값이다.
 *
 * 꽉 차게는 옆 여백을 넓힌다(md:px-14 = 56px). 앞의 두 단계는 가운데 정렬로 남는 여백이 본문 밖에
 * 뜨는 것들의 자리가 되는데, 꽉 차게에서는 기본 여백(24px)뿐이라 왼쪽 블록 손잡이(52px)가 사이드바
 * 위로 나가고, 행 옆 표 버튼(46px + 틈)이 표의 마지막 칸과 맨 오른쪽 세로선을 덮는다.
 */
export const DOC_WIDTHS = [
  { value: 'normal', label: '보통', hint: '글 읽기 좋은 폭', className: 'max-w-3xl' },
  { value: 'wide', label: '넓게', hint: '표·사진이 많을 때', className: 'max-w-5xl' },
  { value: 'full', label: '꽉 차게', hint: '화면 폭 전부', className: 'max-w-none md:px-14' },
] as const

export type DocWidth = (typeof DOC_WIDTHS)[number]

/**
 * 폭을 바꾼 변경의 출처 표시. 문서 화면은 내 변경이 멎으면 «수정한 사람·시각» 을 갱신하고 버전을
 * 남기는데(DocWorkspace), 폭만 바꾼 것은 거기서 뺀다. 내용은 그대로인데 수정자가 바뀌고, 앞 버전과
 * 내용이 같은 버전이 하나 생긴다(버전은 폭을 싣지 않는다).
 */
export const WIDTH_ORIGIN = 'doc-width'

/**
 * 본문 폭도 제목처럼 Y.Doc 안에 둔다. 문서마다 정하고, 같이 보는 사람에게도 같은 폭으로 보인다.
 *
 * 사람마다 따로 두지 않는 이유는 표다. 표의 열 너비는 픽셀로 문서에 남는데, 본문 폭이 사람마다
 * 다르면 한 사람에게는 본문에 꼭 맞는 표가 다른 사람에게는 가로로 구른다.
 * 모르는 값(다음 버전이 더한 단계)이 들어 있으면 기본 폭으로 그린다.
 */
export function useCollabWidth(doc: Y.Doc) {
  const meta = doc.getMap<string>('meta')

  const stored = useSyncExternalStore(
    (onChange) => {
      meta.observe(onChange)
      return () => meta.unobserve(onChange)
    },
    () => meta.get('width'),
    () => undefined,
  )

  return {
    width: DOC_WIDTHS.find(({ value }) => value === stored) ?? DOC_WIDTHS[0],
    setWidth: (next: DocWidth['value']) =>
      doc.transact(() => meta.set('width', next), WIDTH_ORIGIN),
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

/**
 * 지금 이 문서를 함께 보고 있는 사람들. **본인을 포함한다.**
 *
 * "N명 편집 중"에서 본인을 빼면 두 명이 붙어 있을 때 "1명"이 되어, 그 1명이
 * 나인지 상대인지 읽히지 않는다. 본인 아바타를 세워 두면 내 커서 색이
 * 무엇인지도 함께 알 수 있다.
 */
export function usePresence(provider: WebsocketProvider): CollabUser[] {
  const read = () =>
    [...provider.awareness.getStates().entries()]
      .map(([clientId, state]) => {
        const user = (state as { user?: { name?: string; color?: string } }).user
        return {
          clientId,
          name: String(user?.name ?? '알 수 없음'),
          color: String(user?.color ?? '#888'),
          isSelf: clientId === provider.doc.clientID,
        }
      })
      // 본인을 맨 앞에 세운다.
      .sort((a, b) => Number(b.isSelf) - Number(a.isSelf))

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
