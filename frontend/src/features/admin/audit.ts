import { formatBytes } from '@/lib/format'
import { ROLE_LABEL, type Role, type Schema } from '@/types'

/** `GET /admin/audit` 한 줄 (04 §9 `AuditOut`). 쓰기만 있고 고치거나 지우는 길은 없다. */
export type AuditEvent = Schema<'AuditOut'>

export type AuditPage = Schema<'AuditPage'>

/**
 * 종류 거르개. 서버가 **앞글자 일치**로 거르므로(`kind.startswith`) 앞머리만 보내면 된다.
 * `auth` 하나로 로그인·로그아웃·비밀번호 변경이 다 걸린다.
 */
export const AUDIT_FILTERS = [
  { value: '', label: '전체' },
  { value: 'auth', label: '로그인·세션' },
  { value: 'acl', label: '권한 거부' },
  { value: 'admin', label: '계정·팀 관리' },
  { value: 'boards', label: '게시판' },
  { value: 'docs', label: '문서' },
  { value: 'files', label: '첨부 파일' },
  { value: 'crm', label: 'CRM' },
]

const CRM_EXPORT_LABEL: Record<string, string> = {
  orgs: '기관',
  contacts: '담당자',
  deals: '안건',
}

export type AuditTone = 'neutral' | 'warning' | 'danger'

export interface AuditView {
  /** 한 줄 요약. 무슨 일이 있었는지. */
  summary: string
  /** 그 아래 붙는 부연. 없으면 그리지 않는다. */
  detail?: string
  tone: AuditTone
}

const text = (detail: Record<string, unknown> | null, key: string): string | undefined => {
  const value = detail?.[key]
  return typeof value === 'string' && value ? value : undefined
}

const roleLabel = (value: unknown): string | undefined =>
  typeof value === 'string' && value in ROLE_LABEL ? ROLE_LABEL[value as Role] : undefined

/**
 * 계정 수정의 앞뒤 상태. 등급과 활성 여부만 남는다(서버 `admin.user_updated`).
 *
 * `covered` 는 여기서 값까지 보여 준 칸이다. 칸 이름 목록에서는 빼야 "등급 · 등급 사원 → 팀장"
 * 처럼 두 번 말하지 않는다.
 */
function changedState(detail: Record<string, unknown> | null): {
  text?: string
  covered: string[]
} {
  const before = detail?.before as { role?: unknown; active?: unknown } | undefined
  const after = detail?.after as { role?: unknown; active?: unknown } | undefined
  if (!before || !after) return { covered: [] }

  const parts: string[] = []
  const covered: string[] = []
  if (before.role !== after.role) {
    parts.push(
      `등급 ${roleLabel(before.role) ?? '알 수 없음'} → ${roleLabel(after.role) ?? '알 수 없음'}`,
    )
    covered.push('role')
  }
  if (before.active !== after.active) {
    parts.push(after.active ? '다시 활성화' : '비활성화')
    covered.push('active')
  }
  return { text: parts.length > 0 ? parts.join(', ') : undefined, covered }
}

/**
 * `fields` 는 서버가 **본문에 온** 칸 이름 배열이다(`exclude_unset`). 값이 그대로여도 보냈으면
 * 들어간다. 그대로 보여 주면 영문 필드명이 나가므로 우리말로 바꾼다.
 */
const FIELD_LABEL: Record<string, string> = {
  name: '이름',
  role: '등급',
  active: '활성 상태',
  team_id: '팀',
  hire_date: '입사일',
  password: '임시 비밀번호',
}

function changedFields(
  detail: Record<string, unknown> | null,
  covered: string[],
): string | undefined {
  const fields = detail?.fields
  if (!Array.isArray(fields)) return undefined
  const rest = fields.map(String).filter((field) => !covered.includes(field))
  return rest.length > 0 ? rest.map((field) => FIELD_LABEL[field] ?? field).join(', ') : undefined
}

/**
 * 감사 기록 한 줄을 읽을 수 있는 말로 바꾼다.
 *
 * **종류를 모르면 종류 이름을 그대로 보여 준다.** 백엔드가 새 종류를 넣었을 때 화면에서 줄이
 * 사라지거나 빈칸이 되면, 감사 기록을 보는 이유(무슨 일이 있었는지 다 남기는 것) 자체가 깨진다.
 */
