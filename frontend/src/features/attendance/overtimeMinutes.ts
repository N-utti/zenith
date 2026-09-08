/**
 * 연장근로 분 산출(10 §5.3). 확정값은 서버가 `minutes`·`night_minutes` 로 준다.
 * 폼에서 미리 보여 주고, 목이 서버 값을 흉내 내는 데 쓴다.
 *
 * 소정 종업(18:00) 이후만 인정한다. 종료가 시작보다 이르면 자정을 넘긴 것으로 본다.
 * 같으면 0 분이다(24시간으로 읽지 않는다). 야간은 신청 구간과 [22:00, 익일 06:00] 의 교집합.
 */
const WORK_END = 18 * 60
const NIGHT_START = 22 * 60
const NIGHT_END = 30 * 60 // 익일 06:00

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function overtimeMinutes(
  startTime: string,
  endTime: string,
): {
  minutes: number
  night_minutes: number
} {
  let start = toMinutes(startTime)
  let end = toMinutes(endTime)
  // 비운 입력은 NaN. 비교가 전부 거짓이 되어 NaN 이 화면까지 새므로 여기서 0 으로 접는다.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { minutes: 0, night_minutes: 0 }
  if (end < start) end += 24 * 60
  if (start < WORK_END) start = WORK_END
  if (end <= start) return { minutes: 0, night_minutes: 0 }
  const night = Math.max(0, Math.min(end, NIGHT_END) - Math.max(start, NIGHT_START))
  return { minutes: end - start, night_minutes: night }
}
