import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'

/**
 * 모든 입력이 공유하는 껍데기. 지금까지 여러 곳에 인라인으로 복사돼 있던 값이다.
 *
 * 포커스는 전역 `:focus-visible` 링이 아니라 **테두리 색**으로 표시한다. 입력은
 * 이미 테두리가 있어서, 그 위에 outline을 더하면 두 겹이 된다.
 */
/*
 * pointer-coarse:text-base — 터치 기기에서는 16px 이상으로 키운다(지금은 17px, index.css 의 손가락 기기 단계).
 * iOS Safari 는 글자가 16px 보다 작은 입력칸에 포커스가 가면 화면을 확대한다. 그 순간 좌우가
 * 잘리고, 확대 애니메이션 중에 탭 좌표가 어긋나 첫 탭이 먹지 않는 일까지 생긴다. 마우스를
 * 쓰는 화면은 14px 그대로다.
 */
export const CONTROL_BASE =
  'border-line bg-canvas text-fg placeholder:text-subtle focus:border-accent w-full rounded-lg border text-sm pointer-coarse:text-base outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-danger'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** 왼쪽에 붙는 아이콘. 검색처럼 종류가 한눈에 보여야 하는 입력에 쓴다. */
  icon?: ReactNode
  /** 초점을 옮겨야 할 때. React 19 부터는 함수 컴포넌트도 `ref` 를 보통 속성으로 받는다. */
  ref?: Ref<HTMLInputElement>
  /** 아이콘이 있을 때 안쪽 입력칸에 붙일 것. `className` 은 바깥 틀로 간다(아래 주석). */
  inputClassName?: string
}

export function Input({ icon, className, inputClassName, ref, ...props }: Props) {
  if (!icon) {
    return <input ref={ref} className={cn(CONTROL_BASE, 'h-10 px-3', className)} {...props} />
  }

  /*
   * 아이콘이 있으면 `className` 은 바깥 틀에 붙는다. 아이콘은 틀 높이의 가운데에 서는데,
   * `mb-4` 같은 여백이 안쪽 입력칸에 붙으면 틀이 그만큼 길어져 아이콘이 아래로 처진다.
   * 아이콘 자리는 `flex` 다. 인라인이면 글줄 높이만큼 기준선 아래 틈이 생겨 또 처진다.
   */
  return (
    <div className={cn('relative', className)}>
      <span className="text-subtle pointer-events-none absolute inset-y-0 left-3 flex items-center">
        {icon}
      </span>
      <input ref={ref} className={cn(CONTROL_BASE, 'h-10 pr-3 pl-9', inputClassName)} {...props} />
    </div>
  )
}