export function auditView(event: AuditEvent): AuditView {
  const { kind, detail } = event

  switch (kind) {
    case 'auth.login_ok':
      return { summary: '로그인', tone: 'neutral' }

    case 'auth.login_fail': {
      const reason = text(detail, 'reason') === 'disabled' ? '비활성 계정' : '비밀번호 불일치'
      return {
        summary: '로그인 실패',
        detail: [text(detail, 'email'), reason].filter(Boolean).join(' · ') || undefined,
        tone: 'warning',
      }
    }

    case 'auth.logout':
      return { summary: '로그아웃', tone: 'neutral' }

    case 'auth.password_changed':
      return { summary: '비밀번호 변경', tone: 'neutral' }

    case 'auth.refresh_reuse':
      return {
        summary: '이미 쓴 세션 토큰이 다시 왔습니다',
        detail: '탈취로 보고 그 세션을 닫았습니다.',
        tone: 'danger',
      }

    case 'acl.denied': {
      // 소켓 거부도 `path` 를 담는다(`/api/ws`). 갈래로 두면 정작 쓸모 있는 `op` 가 버려진다.
      const where = [text(detail, 'path'), text(detail, 'op')].filter(Boolean).join(' ')
      const need = roleLabel(detail?.min_role)
      const had = roleLabel(detail?.role)
      const gap = need && had ? `${need} 이상 필요, 현재 ${had}` : need && `${need} 이상 필요`
      return {
        summary: '권한 밖 접근을 막았습니다',
        detail: [where, gap || undefined].filter(Boolean).join(' · ') || undefined,
        tone: 'warning',
      }
    }

    case 'admin.user_created':
      return {
        summary: '계정 생성',
        detail:
          [text(detail, 'email'), roleLabel(detail?.role)].filter(Boolean).join(' · ') || undefined,
        tone: 'neutral',
      }

    case 'admin.user_updated': {
      const state = changedState(detail)
      return {
        summary: '계정 수정',
        detail:
          [changedFields(detail, state.covered), state.text].filter(Boolean).join(' · ') ||
          undefined,
        tone: 'neutral',
      }
    }

    case 'admin.team_created':
      return { summary: '팀 생성', detail: text(detail, 'name'), tone: 'neutral' }

    case 'admin.team_updated': {
      const before = text(detail, 'before')
      const after = text(detail, 'after')
      return {
        summary: '팀 이름 변경',
        detail: before && after ? `${before} → ${after}` : after || before,
        tone: 'neutral',
      }
    }

    case 'boards.post_deleted':
      return { summary: '게시글 삭제', detail: text(detail, 'title'), tone: 'warning' }

    case 'docs.hard_deleted':
      return { summary: '문서 완전 삭제', detail: text(detail, 'title'), tone: 'warning' }

    case 'docs.purged':
      return {
        summary: '휴지통 보관 기간이 지나 지웠습니다',
        detail: text(detail, 'title'),
        tone: 'neutral',
      }

    case 'files.uploaded': {
      const size = typeof detail?.size === 'number' ? formatBytes(detail.size) : undefined
      return {
        summary: '파일 올림',
        detail: [text(detail, 'type'), size].filter(Boolean).join(' · ') || undefined,
        tone: 'neutral',
      }
    }

    case 'files.rejected':
      return {
        summary: '파일 거부',
        detail:
          [text(detail, 'name'), text(detail, 'claimed')].filter(Boolean).join(' · ') || undefined,
        tone: 'warning',
      }

    case 'crm.exported': {
      const what = CRM_EXPORT_LABEL[text(detail, 'entity') ?? '']
      const rows = typeof detail?.rows === 'number' ? `${detail.rows}행` : undefined
      return {
        summary: 'CRM 엑셀 내보내기',
        detail: [what, rows].filter(Boolean).join(' · ') || undefined,
        tone: 'neutral',
      }
    }

    default:
      return { summary: kind, tone: 'neutral' }
  }
}
