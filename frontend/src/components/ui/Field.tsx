import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface FieldSlotProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/**
 * 라벨 · 도움말 · 에러를 입력에 **접근성까지 연결해서** 붙인다.
 *
 * 입력을 함수로 받는 이유는 `id`와 `aria-describedby`를 이 컴포넌트가 만들어
 * 넘겨줘야 해서다. 그냥 children으로 받으면 라벨과 입력이 이름만 나란히 있고
 * 실제로는 연결되지 않는다 — 지금 흩어져 있는 인라인 입력들이 정확히 그 상태다.
 *
 * ```tsx
 * <Field label="이메일" error={error}>
 *   {(slot) => <Input {...slot} type="email" value={v} onChange={...} />}
 * </Field>
 * ```
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string
  /** 입력 아래 보조 설명. 에러가 있으면 에러가 이 자리를 대신한다. */
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: (slot: FieldSlotProps) => ReactNode
}) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error ?? hint

  return (
    <div className={cn('block', className)}>
      <label htmlFor={id} className="text-fg mb-1.5 block text-sm font-medium">
        {label}
        {required && (
          <span className="text-danger ml-0.5" aria-label="필수">
            *
          </span>
        )}
      </label>

      {children({
        id,
        'aria-describedby': note ? noteId : undefined,
        'aria-invalid': error ? true : undefined,
      })}

      {note && (
        <p
          id={noteId}
          role={error ? 'alert' : undefined}
          className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-subtle')}
        >
          {note}
        </p>
      )}
    </div>
  )
}
