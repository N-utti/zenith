import type { ButtonHTMLAttributes, ReactNode } from 'react'
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
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: Props) {
  return (
    <button
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
