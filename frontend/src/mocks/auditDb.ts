import type { AuditEvent, AuditPage } from '@/features/admin/audit'
import { MOCK_USERS } from './db'

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const user = (index: number) => MOCK_USERS[index % MOCK_USERS.length].id

/**
 * 감사 기록. 서버가 실제로 남기는 열세 가지 종류를 섞어 둔다(`app/audit.py` 호출부).
 *
 * `detail` 모양은 백엔드 호출부와 똑같아야 한다. 화면이 거기서 문구를 만들기 때문에, 목이
 * 다른 모양을 주면 실제 서버에 붙였을 때 부연이 통째로 비거나 영문 필드명이 그대로 나간다.
 */
const SEEDS: Omit<AuditEvent, 'id' | 'at'>[] = [
  {
    kind: 'auth.login_ok',
    actor_id: user(0),
    target_id: null,
    ip: '10.0.1.24',
    user_agent: 'Mozilla/5.0',
    detail: null,
  },
  {
    kind: 'auth.login_fail',
    actor_id: null,
    target_id: null,
    ip: '10.0.1.77',
    user_agent: 'Mozilla/5.0',
    detail: { email: 'suyeon@zenith.co.kr' },
  },
  {
    kind: 'auth.login_fail',
    actor_id: user(2),
    target_id: null,
    ip: '10.0.1.31',
    user_agent: 'Mozilla/5.0',
    detail: { email: 'jiyun@zenith.co.kr', reason: 'disabled' },
  },
  {
    kind: 'auth.logout',
    actor_id: user(1),
    target_id: 'sess-1',
    ip: '10.0.1.25',
    user_agent: 'Mozilla/5.0',
    detail: null,
  },
  {
    kind: 'auth.password_changed',
    actor_id: user(2),
    target_id: null,
    ip: '10.0.1.26',
    user_agent: 'Mozilla/5.0',
    detail: null,
  },
  {
    kind: 'auth.refresh_reuse',
    actor_id: user(4),
    target_id: 'sess-2',
    ip: '203.0.113.9',
    user_agent: 'curl/8.4.0',
    detail: null,
  },
  {
    // 게시판 거부만 현재 등급까지 담는다(`boards._deny`). `reason` 은 read·delete 뿐이다.
    kind: 'acl.denied',
    actor_id: user(5),
    target_id: 'b-exec',
    ip: '10.0.1.40',
    user_agent: 'Mozilla/5.0',
    detail: {
      path: '/api/boards/exec/posts',
      reason: 'read',
      min_role: 'exec',
      role: 'member',
      post_id: null,
    },
  },
  {
    // 가장 자주 쌓이는 모양. 등급 검사(`require_role`)는 현재 등급을 안 남긴다.
    kind: 'acl.denied',
    actor_id: user(4),
    target_id: null,
    ip: '10.0.1.33',
    user_agent: 'Mozilla/5.0',
    detail: { path: '/api/admin/users', min_role: 'exec' },
  },
  {
    // 채널 거부는 경로만 남는다.
    kind: 'acl.denied',
    actor_id: user(7),
    target_id: 'c-dev',
    ip: '10.0.1.42',
    user_agent: 'Mozilla/5.0',
    detail: { path: '/api/channels/c-dev/messages' },
  },
  {
    kind: 'acl.denied',
    actor_id: user(6),
    target_id: 'c-notice',
    ip: '10.0.1.41',
    user_agent: 'Mozilla/5.0',
    detail: { path: '/api/ws', op: 'send' },
  },
  {
    kind: 'admin.user_created',
    actor_id: user(8),
    target_id: user(6),
    ip: '10.0.1.10',
    user_agent: 'Mozilla/5.0',
    detail: { email: 'yerim@zenith.co.kr', role: 'member' },
  },
  {
    kind: 'admin.user_updated',
    actor_id: user(8),
    target_id: user(6),
    ip: '10.0.1.10',
    user_agent: 'Mozilla/5.0',
    detail: {
      fields: ['role'],
      before: { role: 'member', active: true },
      after: { role: 'lead', active: true },
    },
  },
  {
    kind: 'admin.user_updated',
    actor_id: user(9),
    target_id: user(5),
    ip: '10.0.1.11',
    user_agent: 'Mozilla/5.0',
    detail: {
      fields: ['active', 'password'],
      before: { role: 'member', active: true },
      after: { role: 'member', active: false },
    },
  },
  {
    kind: 'boards.post_deleted',
    actor_id: user(8),
    target_id: 'b-all',
    ip: '10.0.1.10',
    user_agent: 'Mozilla/5.0',
    detail: { post_id: 'p-9', title: '중복 올린 워크숍 공지' },
  },
  {
    kind: 'docs.hard_deleted',
    actor_id: user(9),
    target_id: 'd-90',
    ip: '10.0.1.11',
    user_agent: 'Mozilla/5.0',
    detail: { title: '2025 예산 초안' },
  },
  {
    kind: 'docs.purged',
    actor_id: null,
    target_id: 'd-91',
    ip: null,
    user_agent: null,
    detail: { title: '임시 메모', deleted_at: at(60 * 24 * 31) },
  },
  {
    kind: 'files.uploaded',
    actor_id: user(2),
    target_id: 'f-1',
    ip: '10.0.1.26',
    user_agent: 'Mozilla/5.0',
    detail: { actor: user(2), size: 248_000, type: 'image/png' },
  },
  {
    kind: 'files.rejected',
    actor_id: user(3),
    target_id: null,
    ip: '10.0.1.31',
    user_agent: 'Mozilla/5.0',
    detail: { claimed: 'application/x-msdownload', name: 'setup.exe' },
  },
]

