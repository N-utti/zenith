const UNIT = 'text-subtle ml-0.5 text-sm font-normal'

/**
 * 집계 숫자 하나. 연차 잔여(SCR-ATT-02)와 월 집계(SCR-ATT-01)가 같은 모양으로 쓴다.
 *
 * 숫자만 크게, 단위는 작게 그린다. 「1시간 30분」 처럼 단위가 값에 섞여 오는 글자열도 숫자와
 * 나머지를 갈라 같은 모양으로 맞춘다. 통째로 크게 두면 옆의 「1 일」 과 크기가 어긋난다.
 */
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
          strong
            ? 'text-fg text-2xl font-semibold tabular-nums'
            : 'text-muted text-2xl tabular-nums'
        }
      >
        {typeof value === 'number'
          ? value
          : // 홀수 자리가 숫자다(갈라내는 정규식의 묶음). 빈 조각은 그리지 않는다. 여백만 남는다.
            value.split(/(\d+(?:\.\d+)?)/).map((part, i) =>
              i % 2
                ? part
                : part && (
                    <span key={i} className={UNIT}>
                      {part}
                    </span>
                  ),
            )}
        {unit && <span className={UNIT}>{unit}</span>}
      </dd>
      {hint && <dd className="text-subtle text-[11px]">{hint}</dd>}
    </div>
  )
}
