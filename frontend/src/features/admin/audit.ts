import { APPROVAL_TYPE_LABEL, type ApprovalTypeCode } from '@/features/approvals/types'
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
  { value: 'admin', label: '계정·팀·휴일 관리' },
  { value: 'approvals', label: '전자결재' },
  { value: 'attendance', label: '근태 마감' },
  { value: 'boards', label: '게시판' },
  // 채널 관리(`channels.*`)와 메시지 수정·삭제(`chat.*`)가 앞글자 `ch` 로 같이 걸린다.
  { value: 'ch', label: '채팅' },
  { value: 'docs', label: '문서' },
  { value: 'files', label: '첨부 파일' },
  { value: 'crm', label: 'CRM' },
  { value: 'projects', label: '협업 공간' },
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

/** 배열 칸의 개수를 「3개」처럼. 비었거나 배열이 아니면 그리지 않는다. */
const count = (detail: Record<string, unknown> | null, key: string, unit: string) => {
  const value = detail?.[key]
  return Array.isArray(value) && value.length > 0 ? `${value.length}${unit}` : undefined
}

/** 결재 유형 이름. 위임은 유형을 고르지 않으면 전체다(`type_code: null`). */
const approvalType = (detail: Record<string, unknown> | null): string | undefined => {
  const code = detail?.type_code
  if (code === null) return '모든 유형'
  return typeof code === 'string' && Object.hasOwn(APPROVAL_TYPE_LABEL, code)
    ? APPROVAL_TYPE_LABEL[code as ApprovalTypeCode]
    : undefined
}

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

    // 서버는 글 id 만 남긴다(제목 없음).
    case 'boards.post_pinned':
      return {
        summary: detail?.pinned === false ? '게시글 고정 해제' : '게시글 고정',
        tone: 'neutral',
      }

    case 'docs.ai_source':
      return {
        summary: detail?.ai_source === false ? 'AI 근거에서 문서 제외' : 'AI 근거로 문서 다시 사용',
        tone: 'neutral',
      }

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

    case 'crm.imported': {
      const count = (key: string, unit: string) =>
        typeof detail?.[key] === 'number' ? `${String(detail[key])}${unit}` : undefined
      return {
        summary: 'CRM CSV 가져오기',
        detail:
          [count('orgs', '곳'), count('contacts', '명')].filter(Boolean).join(' · ') || undefined,
        tone: 'neutral',
      }
    }

    case 'crm.import_undone': {
      const count = (key: string, unit: string) =>
        typeof detail?.[key] === 'number' ? `${String(detail[key])}${unit}` : undefined
      return {
        summary: 'CRM 가져오기 되돌리기',
        detail:
          [count('removed_orgs', '곳'), count('removed_contacts', '명')]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: 'warning',
      }
    }

    case 'crm.org_deleted':
      return {
        summary: 'CRM 기관 삭제',
        detail:
          [text(detail, 'name'), text(detail, 'reason')].filter(Boolean).join(' · ') || undefined,
        tone: 'warning',
      }

    case 'crm.contact_erased':
      return { summary: 'CRM 담당자 개인정보 삭제', tone: 'warning' }

    case 'crm.org_restored':
      return {
        summary: 'CRM 기관 되살리기',
        detail: text(detail, 'name') || undefined,
        tone: 'neutral',
      }

    case 'crm.deal_deleted':
      return {
        summary: 'CRM 안건 삭제',
        detail: text(detail, 'name') || undefined,
        tone: 'warning',
      }

    // `tasks` 는 같이 지워진 업무 수다.
    case 'projects.deleted': {
      const tasks =
        typeof detail?.tasks === 'number' && detail.tasks > 0 && `업무 ${detail.tasks}개`
      return {
        summary: '협업 공간 프로젝트 삭제',
        detail: [text(detail, 'name'), tasks].filter(Boolean).join(' · ') || undefined,
        tone: 'warning',
      }
    }

    // 이름은 기록에 없다(개인정보 삭제와 같은 이유).
    case 'crm.contact_deleted':
      return { summary: 'CRM 담당자 삭제', tone: 'warning' }

    case 'crm.activity_deleted':
      return { summary: 'CRM 활동 기록 삭제', tone: 'neutral' }

    case 'admin.holiday_created':
      return {
        summary: '회사 휴일 등록',
        detail:
          [text(detail, 'date'), text(detail, 'name')].filter(Boolean).join(' · ') || undefined,
        tone: 'neutral',
      }

    case 'admin.holiday_updated': {
      const before = text(detail, 'from')
      const after = text(detail, 'to')
      return {
        summary: '회사 휴일 이름 변경',
        detail:
          [text(detail, 'date'), before && after ? `${before} → ${after}` : after || before]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: 'neutral',
      }
    }

    case 'admin.holiday_deleted':
      return {
        summary: '회사 휴일 삭제',
        detail:
          [text(detail, 'date'), text(detail, 'name')].filter(Boolean).join(' · ') || undefined,
        tone: 'warning',
      }

    case 'admin.calendar_rebuilt':
      return {
        summary: '근무 달력 다시 만들기',
        detail:
          [
            typeof detail?.year === 'number' ? `${detail.year}년` : undefined,
            typeof detail?.workdays === 'number' ? `근무일 ${detail.workdays}일` : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: 'neutral',
      }

    case 'approvals.decided': {
      const rejected = text(detail, 'action') === 'reject'
      return {
        summary: rejected ? '결재 반려' : '결재 승인',
        detail:
          [
            typeof detail?.step === 'number' ? `${detail.step}단계` : undefined,
            // 위임받은 사람이 원래 결재자 대신 처리했다.
            text(detail, 'acting_for') ? '대결' : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: rejected ? 'warning' : 'neutral',
      }
    }

    case 'approvals.force_closed':
      return { summary: '결재 강제 종결', detail: text(detail, 'reason'), tone: 'warning' }

    // 임원이 기안하면 결재자가 없어 상신과 동시에 확정된다.
    case 'approvals.auto_approved':
      return {
        summary: '결재 자동 확정',
        detail: [approvalType(detail), '결재선 없음'].filter(Boolean).join(' · '),
        tone: 'neutral',
      }

    case 'approvals.delegation_created': {
      const from = text(detail, 'start_date')
      const to = text(detail, 'end_date')
      return {
        summary: '결재 위임 설정',
        detail:
          [from && to ? `${from} ~ ${to}` : from || to, approvalType(detail)]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: 'neutral',
      }
    }

    case 'approvals.delegation_deleted':
      return { summary: '결재 위임 해제', tone: 'neutral' }

    case 'attendance.closed':
      return { summary: '근태 월 마감', detail: text(detail, 'month'), tone: 'neutral' }

    case 'attendance.reopened':
      return {
        summary: '근태 월 마감 해제',
        detail:
          [text(detail, 'month'), text(detail, 'reason')].filter(Boolean).join(' · ') || undefined,
        tone: 'warning',
      }

    case 'boards.attachments_changed':
      return {
        summary: '게시글 첨부 변경',
        detail:
          [count(detail, 'added', '개 붙임'), count(detail, 'removed', '개 뗌')]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: 'neutral',
      }

    case 'boards.comment_edited':
      return { summary: '게시글 댓글 수정', detail: text(detail, 'before'), tone: 'neutral' }

    case 'boards.comment_deleted': {
      // 쓴 사람과 지운 사람이 다르면 임원이 남의 댓글을 지운 것이다.
      const author = text(detail, 'author_id')
      const byOther = author !== undefined && author !== event.actor_id
      return {
        summary: byOther ? '남의 게시글 댓글 삭제' : '게시글 댓글 삭제',
        detail: text(detail, 'preview'),
        tone: 'warning',
      }
    }

    case 'docs.comment_edited':
      return { summary: '문서 댓글 수정', detail: text(detail, 'before'), tone: 'neutral' }

    case 'docs.comment_deleted':
      return { summary: '문서 댓글 삭제', detail: text(detail, 'preview'), tone: 'warning' }

    case 'docs.folder_deleted':
      return { summary: '폴더 삭제', detail: text(detail, 'title'), tone: 'warning' }

    case 'channels.renamed': {
      const before = text(detail, 'from')
      const after = text(detail, 'to')
      return {
        summary: '채널 이름 변경',
        detail: before && after ? `${before} → ${after}` : after || before,
        tone: 'neutral',
      }
    }

    case 'channels.members_changed': {
      if (detail?.created) {
        return {
          summary: '비공개 채널 생성',
          detail: count(detail, 'added', '명'),
          tone: 'neutral',
        }
      }
      const removed = detail?.removed
      if (Array.isArray(removed)) {
        // 스스로 나가도 같은 기록이 남는다. 내보낸 것으로 읽히지 않게 가른다.
        const left = removed.length === 1 && removed[0] === event.actor_id
        return left
          ? { summary: '채널에서 나감', tone: 'neutral' }
          : { summary: '채널에서 내보냄', detail: count(detail, 'removed', '명'), tone: 'neutral' }
      }
      return { summary: '채널에 사람 추가', detail: count(detail, 'added', '명'), tone: 'neutral' }
    }

    // 채팅 본문은 서버 기록에 앞부분이 남지만 여기서는 그리지 않는다. DM 도 이 종류로 남는다.
    case 'chat.message_edited':
      return { summary: '채팅 메시지 수정', tone: 'neutral' }

    case 'chat.message_deleted':
      return {
        summary: '채팅 메시지 삭제',
        detail: count(detail, 'attachments', '개 첨부'),
        tone: 'warning',
      }

    default:
      return { summary: kind, tone: 'neutral' }
  }
}
