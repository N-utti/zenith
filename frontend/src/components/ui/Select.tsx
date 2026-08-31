import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { CONTROL_BASE } from './Input'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

/**
 * 네이티브 `<select>`. 폼 안에서 값을 고를 때 쓴다.
 *
 * `Dropdown`(components/ui/Dropdown.tsx)과 역할이 다르다 — 이쪽은 **폼 값**이라
 * 라벨·필수·에러가 `Field`로 붙고 모바일에서 OS 기본 피커가 뜬다. `Dropdown`은
 * 툴바처럼 폼 밖에서 현재 값을 보여주며 바꾸는 자리에 쓴다.
 */
export function Select({
  options,
  placeholder,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: SelectOption[]
  /** 아직 고르지 않은 상태. 고르면 사라지지 않지만 값이 빈 문자열로 남는다. */
  placeholder?: string
}) {
  return (
    <div className="relative">
      <select className={cn(CONTROL_BASE, 'h-10 appearance-none pr-9 pl-3', className)} {...props}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="text-subtle pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
    </div>
  )
}
