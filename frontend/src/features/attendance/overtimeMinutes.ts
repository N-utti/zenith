/**
 * 연장근로 분 산출(10 §5.3). 확정값은 서버가 `minutes`·`night_minutes` 로 준다.
 * 폼에서 미리 보여 주고, 목이 서버 값을 흉내 내는 데 쓴다.
 *
 * 근무일은 소정 종업(18:00) 이후만 인정한다. 쉬는 날(주말·휴일)은 일한 구간 전부가 휴일근로다
 * (근로기준법 56조 2항). 종료가 시작보다 이르면 자정을 넘긴 것으로 본다. 같으면 0 분이다
 * (24시간으로 읽지 않는다). 야간은 신청 구간과 [00:00, 06:00]·[22:00, 익일 06:00] 의 교집합.
 * 서버 `overtime_minutes` 와 같은 식이다.
 */
const WORK_END = 18 * 60
const NIGHT_SPANS = [
  [0, 6 * 60],
  [22 * 60, 30 * 60], // 익일 06:00
]

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** 서버가 받는 한 건의 길이 상한. 인정 분이 아니라 신고한 구간 길이로 잰다. */
export const OVERTIME_MAX_MINUTES = 12 * 60

/** 신고한 구간의 길이(분). 18:00 으로 당기기 전의 값이다. 비운 입력은 0. */
export function overtimeSpan(startTime: string, endTime: string): number {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return end < start ? end + 24 * 60 - start : end - start
}

export function overtimeMinutes(
  startTime: string,
  endTime: string,
  dayOff = false,
): {
  minutes: number
  night_minutes: number
} {
  let start = toMinutes(startTime)
  let end = toMinutes(endTime)
  // 비운 입력은 NaN. 비교가 전부 거짓이 되어 NaN 이 화면까지 새므로 여기서 0 으로 접는다.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { minutes: 0, night_minutes: 0 }
  if (end < start) end += 24 * 60
  if (!dayOff && start < WORK_END) start = WORK_END
  if (end <= start) return { minutes: 0, night_minutes: 0 }
  const night = NIGHT_SPANS.reduce(
    (sum, [lo, hi]) => sum + Math.max(0, Math.min(end, hi) - Math.max(start, lo)),
    0,
  )
  return { minutes: end - start, night_minutes: night }
}
