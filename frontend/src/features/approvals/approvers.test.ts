import { describe, expect, it } from 'vitest'
import { readLastApprovers, rememberApprovers, splitSavedApprovers } from './approvers'
import type { ApprovalStep } from './types'

const step = (
  step_no: number,
  id: string,
  role: ApprovalStep['role'] = 'approve',
): ApprovalStep => ({
  step_no,
  approver: { id, name: id },
  acted_by: null,
  role,
  status: 'skipped',
  comment: null,
  acted_at: null,
  version: 1,
})

const steps = [step(2, 'b'), step(1, 'a'), step(3, 'r', 'reference')]

describe('지난번 상신한 결재선 기억', () => {
  it('사람마다, 서식마다 따로 남고 같은 서식은 마지막 것이 이긴다', () => {
    rememberApprovers('me', 'expense', ['a', 'b'])
    rememberApprovers('me', 'general', ['c'])
    rememberApprovers('me', 'expense', ['b'])
    rememberApprovers('other', 'expense', [])

    expect(readLastApprovers('me')).toEqual({ expense: ['b'], general: ['c'] })
    expect(readLastApprovers('other')).toEqual({ expense: [] })
    expect(readLastApprovers('nobody')).toEqual({})
  })

  it('깨진 값은 기억이 없는 것으로 치고, 모양이 틀린 서식만 버린다', () => {
    localStorage.setItem('zenith.approvalLine.broken', '{')
    expect(readLastApprovers('broken')).toEqual({})

    localStorage.setItem(
      'zenith.approvalLine.mixed',
      JSON.stringify({ expense: ['a'], general: 'a', trip: [1] }),
    )
    expect(readLastApprovers('mixed')).toEqual({ expense: ['a'] })
  })
})

describe('임시저장의 고른 결재선 가르기', () => {
  it('사람 목록이 없거나 실패면 거르지 않는다. 다 걸러지면 결재선이 지워진다', () => {
    expect(splitSavedApprovers(steps, null)).toEqual({ kept: ['a', 'b'], dropped: [] })
  })

  it('고를 수 없게 된 사람은 빼고 누구를 뺐는지 돌려준다. 순서는 단계 번호', () => {
    expect(splitSavedApprovers(steps, ['b', 'r'])).toEqual({
      kept: ['b'],
      dropped: [{ id: 'a', name: 'a' }],
    })
  })
})
