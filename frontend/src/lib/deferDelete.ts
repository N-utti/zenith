import { useCallback, useSyncExternalStore } from 'react'
import type { ToastApi } from '@/components/ui/ToastContext'
import { ApiError } from '@/lib/api'

/** 되돌리기 토스트가 떠 있는 시간. 토스트가 닫혀야 실제로 지운다(마우스를 올리면 늘어난다). */
export const UNDO_MS = 10_000

/** 지우기를 기다리는 id. 목록 훅이 이걸 걸러서 화면에서는 바로 사라진 것처럼 보인다. */
let pending: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function setPending(next: ReadonlySet<string>) {
  pending = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * `{ items }` 목록에서 지우기를 기다리는 것을 뺀다. 목록 훅의 `select` 로 넘긴다. 그 사이 목록을
 * 서버에서 다시 받아도(창 초점, 다른 변경의 무효화) 지운 줄이 되살아나 보이지 않는다.
 */
export function useWithoutPending<T extends { id: string }>() {
  const ids = useSyncExternalStore(subscribe, () => pending)
  return useCallback(
    <D extends { items: T[] }>(data: D): D =>
      ids.size ? { ...data, items: data.items.filter((item) => !ids.has(item.id)) } : data,
    [ids],
  )
}

/**
 * 서버에 되살리는 길이 없는 지우기(영구 삭제, 글·채널 지우기)를 늦게 보낸다. 화면에서는 바로 빼고
 * 토스트에 되돌리기를 단다. 토스트가 되돌리기 없이 닫혀야(시간이 다 됐거나 X) `commit` 을 보낸다.
 * 따로 타이머를 재지 않는다. 마우스를 올리거나 탭이 숨으면 토스트 시간이 멈추는데, 그때 지우기만
 * 먼저 나가면 남은 되돌리기 버튼이 거짓말이 된다.
 *
 * 토스트는 화면을 떠나도 남는다. 그 사이 창을 닫거나 새로고침하면 보내지 못하고 남는다(지워지지
 * 않는 쪽으로 실패한다, 사용자 결정). 다른 사람 화면에는 그동안 그대로 보인다.
 *
 * ponytail: 거르는 것은 목록뿐이다. 기다리는 동안 그 주소로 다시 들어가면(뒤로 가기, 다른 탭) 아직
 * 살아 있는 것으로 열리고, 거기서 고치던 것은 토스트가 닫힐 때 같이 지워진다. 거슬리면 기다리는
 * id 를 읽는 훅을 내보내 그 화면이 막게 한다.
 */
export function deferDelete(
  toast: ToastApi,
  {
    ids,
    message,
    commit,
    failMessage,
  }: {
    ids: string[]
    message: string
    /**
     * 실제 지우기. 결과 알림이 따로 필요하면 여기서 띄운다. 일부만 지웠으면 지우지 못한 id 를
     * 돌려준다(그것만 목록에 다시 보인다).
     */
    commit: () => Promise<string[] | void>
    failMessage: string
  },
) {
  // 이미 기다리는 것을 또 지우면(남아 있던 다른 화면에서) 되돌리기가 둘이 되어, 하나를 되돌려도 다른
  // 쪽이 지운다. 받지 않는다.
  if (ids.some((id) => pending.has(id))) return toast.info('이미 삭제하는 중입니다.')
  setPending(new Set([...pending, ...ids]))
  const release = (back: string[]) =>
    setPending(new Set([...pending].filter((id) => !back.includes(id))))
  let done = false

  toast.success(message, {
    durationMs: UNDO_MS,
    // 성공하면 풀지 않는다. 지운 뒤 목록 다시 받기를 기다리지 않는 훅이 있어, 풀면 지운 줄이 잠깐
    // 돌아온다. 이미 없는 id 라 계속 걸러도 해가 없다. 실패하면 풀어서 다시 보이게 한다.
    onClose: () => {
      if (done) return
      done = true
      void commit().then(
        (kept) => kept?.length && release(kept),
        (err: unknown) => {
          release(ids)
          toast.error(err instanceof ApiError ? err.message : failMessage)
        },
      )
    },
    action: {
      label: '실행 취소',
      onClick: () => {
        if (done) return
        done = true
        release(ids)
      },
    },
  })
}
