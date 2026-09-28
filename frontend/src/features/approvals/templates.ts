/**
 * 일반 기안의 서식. 서버에는 전부 일반 기안(`general`)으로 저장되고, 서식은 제목 머리말과 본문 틀만 채운다.
 *
 * ponytail: 회사 양식 파일을 아직 못 받아(이슈 #158 A5) 흔한 항목으로 만든 틀이다. 양식이 오면 여기
 * 문구만 바꾼다. 서식마다 입력 칸이 따로 필요해지면 그때 서버 양식(13 §1.3 고정 양식)으로 옮긴다.
 */
export const APPROVAL_TEMPLATES = {
  general: { label: '기안서', prefix: '', body: '' },
  expense: {
    label: '지출결의서',
    prefix: '[지출결의] ',
    body: '지출 목적:\n지출 일자:\n지출처:\n결제 방법: 법인카드 / 개인 선지출\n\n지출 내역:\n- ',
  },
  proposal: {
    label: '품의서',
    prefix: '[품의] ',
    body: '품의 사유:\n\n품의 내용:\n\n기대 효과:\n',
  },
  purchase: {
    label: '구매요청서',
    prefix: '[구매요청] ',
    body: '구매 품목:\n수량·단가:\n구매처:\n필요 일자:\n\n구매 사유:\n',
  },
} as const

export type ApprovalTemplate = keyof typeof APPROVAL_TEMPLATES

/** 제목 칸 `maxLength` 와 같다. 머리말을 코드가 붙이면 입력 칸의 제한이 안 걸린다. */
const TITLE_MAX = 200

const PREFIXES = Object.values(APPROVAL_TEMPLATES)
  .map((each) => each.prefix.trim())
  .filter(Boolean)

/** 앞에 붙은 서식 머리말을 뗀다. 머리말 뒤 공백을 지웠어도 뗀다. */
const stripPrefix = (title: string) => {
  const prefix = PREFIXES.find((each) => title.startsWith(each))
  return prefix ? title.slice(prefix.length).trimStart() : title
}

/**
 * 서식을 `from` 에서 `to` 로 바꿀 때의 제목·본문.
 *
 * 제목은 머리말만 바뀌고 뒤에 쓴 말은 남는다. 본문은 새 틀로 바뀌는데, 고쳐 썼으면(비었거나 이전 틀
 * 그대로가 아니면) `overwrites` 로 알려서 화면이 덮기 전에 묻게 한다.
 */
export function switchTemplate(
  from: ApprovalTemplate,
  to: ApprovalTemplate,
  current: { title: string; body: string },
): { title: string; body: string; overwrites: boolean } {
  return {
    title: (APPROVAL_TEMPLATES[to].prefix + stripPrefix(current.title)).slice(0, TITLE_MAX),
    body: APPROVAL_TEMPLATES[to].body,
    overwrites: current.body.trim() !== '' && current.body !== APPROVAL_TEMPLATES[from].body,
  }
}

/**
 * 머리말만 있는 제목, 틀 그대로인 본문은 안 쓴 칸이다. 이걸 빈 칸으로 쳐야 빈 틀 그대로 상신되지 않는다.
 */
export function filledFields(
  template: ApprovalTemplate,
  current: { title: string; body: string },
): { title: boolean; body: boolean } {
  return {
    title: stripPrefix(current.title.trim()).length > 0,
    body: current.body.trim() !== '' && current.body !== APPROVAL_TEMPLATES[template].body,
  }
}
