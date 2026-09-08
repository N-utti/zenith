/** 집계 숫자 하나. 연차 잔여(SCR-ATT-02)와 월 집계(SCR-ATT-01)가 같은 모양으로 쓴다. */
export function Stat({
  label,
  value,
  unit = '일',
  hint,
  strong,
}: {
  label: string
  value: number | string
  unit?: string
  /** 숫자 아래 작은 설명. 연장근로의 "승인 신고 기준"처럼 값의 성격을 밝힐 때(10 §5.3). */
  hint?: string
  strong?: boolean
}) {
  return (
    <div>
      <dt className="text-subtle text-xs">{label}</dt>
      <dd
        className={
          strong ? 'text-fg text-2xl font-semibold tabular-nums' : 'text-muted text-2xl tabular-nums'
        }
      >
        {value}
        {unit && <span className="text-subtle ml-0.5 text-sm font-normal">{unit}</span>}
      </dd>
      {hint && <dd className="text-subtle text-[11px]">{hint}</dd>}
    </div>
  )
}
