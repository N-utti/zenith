import { describe, expect, it } from 'vitest'
import { buildTimeline } from './timeline'
import type { Task } from './types'

const task = (
  id: string,
  start: string | null,
  due: string | null,
  created = '2026-10-01',
): Task => ({
  id,
  project_id: 'pj',
  title: id,
  stage: 'todo',
  assignee: null,
  start_date: start,
  due_date: due,
  priority: 'normal',
  note: '',
  created_at: `${created}T00:00:00Z`,
})

describe('buildTimeline', () => {
  it('막대는 시작일부터 마감일까지, 한쪽만 있으면 하루, 둘 다 없으면 막대 없이 맨 아래', () => {
    const t = buildTimeline(
      [
        task('none', null, null),
        task('due-only', null, '2026-10-30'),
        task('span', '2026-10-20', '2026-10-24'),
      ],
      '2026-10-26',
    )
    expect(t.rows.map((r) => r.task.id)).toEqual(['span', 'due-only', 'none'])
    const [span, dueOnly, none] = t.rows
    // 표는 가장 이른 시작일 사흘 전부터.
    expect(span).toMatchObject({ from: 3, to: 7 })
    expect(dueOnly.to! - dueOnly.from!).toBe(0)
    expect(none).toMatchObject({ from: null, to: null })
    expect(t.today).toBe(9)
  })

  it('업무가 없거나 몰려 있어도 오늘을 덮고 4주는 보인다', () => {
    const t = buildTimeline([], '2026-10-26')
    expect(t.today).toBe(3)
    expect(t.length).toBe(28)
    expect(buildTimeline([task('near', '2026-10-27', '2026-10-28')], '2026-10-26').length).toBe(28)
  })

  it('날짜 없는 업무끼리는 등록한 순서', () => {
    const t = buildTimeline(
      [task('late', null, null, '2026-10-05'), task('early', null, null, '2026-10-02')],
      '2026-10-26',
    )
    expect(t.rows.map((r) => r.task.id)).toEqual(['early', 'late'])
  })

  it('해를 넘는 막대도 날 수로 센다', () => {
    const t = buildTimeline([task('ny', '2026-12-30', '2027-01-02')], '2026-12-30')
    expect(t.rows[0]).toMatchObject({ from: 3, to: 6 })
  })

  it('먼 마감까지 덮고 뒤로 사흘 남긴다', () => {
    const t = buildTimeline([task('far', '2026-10-26', '2026-12-31')], '2026-10-26')
    expect(t.rows[0].to).toBe(t.length - 1 - 3)
  })
})
