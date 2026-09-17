/** 09:12 (24시간제). 기록 시각은 오전/오후 표기보다 24시간제가 오독이 적다. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "오늘" · "어제" · "8월 25일 (화)" */
export function formatDay(iso: string): string {
  const date = new Date(iso)
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return '오늘'
  if (diffDays === 1) return '어제'
  return date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

/** "2026년 9월 8일 (화) 13:42". 상대 시각("1시간 전")의 툴팁처럼 정확한 시점이 필요한 자리. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
  return `${day} ${formatTime(iso)}`
}

/**
 * "방금" · "12분 전" · "3시간 전" · "어제" · "8/25"
 * 목록 안에서 쓰이므로 하루가 넘어가면 한 줄에 들어가는 짧은 날짜로 접는다.
 */
export function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (diffMinutes < 1) return '방금'
  if (diffMinutes < 60) return `${diffMinutes}분 전`
  if (diffMinutes < 60 * 24) return `${Math.floor(diffMinutes / 60)}시간 전`

  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (diffDays === 1) return '어제'
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// ── 달력 ────────────────────────────────────────────────────────
// 근태 캘린더가 쓴다. 날짜 라이브러리를 들이지 않은 이유는, 필요한 계산이
// "그 달의 주 배열"뿐이고 한국 공휴일은 어떤 라이브러리도 주지 않기 때문이다.

/** `2026-08-31`. 서버와 주고받는 날짜 형식(`att_days.work_date`는 KST 기준 date). */
export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** `2026-09-08` → "9월 8일 (화)". `new Date(iso)` 는 UTC 로 읽혀 KST 서쪽에서 하루 밀리므로 숫자로 만든다. */
export function formatISODate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
}

/**
 * `1998-03-02` → "1998. 3. 2.". 입사일처럼 **연도가 중요한** 날짜에 쓴다.
 * `formatISODate` 는 올해 안의 일정용이라 연도를 뺀다.
 */
export function formatISOYearDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('ko-KR')
}

/**
 * `2026-08` → 그 달을 덮는 주 배열. 앞뒤 주는 이웃 달 날짜로 채운다.
 *
 * `new Date('2026-08-01')`은 UTC로 해석돼 KST에서 하루 밀린다. 숫자로 넘겨
 * 로컬 자정을 만든다.
 */
export function monthMatrix(month: string, weekStartsOn: 0 | 1 = 1): Date[][] {
  const [year, monthIndex] = month.split('-').map(Number)
  const m = monthIndex - 1

  const first = new Date(year, m, 1)
  const last = new Date(year, m + 1, 0) // 다음 달 0일 = 이 달 말일

  // 1일이 속한 주의 시작 ~ 말일이 속한 주의 끝. 6주로 고정하지 않는다.
  // 고정하면 어떤 달은 다음 달 날짜만 담긴 줄이 하나 더 생긴다.
  const cursor = new Date(year, m, 1 - ((first.getDay() - weekStartsOn + 7) % 7))
  const end = new Date(year, m, last.getDate() + ((weekStartsOn + 6 - last.getDay() + 7) % 7))

  const weeks: Date[][] = []
  while (cursor.getTime() <= end.getTime()) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/** `2026-08` → `2026년 8월` */
export function formatMonth(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  return `${year}년 ${monthIndex}월`
}

/** `2026-08` 에서 n개월 이동. 12월 넘김은 Date가 알아서 한다. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number)
  const date = new Date(year, monthIndex - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 오늘이 속한 달 (`2026-08`). */
export function currentMonth(): string {
  return toISODate(new Date()).slice(0, 7)
}
