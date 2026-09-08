import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * 모든 입력이 공유하는 껍데기. 지금까지 여러 곳에 인라인으로 복사돼 있던 값이다.
 *
 * 포커스는 전역 `:focus-visible` 링이 아니라 **테두리 색**으로 표시한다. 입력은
 * 이미 테두리가 있어서, 그 위에 outline을 더하면 두 겹이 된다.
 */
export const CONTROL_BASE =
  'border-line bg-canvas text-fg placeholder:text-subtle focus:border-accent w-full rounded-lg border text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-danger'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** 왼쪽에 붙는 아이콘. 검색처럼 종류가 한눈에 보여야 하는 입력에 쓴다. */
  icon?: ReactNode
}

export function Input({ icon, className, ...props }: Props) {
  if (!icon) {
    return <input className={cn(CONTROL_BASE, 'h-10 px-3', className)} {...props} />
  }

  return (
    <div className="relative">
      <span className="text-subtle pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
        {icon}
      </span>
      <input className={cn(CONTROL_BASE, 'h-10 pr-3 pl-9', className)} {...props} />
    </div>
  )
}
