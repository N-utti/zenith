import { cn } from '@/lib/cn'

/** 한글 이름은 성을 뺀 이름 첫 글자가, 영문은 이니셜이 더 잘 읽힌다. */
function initials(name: string) {
  if (/^[가-힣]+$/.test(name)) return name.length > 1 ? name.slice(1, 3) : name
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

interface Props {
  name: string
  hue: number
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  xs: 'size-5 text-[9px]',
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-xs',
  lg: 'size-12 text-sm',
}

export function Avatar({ name, hue, size = 'md', className }: Props) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        SIZES[size],
        className,
      )}
      style={{
        backgroundColor: `oklch(0.9 0.06 ${hue})`,
        color: `oklch(0.38 0.13 ${hue})`,
      }}
    >
      {/* 줄 상자는 글꼴의 위아래 여백이 달라 글자가 위로 뜬다. 대문자 높이~기준선으로 잘라 원 가운데에 둔다. */}
      <span className="[text-box:trim-both_cap_alphabetic]">{initials(name)}</span>
    </span>
  )
}
