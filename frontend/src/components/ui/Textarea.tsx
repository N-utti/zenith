import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { CONTROL_BASE } from './Input'

/**
 * 여러 줄 입력. 컴포저(채팅·댓글·AI)와 신청 폼이 같은 껍데기를 쓴다.
 *
 * `submitOnEnter`는 컴포저용이다. Enter로 보내고 Shift+Enter로 줄을 바꾼다.
 * 신청 폼처럼 긴 글을 쓰는 자리에서는 켜지 않는다. 거기서 Enter가 제출이면
 * 줄바꿈을 하려다 폼이 날아간다.
 */
export function Textarea({
  className,
  submitOnEnter,
  onSubmitEnter,
  onKeyDown,
  ...props
}: ComponentProps<'textarea'> & {
  submitOnEnter?: boolean
  onSubmitEnter?: () => void
}) {
  return (
    <textarea
      className={cn(CONTROL_BASE, 'resize-y px-3 py-2.5', className)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        // 바깥 onKeyDown 이 Enter 를 먹었으면(멘션 목록에서 고르기) 보내지 않는다.
        if (e.defaultPrevented) return
        if (submitOnEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onSubmitEnter?.()
        }
      }}
      {...props}
    />
  )
}
