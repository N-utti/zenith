import { toISODate } from '@/lib/datetime'
import type { Schema } from '@/types'

/**
 * 일반 기안의 서식. 서버에는 전부 일반 기안(`general`)으로 저장되고, 서식은 제목 머리말과 적는 칸을 정한다.
 * 기안서는 칸 없이 본문을 자유롭게 쓴다. 나머지는 칸에 적은 값을 `subject.extra` 에 담고, 읽는 쪽이
 * 서식을 몰라도 되게 같은 내용을 글로 풀어 `subject.body` 에도 넣는다(`composeBody`).
 *
 * ponytail: 회사 양식 파일을 아직 못 받아(이슈 #158 A5) 흔한 항목으로 만든 칸이다. 양식이 오면 이 표만
 * 바꾼다. 필수 칸과 금액 필수는 화면이 상신을 잠그는 편의일 뿐 서버는 서식을 모른다. 서식마다
 * 결재선이나 서버 검증이 갈려야 하면 그때 서버 양식(13 §1.3 고정 양식)으로 옮긴다.
 */
export type ApprovalTemplate =
  'general' | 'expense' | 'proposal' | 'purchase' | 'trip' | 'certificate'

interface TemplateField {
  key: string
  label: string
  kind: 'text' | 'date' | 'textarea' | 'select'
  required?: boolean
  /** `select` 의 보기. 값과 보이는 글이 같다. */
  options?: string[]
  /** 두 칸씩 놓는 줄에서 한 줄을 다 쓴다. 여러 줄 칸은 원래 다 쓴다. */
  wide?: boolean
}

interface Template {
  label: string
  prefix: string
  /** 금액 없이는 상신할 수 없는 서식. */
  amountRequired?: boolean
  /** 돈이 나가지 않는 서식. 금액 칸을 안 그리고 금액을 비워 보낸다. */
  noAmount?: boolean
  /** 칸 값으로 제목이 정해지는 서식. 제목 칸을 안 그리고 머리말 뒤에 이 값을 붙인다(`titleOf`). */
  autoTitle?: (values: TemplateValues) => string
  fields: TemplateField[]
}

const PAYMENT: TemplateField = {
  key: 'method',
  label: '결제 방법',
  kind: 'select',
  required: true,
  options: ['법인카드', '개인 선지출'],
}

export const APPROVAL_TEMPLATES: Record<ApprovalTemplate, Template> = {
  general: { label: '기안서', prefix: '', fields: [] },
  expense: {
    label: '지출결의서',
    prefix: '[지출결의] ',
    amountRequired: true,
    fields: [
      // 목적은 제목이, 지출처는 지출 내역과 영수증이 말한다.
      { key: 'date', label: '지출 일자', kind: 'date', required: true },
      PAYMENT,
      { key: 'items', label: '지출 내역', kind: 'textarea', required: true },
    ],
  },
  // 출장 신청에서 열면 출장 기간·목적을 미리 채우고 그 출장에 건다(`ApprovalNewPage`). 서식 목록에서
  // 고르면 직접 적고, 출장 신청과는 이어지지 않는다.
  trip: {
    label: '출장비 결의서',
    prefix: '[출장비] ',
    amountRequired: true,
    fields: [
      { key: 'period', label: '출장 기간', kind: 'text', required: true },
      { key: 'purpose', label: '출장 목적', kind: 'text', required: true },
      PAYMENT,
      { key: 'items', label: '지출 내역', kind: 'textarea', required: true },
    ],
  },
  proposal: {
    label: '품의서',
    prefix: '[품의] ',
    fields: [
      { key: 'reason', label: '품의 사유', kind: 'textarea', required: true },
      { key: 'content', label: '품의 내용', kind: 'textarea', required: true },
    ],
  },
  purchase: {
    label: '구매요청서',
    prefix: '[구매요청] ',
    amountRequired: true,
    fields: [
      { key: 'item', label: '구매 품목', kind: 'text', required: true },
      { key: 'quantity', label: '수량·단가', kind: 'text' },
      { key: 'vendor', label: '구매처', kind: 'text' },
      { key: 'needed', label: '필요 일자', kind: 'date' },
      { key: 'reason', label: '구매 사유', kind: 'textarea', required: true },
    ],
  },
  // ponytail: 신청만 받는다. 승인되면 담당자가 회사 양식으로 발급한다. 화면에서 증명서 PDF 를 만들면
  // 누구나 고쳐 뽑을 수 있어서, 발급번호·직인이 붙는 발급은 서버가 만들어야 한다.
  certificate: {
    label: '증명서 신청',
    prefix: '[증명서] ',
    noAmount: true,
    autoTitle: (values) => [values.kind, values.copies].filter(Boolean).join(' '),
    fields: [
      {
        key: 'kind',
        label: '증명서 종류',
        kind: 'select',
        required: true,
        options: ['재직증명서', '경력증명서'],
      },
      {
        key: 'copies',
        label: '부수',
        kind: 'select',
        required: true,
        options: ['1부', '2부', '3부'],
      },
      { key: 'purpose', label: '용도', kind: 'text', required: true, wide: true },
      { key: 'note', label: '요청 사항', kind: 'textarea' },
    ],
  },
}

