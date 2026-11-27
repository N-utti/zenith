import type { ApprovalStep } from './types'

/** 서버 `DraftIn.approvers` 의 `maxItems`. */
export const MAX_APPROVERS = 10

const keyOf = (userId: string) => `zenith.approvalLine.${userId}`

/**
 * 서식 → 지난번 그 서식으로 상신할 때 고른 결재선. 새 기안이 이 사람들을 고른 채로 시작한다.
 *
 * ponytail: 이 브라우저에만 둔다(다른 기기에서는 서식마다 처음 한 번은 직접 고른다). 같은 브라우저를
 * 다른 사람이 쓸 수 있어 키에 사용자 id 를 넣는다. 서식별 결재자를 회사가 정하면(이슈 #158) 서버가
 * 기본 결재선을 내려 주는 쪽으로 옮긴다.
 */
export function readLastApprovers(userId: string): Record<string, string[]> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(keyOf(userId)) ?? 'null')
    if (saved && typeof saved === 'object') {
      return Object.fromEntries(
        Object.entries(saved).filter(
          ([, ids]) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
        ),
      )
    }
  } catch {
    // 깨진 값이나 막힌 저장소는 기억이 없는 것으로 친다.
  }
  return {}
}

/** 상신한 결재선을 그 서식의 지난 결재선으로 남긴다. 빈 결재선도 남긴다(고르지 않고 올린 것도 선택이다). */
export function rememberApprovers(userId: string, template: string, ids: string[]) {
  try {
    localStorage.setItem(
      keyOf(userId),
      JSON.stringify({ ...readLastApprovers(userId), [template]: ids }),
    )
  } catch {
    // 저장 못 해도 상신은 끝났다. 다음 기안이 빈 결재선으로 시작할 뿐이다.
  }
}

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
