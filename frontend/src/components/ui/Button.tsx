import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-hover',
  ghost: 'text-muted hover:bg-surface-hover hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children?: ReactNode
  /** React 19: ref 는 일반 prop 이라 그대로 흘러간다. 포커스를 되돌릴 때 쓴다. */
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: Props) {
  return (
    <button
      className={cn(
        // whitespace-nowrap: 좁은 화면에서 라벨이 접히면 버튼이 «새 계 / 정» 처럼 쪼개지고
        // 높이 고정(h-8·h-10) 탓에 글자가 버튼 밖으로 삐져나온다. 버튼 라벨은 접지 않는다.
        'inline-flex cursor-pointer items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
