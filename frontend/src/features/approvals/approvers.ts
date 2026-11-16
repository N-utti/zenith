import type { ApprovalStep } from './types'

/** 서버 `DraftIn.approvers` 의 `maxItems`. */
export const MAX_APPROVERS = 10

/**
 * 임시저장에 고른 결재자를 지금 고를 수 있는 사람(`pickable`)과 그렇지 않은 사람으로 가른다. 단계 번호가 결재 순서다.
 *
 * 빠진 사람(비활성)은 칩이 없어 화면에서 뺄 길이 없고, 서버는 422 로 저장을 막는다. 그래서 빼되 누구를 뺐는지
 * 돌려줘 화면이 알린다. 조용히 빼면 다 빠진 결재선이 `[]` 로 저장돼 상신 때 자동 결재선으로 올라간다.
 * 사람 목록이 아직 없거나 못 불러왔으면(`pickableIds` 가 `null`) 거르지 않는다. 같은 이유로 결재선이 지워진다.
 */
export function splitSavedApprovers(
  steps: ApprovalStep[],
  pickableIds: string[] | null,
): { kept: string[]; dropped: ApprovalStep['approver'][] } {
  const saved = steps
    .filter((step) => step.role === 'approve')
    .sort((a, b) => a.step_no - b.step_no)
    .map((step) => step.approver)
  if (!pickableIds) return { kept: saved.map((p) => p.id), dropped: [] }
  return {
    kept: saved.filter((p) => pickableIds.includes(p.id)).map((p) => p.id),
    dropped: saved.filter((p) => !pickableIds.includes(p.id)),
  }
}
