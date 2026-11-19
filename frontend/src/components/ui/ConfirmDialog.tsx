import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'
import { Button } from './Button'
import { answerConfirm, getConfirmRequest, subscribeConfirm } from './confirm'
import { Modal } from './Modal'

/** `askConfirm`(./confirm.ts)이 띄우는 창. 라우터 안에 한 번만 둔다(App.tsx). */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, getConfirmRequest)

  // 화면을 옮기면(뒤로 가기, ⌘K, 데스크톱 탭) 취소로 닫는다. 남겨 두면 떠난 화면의 항목을 지우고,
  // 그 화면이 붙여 둔 알림은 사라진 뒤라 무엇이 지워졌는지 모른다.
  const { pathname } = useLocation()
  useEffect(() => () => answerConfirm(false), [pathname])

  return (
    <Modal
      open={request !== null}
      onClose={() => answerConfirm(false)}
      title={request?.title ?? ''}
      description={request?.description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => answerConfirm(false)}>
            {request?.cancelLabel ?? '취소'}
          </Button>
          {/* 초점을 받아 엔터 한 번으로 누른다. 우클릭 메뉴에서 Delete 로 연 창도 엔터로 끝난다. */}
          <Button
            variant={request?.danger ? 'danger' : 'primary'}
            size="sm"
            data-autofocus
            onClick={() => answerConfirm(true)}
          >
            {request?.confirmLabel}
          </Button>
        </>
      }
    />
  )
}
