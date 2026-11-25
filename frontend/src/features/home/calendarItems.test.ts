import { describe, expect, it } from 'vitest'
import type { LeaveOnCalendar } from '@/features/attendance/types'
import type { Task } from '@/features/projects/types'
import { itemsByDay, onlyShown } from './calendarItems'

const ME = { id: 'u-9', name: '하지민' }

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
          user: ME,
        },
        {
          id: 'e-3',
          date: '2026-09-08',
          title: '보고서 마감',
          time: null,
          created_at: '',
          user: ME,
        },
        {
          id: 'e-2',
          date: '2026-09-08',
          title: '주간 회의',
          time: '10:00',
          created_at: '',
          user: ME,
        },
      ],
      () => '연차',
      { from: '2026-09-01', to: '2026-09-30' },
      [],
      ME.id,
    )
    expect(days.get('2026-09-08')?.map((i) => i.label)).toEqual([
      '보고서 마감',
      '10:00 주간 회의',
      '14:30 치과',
      '김다인 연차',
    ])
  })

  it('동료 일정이 많아도 내 부재가 동료 앞에 온다(종일 → 시각순)', () => {
    const colleague = (id: string, time: string | null) => ({
      id,
      date: '2026-09-08',
      title: '미팅',
      time,
      created_at: '',
      user: { id: 'u-6', name: '김다인' },
    })
    const days = itemsByDay(
      [
        leave({ user: ME, start_date: '2026-09-08', end_date: '2026-09-08' }),
        leave({ id: 'lv-2', start_date: '2026-09-08', end_date: '2026-09-08' }),
      ],
      [
        colleague('c-1', null),
        colleague('c-2', '09:00'),
        { id: 'e-1', date: '2026-09-08', title: '회의', time: '10:00', created_at: '', user: ME },
        colleague('c-3', '11:00'),
      ],
      () => '연차',
      { from: '2026-09-08', to: '2026-09-08' },
      [],
      ME.id,
    )
    expect(days.get('2026-09-08')?.map((i) => i.label)).toEqual([
      '하지민 연차',
      '10:00 회의',
      '김다인 미팅',
      '김다인 연차',
      '09:00 김다인 미팅',
      '11:00 김다인 미팅',
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
    expect(items.map((i) => i.group)).toEqual(['colleague', 'colleague', 'colleague'])
  })

  it('내 휴가·예외 근무는 개인 묶음으로, 내 일정 다음·동료 앞에 온다', () => {
    const days = itemsByDay(
      [
        leave({ start_date: '2026-09-08', end_date: '2026-09-08' }),
        leave({
          id: 'lv-2',
          user: { id: 'u-9', name: '하지민' },
          start_date: '2026-09-08',
          end_date: '2026-09-08',
        }),
      ],
      [
        { id: 'e-1', date: '2026-09-08', title: '치과', time: null, created_at: '', user: ME },
        {
          id: 'e-2',
          date: '2026-09-08',
          title: '고객사 미팅',
          time: null,
          created_at: '',
          user: { id: 'u-6', name: '김다인' },
        },
      ],
      () => '연차',
      { from: '2026-09-08', to: '2026-09-08' },
      [],
      'u-9',
    )
    const items = days.get('2026-09-08') ?? []
    // 동료 일정은 이름을 앞에 달고 동료 묶음으로 온다. 개인 묶음(내 일정·내 부재)이 먼저다.
    expect(items.map((i) => i.label)).toEqual([
      '치과',
      '하지민 연차',
      '김다인 고객사 미팅',
      '김다인 연차',
    ])
    expect(items.map((i) => i.group)).toEqual(['personal', 'personal', 'colleague', 'colleague'])
    // 좁은 칸의 짧은 이름: 일정은 제목, 내 부재는 종류, 동료 부재는 이름과 종류(내 이름은 군더더기).
    expect(items.map((i) => i.short)).toEqual(['치과', '연차', '김다인 고객사 미팅', '김다인 연차'])

    // 개인을 끄면 내 휴가도 같이 꺼진다.
    const shown = onlyShown(days, { personal: false, colleague: true })
    expect(shown.get('2026-09-08')?.map((i) => i.label)).toEqual([
      '김다인 고객사 미팅',
      '김다인 연차',
    ])
  })

  it('내가 맡은 안 끝난 업무만 마감일에 놓는다', () => {
    const task = (over: Partial<Task>): Task => ({
      id: 't-1',
      project_id: 'p-1',
      title: '견적서',
      stage: 'doing',
      assignee: ME,
      start_date: null,
      due_date: '2026-09-10',
      priority: 'normal',
      note: '',
      created_at: '',
      ...over,
    })
    const days = itemsByDay(
      [],
      [],
      () => '연차',
      { from: '2026-09-01', to: '2026-09-30' },
      [],
      ME.id,
      [
        task({}),
        task({ id: 't-2', stage: 'done' }),
        task({ id: 't-3', assignee: { id: 'u-6', name: '김다인' } }),
        task({ id: 't-4', due_date: null }),
        task({ id: 't-5', due_date: '2026-10-02' }),
      ],
    )
    expect([...days.keys()]).toEqual(['2026-09-10'])
    expect(days.get('2026-09-10')).toMatchObject([
      { kind: 'task', group: 'personal', label: '견적서 마감', short: '견적서', projectId: 'p-1' },
    ])
  })
})