/**
 * 최신순. 씨앗을 열 바퀴 돌린다. 한 장이 쉰 줄이라, **거른 뒤에도** "더 보기" 가 눌리려면
 * 한 갈래가 쉰 줄을 넘어야 한다(로그인·세션 갈래가 예순 줄).
 */
const EVENTS: AuditEvent[] = Array.from({ length: SEEDS.length * 10 }, (_, index) => ({
  ...SEEDS[index % SEEDS.length],
  id: `a-${index + 1}`,
  at: at(index * 37 + 5),
}))

let nextId = EVENTS.length + 1

/**
 * 목이 스스로 남기는 기록. 실제 서버는 계정을 만들거나 고칠 때 감사 줄을 같이 쌓는다
 * (`admin.user_created`·`admin.user_updated`). 목이 안 쌓으면 방금 한 일이 기록에 안 보여,
 * 계정 탭에서 바꾸고 기록 탭을 열었을 때 화면이 맞는지 개발에서 확인할 수가 없다.
 */
export function push(event: Omit<AuditEvent, 'id' | 'at'>): void {
  EVENTS.unshift({ ...event, id: `a-${nextId++}`, at: new Date().toISOString() })
}

/**
 * 서버와 같은 모양의 불투명 커서: `시각|id` 를 **urlsafe** base64 로(`app/paging.py`).
 * 안을 읽는 쪽은 이 파일뿐이다.
 */
const encode = (event: AuditEvent) =>
  btoa(`${event.at}|${event.id}`).replace(/\+/g, '-').replace(/\//g, '_')

const decode = (cursor: string) => atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))

/** 커서가 가리키는 줄의 다음부터가 다음 장이다. 못 찾으면 더 줄 것이 없다는 뜻으로 본다. */
function idOf(cursor: string): string | null {
  try {
    return decode(cursor).split('|')[1] ?? null
  } catch {
    return null
  }
}

export function listAudit(kind: string | null, cursor: string | null, limit: number): AuditPage {
  // 서버는 앞글자 일치다(`kind.startswith`). `auth` 하나로 로그인·로그아웃이 같이 걸린다.
  const rows = kind ? EVENTS.filter((event) => event.kind.startsWith(kind)) : EVENTS

  let start = 0
  if (cursor) {
    const id = idOf(cursor)
    const found = rows.findIndex((event) => event.id === id)
    if (found < 0) return { items: [], next_cursor: null }
    start = found + 1
  }

  const page = rows.slice(start, start + limit)
  const more = rows.length > start + limit
  return {
    items: page,
    next_cursor: more && page.length > 0 ? encode(page[page.length - 1]) : null,
  }
}

/** 커서가 망가졌는지 판정. 서버는 422 를 준다. */
export function badCursor(cursor: string): boolean {
  try {
    const [time, id] = decode(cursor).split('|')
    return !time || !id || Number.isNaN(Date.parse(time))
  } catch {
    return true
  }
}
