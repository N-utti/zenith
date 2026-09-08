import { describe, expect, it } from 'vitest'
import type { LeaveOnCalendar } from '@/features/attendance/types'
import { itemsByDay } from './calendarItems'

const leave = (over: Partial<LeaveOnCalendar>): LeaveOnCalendar => ({
  id: 'lv-1',
  user: { id: 'u-6', name: '김다인' },
  type_code: 'annual',
  start_date: '2026-09-07',
  end_date: '2026-09-09',
  ...over,
})

describe('홈 캘린더 날짜별 항목', () => {
  it('휴가 기간을 하루씩 펼치되 화면 범위 밖은 걷는다', () => {
    const days = itemsByDay([leave({})], [], () => '연차', {
      from: '2026-09-08',
      to: '2026-09-30',
    })
    expect([...days.keys()]).toEqual(['2026-09-08', '2026-09-09'])
    expect(days.get('2026-09-08')?.map((i) => i.label)).toEqual(['김다인 연차'])
  })

  it('내 일정이 앞에(종일 → 시각순), 휴가가 뒤에 온다', () => {
    const days = itemsByDay(
      [leave({ start_date: '2026-09-08', end_date: '2026-09-08' })],
      [
        {
          id: 'e-1',
          date: '2026-09-08',
          title: '치과',
          time: '14:30',
          created_at: '',
        },
        {
          id: 'e-3',
          date: '2026-09-08',
          title: '보고서 마감',
          time: null,
          created_at: '',
        },
        {
          id: 'e-2',
          date: '2026-09-08',
          title: '주간 회의',
          time: '10:00',
          created_at: '',
        },
      ],
      () => '연차',
      { from: '2026-09-01', to: '2026-09-30' },
    )
    expect(days.get('2026-09-08')?.map((i) => i.label)).toEqual([
      '보고서 마감',
      '10:00 주간 회의',
      '14:30 치과',
      '김다인 연차',
    ])
  })
})

describe('홈 캘린더 부재 묶음', () => {
  it('휴가와 예외 근무가 한 범주로, 이름순으로 섞인다', () => {
    const days = itemsByDay(
      [
        leave({
          user: { id: 'u-6', name: '김다인' },
          start_date: '2026-09-08',
          end_date: '2026-09-08',
        }),
      ],
      [],
      () => '연차',
      { from: '2026-09-08', to: '2026-09-08' },
      [
        {
          id: 'ar-1',
          user: { id: 'u-3', name: '홍성완' },
          kind: 'trip',
          start_date: '2026-09-08',
          end_date: '2026-09-08',
        },
        {
          id: 'ar-2',
          user: { id: 'u-1', name: '강민지' },
          kind: 'remote',
          start_date: '2026-09-08',
          end_date: '2026-09-08',
        },
      ],
    )
    const items = days.get('2026-09-08') ?? []
    expect(items.map((i) => i.kind)).toEqual(['absence', 'absence', 'absence'])
    expect(items.map((i) => i.label)).toEqual(['강민지 재택', '김다인 연차', '홍성완 출장'])
  })
})