/** 칸 `key` → 적은 값. */
export type TemplateValues = Record<string, string>

/** 저장돼 있던 서식 이름을 지금 아는 서식으로. 없거나 모르는 이름이면 본문만 쓰는 기안서다. */
export const templateOf = (form: string | undefined): ApprovalTemplate =>
  form !== undefined && Object.hasOwn(APPROVAL_TEMPLATES, form)
    ? (form as ApprovalTemplate)
    : 'general'

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

/** 저장할 제목. 칸 값으로 정해지는 서식이면 적어 둔 제목 대신 그 값을 쓴다. */
export function titleOf(template: ApprovalTemplate, typed: string, values: TemplateValues) {
  const { prefix, autoTitle } = APPROVAL_TEMPLATES[template]
  return autoTitle ? prefix + autoTitle(values) : typed
}

/** 폼에 지금 적혀 있는 것. */
interface Entered {
  title: string
  body: string
  values: TemplateValues
}

/**
 * 서식을 `to` 로 바꿀 때의 제목.
 *
 * 제목은 머리말만 바뀌고 뒤에 쓴 말은 남는다. 본문과 칸은 서식마다 달라서 옮기지 못하고 비운다.
 * 뭔가 써 둔 게 있으면 `overwrites` 로 알려서 화면이 지우기 전에 묻게 한다.
 */
export function switchTemplate(
  to: ApprovalTemplate,
  current: Entered,
): { title: string; overwrites: boolean } {
  return {
    title: (APPROVAL_TEMPLATES[to].prefix + stripPrefix(current.title)).slice(0, TITLE_MAX),
    overwrites:
      current.body.trim() !== '' ||
      Object.values(current.values).some((each) => each.trim() !== ''),
  }
}

/**
 * 머리말만 있는 제목은 안 쓴 칸이다. 내용(`body`)은 기안서면 본문, 칸이 있는 서식이면 필수 칸이
 * 다 찼는지를 본다. 이걸 봐야 빈 서식 그대로 상신되지 않는다.
 */
export function filledFields(
  template: ApprovalTemplate,
  current: Entered,
): { title: boolean; body: boolean } {
  const { fields } = APPROVAL_TEMPLATES[template]
  return {
    title: stripPrefix(current.title.trim()).length > 0,
    body:
      fields.length === 0
        ? current.body.trim() !== ''
        : fields.every((each) => !each.required || (current.values[each.key] ?? '').trim() !== ''),
  }
}

/**
 * 칸에 적은 값을 본문 글로 푼다. 빈 칸은 뺀다. 여러 줄 칸은 라벨 아래로 내린다.
 *
 * 문서 상세·결재함·서버는 서식을 모르고 `body` 만 읽는다. 그래서 칸의 값을 여기에도 넣는다.
 */
