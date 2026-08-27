/** 09:12 (24시간제). 근태 기록은 오전/오후 표기보다 24시간제가 오독이 적다. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 490 → "8시간 10분", 45 → "45분" */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
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
