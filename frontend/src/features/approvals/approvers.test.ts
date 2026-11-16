import { describe, expect, it } from 'vitest'
import { splitSavedApprovers } from './approvers'
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
