export interface ConfirmOptions {
  /** 묻는 말. "이 문서를 삭제할까요?" 처럼 한 문장. */
  title: string
  /** 그 아래 덧붙이는 말. 되돌릴 수 없는지, 무엇이 같이 사라지는지. */
  description?: string
  /** 확인 버튼 이름. 하는 일을 그대로 쓴다(삭제·회수·변경). */
  confirmLabel: string
  /** 닫는 버튼 이름. 하는 일 자체가 "취소" 인 창(신청 취소)은 "닫기" 로 바꿔 둘이 헷갈리지 않게 한다. */
  cancelLabel?: string
  /** 되돌리기 어려운 일이면 확인 버튼을 붉게. */
  danger?: boolean
}

export type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void }

let current: ConfirmRequest | null = null
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

function set(next: ConfirmRequest | null) {
  current = next
  // 여는 것은 지금 처리 중인 키 입력이 다 끝난 뒤에 그린다. 입력 칸의 엔터(keydown)로 창을 열면 같은 엔터의
  // keypress 가 곧이어 초점 쪽으로 가는데, 그 사이 창이 그려져 확인 버튼이 초점을 받아 있으면 묻자마자
  // 확인으로 눌린다. 기본 confirm() 은 실행을 멈춰 이 일이 없었다. 닫는 것은 바로 그린다.
  if (next) setTimeout(notify)
  else notify()
}

/** 지금 떠 있는 요청. `ConfirmHost` 가 읽는다. */
export const getConfirmRequest = () => current

export const subscribeConfirm = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 확인 창을 띄우고 고른 결과를 돌려준다. 브라우저 기본 `confirm()` 대신 쓴다. 기본 창은 앱 모양과
 * 다르고, 데스크톱 앱에서는 창 제목에 주소가 찍힌다.
 *
 * 화면 맨 위의 `ConfirmHost`(ConfirmDialog.tsx)가 그린다. 이미 떠 있는 창이 있으면 그 창은 취소로
 * 닫고 새로 띄운다.
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  current?.resolve(false)
  return new Promise((resolve) => set({ ...options, resolve }))
}

/** 창에서 고른 결과를 부른 쪽에 돌려준다. */
export function answerConfirm(ok: boolean) {
  const request = current
  if (!request) return
  set(null)
  request.resolve(ok)
}
