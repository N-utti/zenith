import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * 체크박스와 라디오. 네이티브 input을 그대로 쓰되 모양만 바꾼다.
 * `div`로 흉내 내면 키보드·폼 제출·스크린리더를 전부 다시 만들어야 한다.
 *
 * `appearance-none` + `checked:` 로 칠하므로 다크 모드도 토큰을 따라간다.
 */
function Control({
  type,
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  type: 'checkbox' | 'radio'
  label: ReactNode
  /** 라벨 아래 한 줄 설명. 선택지가 헷갈릴 때만 쓴다. */
  description?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5',
        props.disabled && 'cursor-not-allowed opacity-55',
        className,
      )}
    >
      <input
        type={type}
        className={cn(
          'border-line-strong bg-canvas checked:border-accent checked:bg-accent mt-0.5 size-4 shrink-0 cursor-pointer appearance-none border transition-colors disabled:cursor-not-allowed',
          type === 'checkbox' ? 'rounded' : 'rounded-full',
          // 체크 표시는 배경 이미지로 그린다. 아이콘 컴포넌트를 겹치면 클릭 판정이 갈라진다.
          type === 'checkbox'
            ? "checked:bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 8.5l3.5 3.5L13 5'/%3E%3C/svg%3E\")] checked:bg-center checked:bg-no-repeat"
            : 'checked:border-[5px]',
        )}
        {...props}
      />
      <span className="min-w-0">
        <span className="text-fg block text-sm">{label}</span>
        {description && <span className="text-subtle block text-xs">{description}</span>}
      </span>
    </label>
  )
}

export function Checkbox(props: Omit<Parameters<typeof Control>[0], 'type'>) {
  return <Control type="checkbox" {...props} />
}

export function Radio(props: Omit<Parameters<typeof Control>[0], 'type'>) {
  return <Control type="radio" {...props} />
}
