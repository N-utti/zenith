/**
 * 신청 기간의 차감 일수. 확정값은 서버가 `days` 로 준다(04 §10.2). 여기서는 폼에서
 * "며칠 차감되는지"를 미리 보여 주고, 잔여 초과를 제출 전에 막는 용도다.
 *
 * ponytail: 주말만 뺀다. 서버(#316)는 휴일까지 빼서 세므로, 휴일이 낀 기간은 여기 값이 서버보다
 * 크다(잔여 초과를 너무 일찍 막을 수 있다). 확정값은 응답의 `days` 다.
 */
export function countWorkdays(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split('-').map(Number)
  const [ey, em, ed] = endIso.split('-').map(Number)
  const cursor = new Date(sy, sm - 1, sd)
  const end = new Date(ey, em - 1, ed)
  let days = 0
  while (cursor.getTime() <= end.getTime()) {
    const weekday = cursor.getDay()
    if (weekday !== 0 && weekday !== 6) days += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

/** 반차는 하루 0.5, 종일 휴가는 근무일 수 × 차감 배율(무급·공가는 0). */
export function leaveDays(
  type: { unit: 'day' | 'half'; deduct_days: number },
  startIso: string,
  endIso: string,
): number {
  if (type.unit === 'half') return type.deduct_days
  return countWorkdays(startIso, endIso) * type.deduct_days
}