export function composeBody(template: ApprovalTemplate, values: TemplateValues): string {
  const written = APPROVAL_TEMPLATES[template].fields
    .map((each) => ({ ...each, value: (values[each.key] ?? '').trim() }))
    .filter((each) => each.value !== '')
  return written
    .map((each, index) => {
      const block = each.kind === 'textarea'
      // 여러 줄 칸은 앞뒤를 한 줄 띄운다. 적은 글 속의 빈 줄은 건드리지 않는다.
      const gap = index === 0 ? '' : block || written[index - 1].kind === 'textarea' ? '\n\n' : '\n'
      return gap + (block ? `${each.label}:\n${each.value}` : `${each.label}: ${each.value}`)
    })
    .join('')
}

/**
 * AI 초안 요청(`POST /ai/approval-draft`)에 싣는 서식 표. 서버는 서식을 몰라서 칸 정의를 같이 보낸다.
 * `amount` 는 금액을 꼭 받는지(`required`), 받지 않는지(`none`), `title` 은 제목 칸이 있는지.
 */
export function draftForms() {
  return Object.entries(APPROVAL_TEMPLATES).map(([form, each]) => ({
    form,
    label: each.label,
    amount: each.noAmount ? 'none' : each.amountRequired ? 'required' : 'optional',
    title: !each.autoTitle,
    fields: each.fields.map(({ key, label, kind, required, options }) => ({
      key,
      label,
      kind,
      required: !!required,
      ...(options && { options }),
    })),
  }))
}

/** AI 초안 응답(백엔드 #553). 결재 문서가 아니라 폼에 채울 값이다. */
export type AiDraft = Schema<'DraftOut'>

/**
 * AI 초안을 폼 값으로. 모델이 만든 값이라 모양부터 믿지 않는다(`unknown`): 글자가 아닌 값은 빈 값,
 * 모르는 서식은 기안서, 서식에 없는 칸, 보기에 없는 선택값, 달력에 없는 날짜는 버린다. 금액 없는
 * 서식이나 원 단위 정수가 아닌 금액도 버린다. 제목 머리말은 서버가 붙였든 안 붙였든 그 서식의 것 하나로 맞춘다.
 */
export function fromAiDraft(reply: unknown) {
  const draft = (reply && typeof reply === 'object' ? reply : {}) as Record<keyof AiDraft, unknown>
  const given = (draft.fields && typeof draft.fields === 'object' ? draft.fields : {}) as Record<
    string,
    unknown
  >
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const template = templateOf(text(draft.form))
  const { prefix, noAmount, fields } = APPROVAL_TEMPLATES[template]
  const values: TemplateValues = {}
  for (const field of fields) {
    const value = text(given[field.key])
    const ok =
      field.kind === 'select'
        ? field.options?.includes(value)
        : field.kind === 'date'
          ? // `2026-02-30` 은 꼴만 맞다. 날짜 칸은 그런 값을 빈칸으로 그려 안 보이는 채로 상신된다.
            /^\d{4}-\d{2}-\d{2}$/.test(value) && toISODate(new Date(`${value}T00:00`)) === value
          : value !== ''
    if (ok) values[field.key] = value
  }
  const { amount } = draft
  return {
    template,
    title: (prefix + stripPrefix(text(draft.title))).slice(0, TITLE_MAX),
    amount: !noAmount && Number.isInteger(amount) && (amount as number) >= 0 ? String(amount) : '',
    body: fields.length === 0 ? text(draft.body) : '',
    values,
  }
}

/**
 * 저장 요청의 `subject` 에 넣을 본문과 칸 값.
 *
 * 기안서처럼 칸이 없는 서식은 `extra` 를 안 보낸다(이전 요청과 글자 그대로 같다). 칸이 있는 서식은
 * 지금 서식에 있는 칸만 담는다. 칸 표가 바뀌기 전에 저장된 옛 칸이 계속 따라다니지 않는다.
 */
export function templateContent(
  template: ApprovalTemplate,
  current: Pick<Entered, 'body' | 'values'>,
): { body: string; extra?: { form: ApprovalTemplate; fields: TemplateValues } } {
  const { fields } = APPROVAL_TEMPLATES[template]
  if (fields.length === 0) return { body: current.body }
  return {
    body: composeBody(template, current.values),
    extra: {
      form: template,
      fields: Object.fromEntries(fields.map((each) => [each.key, current.values[each.key] ?? ''])),
    },
  }
}
