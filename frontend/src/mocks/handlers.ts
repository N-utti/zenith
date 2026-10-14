import { bypass, delay, http, HttpResponse, passthrough } from 'msw'
import { PASSWORD_MIN, type User } from '@/types'
import { BODY_MAX, POST_COMMENT_MAX, TITLE_MAX } from '@/features/board/types'
import type { PostAttachment } from '@/features/board/types'
import { ARCHIVE_LIMIT, type ArchiveFile } from '@/features/archive/types'
import type { ChatChannel, ChatMessage } from '@/features/chat/types'
import { chatFiles, docFiles, newestFirst } from './archiveDb'
import { DEMO_PASSWORD } from './accounts'
import { createAccount, emailTaken, findAccount, listAccounts, patchAccount } from './adminDb'
import { badCursor, listAudit, push as recordAudit } from './auditDb'
import { EMAIL_PATTERN, type UserCreate, type UserPatch } from '@/features/admin/types'
import {
  START_PAGES,
  type Preferences,
  type PreferencesPatch,
} from '@/features/settings/preferences'
import {
  clearMockSession,
  createTeam,
  MOCK_TEAM_LIST,
  renameTeam,
  MOCK_USERS,
  setMockSession,
  userFromCookie,
} from './db'
import {
  AI_MODELS,
  answer,
  checkClaims,
  DOC_ACTIONS,
  docActionCitations,
  docActionDraft,
  docAnswer,
  fileCitations,
} from './aiDb'
import {
  BOARD_DEFS,
  addPostComment,
  canDownloadPostAttachment,
  canEdit,
  canRead,
  checkPostAttachments,
  createPost,
  deletePost,
  editPostComment,
  homePosts,
  findPost,
  listBoards,
  listPostComments,
  listPosts,
  postAttachmentPrefix,
  recordPostAttachment,
  removePostComment,
  toDetail,
  updatePost,
} from './boardDb'
import { addTask, findTask, listTasks, removeTask } from './dashboardDb'
import { TODO_TEXT_MAX } from '@/features/home/types'
import { BLOCK_ID_MAX, COMMENT_BODY_MAX } from '@/features/docs/types'
import {
  listMentionNotifications,
  listNotifications,
  markRead as markNotificationsRead,
  removeNotifications,
} from './notificationsDb'
import { search } from './searchDb'
import {
  addComment,
  addVersion,
  createDoc,
  createFolder,
  docTree,
  editComment,
  findFolder,
  findVersion,
  isDescendantFolder,
  removeFolder,
  purgeDoc,
  trashDoc,
  untrashDoc,
  updateFolder,
  DOC_SEEDS,
  findDoc,
  listComments,
  removeComment,
  listTrash,
  recentDocs,
  listVersions,
  touchDoc,
} from './docsDb'
import {
  attendanceMonth,
  attendanceRange,
  companyAttendance,
  cancelException,
  createArrangement,
  createCorrection,
  createOvertime,
  listArrangements,
  listArrangementsInRange,
  listCorrections,
  listOvertime,
  MONTH,
  workdaysInYear,
  type ExceptionStore,
} from './attendanceDb'
import {
  APPROVAL_TYPES,
  cancelApproval,
  createDelegation,
  attachmentPrefix,
  checkAttachTarget,
  checkAttachmentDownload,
  createDraft,
  recordAttachment,
  deleteDelegation,
  forceClose,
  listDelegations,
  decide,
  getApproval,
  listApprovals,
  submitApproval,
  updateDraft,
  deleteDraft,
} from './approvalsDb'
import {
  createActivity,
  createContact,
  createDeal,
  createOrg,
  deleteActivity,
  deleteContact,
  deleteDeal,
  deleteOrg,
  dropDeal,
  eraseContact,
  getDeal,
  getOrg,
  listActivities,
  listDeals,
  listDeletedOrgs,
  listOrgs,
  reopenDeal,
  restoreOrg,
  updateActivity,
  updateContact,
  updateDeal,
  updateOrg,
  exportRows,
  importContacts,
  lastImport,
  undoImport,
} from './crmDb'
import { decodeText, parseCsv } from './csv'

import type { ActivityInput, ContactInput, DealInput, OrgInput } from '@/features/crm/types'
import type { ProjectInput, TaskInput } from '@/features/projects/types'
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getProject,
  listProjects,
  listTasks as listProjectTasks,
  updateProject,
  updateTask,
} from './projectsDb'
import { listFiles, readFile, saveFile } from './filesDb'
import { isImage } from '@/features/chat/attachments'
import { buildXlsx } from '@/lib/xlsx'
import { closeMonth, getClosing, listClosings, reopenMonth } from './closingsDb'
import { addHoliday, listHolidays, removeHoliday, renameHoliday } from './holidaysDb'
import { createEvent, deleteEvent, listEvents } from './eventsDb'
import {
  cancelLeave,
  createLeave,
  ISO_DATE,
  LEAVE_TYPES,
  leaveBalance,
  listBalances,
  listLeaves,
  listLeavesInRange,
} from './leavesDb'

/** 가져오기 파일 크기 상한. 2천 행 주소록이 넉넉히 들어간다. */
const IMPORT_MAX_BYTES = 1024 * 1024

function authenticate(): User | undefined {
  // 세션은 쿠키다(04 §1). 핸들러는 페이지 안에서 돌므로 document.cookie 를 그대로 읽는다.
  return userFromCookie(document.cookie)
}

/** 기간 집계가 한 번에 훑는 최대 길이. 목이 달마다 근무일을 만들어 내서 무한정 늘릴 수 없다. */
const RANGE_MAX_DAYS = 366

/** 사내망 파일 업로드 상한. 실제 서버(FastAPI)도 같은 값을 강제해야 한다. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** AI 질문 첨부(백엔드 #396). 서버가 읽는 형식과 올린 파일. 메모리에만 둔다. */
const AI_ATTACH_EXTS = ['txt', 'md', 'csv', 'docx', 'xlsx', 'pdf', 'hwpx']
const AI_ATTACHMENTS = new Map<string, { owner: string; name: string; blob: File; text: string }>()

const unauthorized = () =>
  HttpResponse.json({ detail: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, { status: 401 })
const notFound = (detail = '문서를 찾을 수 없습니다.') =>
  HttpResponse.json({ detail, code: 'NOT_FOUND' }, { status: 404 })

/**
 * 안 읽은 대화. 채팅은 MSW 가 아니라 개발 릴레이에 있어서 목이 그 값을 모른다.
 * 그래서 여기서만 릴레이에 한 번 물어본다. 실제 서버는 홈 한 벌에 이미 담아서 준다.
 *
 * 릴레이가 안 떠 있으면 빈 목록이다. 홈의 다른 카드까지 같이 죽으면 안 된다.
 */
async function unreadChannels(meId: string) {
  try {
    // `bypass` 로 이 요청이 목을 다시 타지 않게 못 박는다. 지금은 `/api/channels` 가
    // passthrough 라 우연히 맞지만, 나중에 거기 진짜 핸들러가 들어오면 목이 목을 부른다.
    // 릴레이가 떠 있으면서 응답하지 않으면 홈 카드 다섯 장이 전부 스켈레톤에 묶이므로 끊어 준다.
    const res = await fetch(bypass('/api/channels'), { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return []
    const { items } = (await res.json()) as { items: ChatChannel[] }
    return items
      .filter((channel) => channel.unread > 0)
      .map((channel) => ({
        channel_id: channel.id,
        name: channel.name,
        is_dm: channel.is_dm,
        is_private: channel.is_private,
        // DM 이면 상대, 채널이면 null. 홈과 채팅이 같은 사람을 같은 색으로 그린다.
        peer_id: channel.is_dm
          ? (channel.members.find((member) => member.id !== meId)?.id ?? null)
          : null,
        count: channel.unread,
      }))
  } catch {
    return []
  }
}

/**
 * 채팅 첨부. 릴레이에 채널 목록을 묻고 채널마다 메시지를 받아 첨부를 꺼낸다. 실제 서버는
 * 질의 한 번으로 준다.
 *
 * 릴레이가 **내가 멤버인 채널만** 주고 남의 채널 메시지는 403 이라, 열람 판정은 릴레이가 한다.
 * 요청 하나가 실패하면 그 몫만 비운다. 릴레이가 안 떠 있으면 전부 빈 목록이다. 문서 파일이나
 * 다른 채널의 파일까지 같이 죽으면 안 된다.
 */
async function chatArchive(): Promise<ArchiveFile[]> {
  const get = async <T>(path: string): Promise<T[]> => {
    try {
      const res = await fetch(bypass(path), { signal: AbortSignal.timeout(2000) })
      return res.ok ? ((await res.json()) as { items: T[] }).items : []
    } catch {
      return []
    }
  }
  const channels = await get<ChatChannel>('/api/channels')
  const perChannel = await Promise.all(
    channels.map(async (channel) =>
      chatFiles(
        channel,
        // ponytail: 채널마다 최근 메시지 이만큼만 훑는다. 목의 대화는 짧아서 넘칠 일이 없다.
        await get<ChatMessage>(`/api/channels/${channel.id}/messages?limit=${ARCHIVE_LIMIT}`),
      ),
    ),
  )
  return perChannel.flat()
}

/**
 * 휴지통에 든 문서는 **읽기만** 된다. 백엔드는 수정·버전 저장·댓글 작성에서 404 다
 * (`_get_doc` 의 `trashed_ok`). 읽기(상세·버전 목록·댓글 목록)는 되돌리기 전에 확인할 수
 * 있어야 하므로 열어 둔다.
 */
function aliveDoc(id: string) {
  const doc = findDoc(id)
  return doc && !doc.deleted_at ? doc : undefined
}

/**
 * 권한 거부는 한 가지 문구뿐이다. 백엔드 `_deny` 도 열람 거부와 수정 거부를 구분해 주지
 * 않는다(`app/errors.py`). "이 게시판은 내 등급 밖" 과 "내 글이 아님" 을 호출자가 가려낼
 * 수 있으면 그 자체가 정보다.
 */
const forbidden = () =>
  HttpResponse.json({ detail: '권한이 부족합니다.', code: 'FORBIDDEN' }, { status: 403 })

const validationError = (detail: string) =>
  HttpResponse.json({ detail, code: 'VALIDATION' }, { status: 422 })

/**
 * 문서 파일의 형식. 그림 넷이면 그 형식, 아니면 `application/octet-stream` (백엔드 `files.py` 의 `_sniff`).
 *
 * ponytail: 목은 이름의 확장자로 가른다. 실서버는 내용(앞 바이트)으로 판정하므로, 이름만 `.png` 인
 * PDF 가 칩으로 들어가는지는 목으로 확인할 수 없다. 필요해지면 `filesDb` 에 판정한 형식을 같이 저장한다.
 */
function mockContentType(name: string): string {
  if (!isImage(name)) return 'application/octet-stream'
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`
}

/** 서버 `_require_team` 과 같은 판정. 없는 팀이면 422 라 목도 같이 막아야 한다. */
const unknownTeam = (teamId: string | null | undefined) =>
  typeof teamId === 'string' && !MOCK_TEAM_LIST.some((team) => team.id === teamId)

/** 사람마다 한 벌. 없으면 서버 기본값(전부 켜짐, 홈)으로 만든다. */
const PREFERENCES = new Map<string, Preferences>()
const preferencesOf = (userId: string) => {
  let prefs = PREFERENCES.get(userId)
  if (!prefs) {
    prefs = {
      notifications: {
        mention: true,
        comment: true,
        reply: true,
        post: true,
        attendance: true,
        approval: true,
      },
      start_page: '/',
    }
    PREFERENCES.set(userId, prefs)
  }
  return prefs
}

/** 서버 `TeamIn.name`: 앞뒤 공백을 다듬고 1~100자. 어긋나면 `null`. */
const teamName = (body: { name?: unknown } | null) => {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  return name && name.length <= 100 ? name : null
}

const teamConflict = () =>
  HttpResponse.json({ detail: '같은 이름의 팀이 있습니다.', code: 'CONFLICT' }, { status: 409 })

/** 본문이 JSON 이 아니면 500 대신 422 로 떨어뜨린다. 백엔드도 422 다. */
async function readJson<T>(request: Request): Promise<T | null> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null ? (parsed as T) : null
  } catch {
    return null
  }
}

/**
 * 글의 제목·본문 제약(`PostCreateIn`·`PostPatchIn`). 백엔드에서는 Pydantic 이 핸들러보다
 * 먼저 돌기 때문에 권한 검사보다 앞이다. `null` 은 여기서 보지 않는다(핸들러 안쪽 검사).
 */
function checkPostFields(body: { title?: unknown; body?: unknown }) {
  for (const [key, max, label] of [
    ['title', TITLE_MAX, '제목'],
    ['body', BODY_MAX, '내용'],
  ] as const) {
    const value = body[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') return validationError(`${label}은 문자열이어야 합니다.`)
    if (!value.trim()) return validationError('제목과 내용을 입력해 주세요.')
    if (value.trim().length > max) return validationError(`${label}은 ${max}자를 넘을 수 없습니다.`)
  }
  return null
}

/** 결재·CRM 목의 결과 → 응답. 실패는 `{error, status, code}` 모양(13 §9 의 403·404·409·422). */
function approvalResponse(
  result: { error: string; status: number; code: string } | object,
  ok = 200,
) {
  if ('error' in result) {
    return HttpResponse.json({ detail: result.error, code: result.code }, { status: result.status })
  }
  return HttpResponse.json(result, { status: ok })
}

/** CRM 감사 기록. kind 는 점 표기(`crm.*`)로 관리자 감사 화면의 `crm` 필터에 걸린다. */
function crmAudit(
  kind: string,
  user: User,
  targetId: string | null,
  detail: Record<string, unknown> | null = null,
) {
  recordAudit({
    kind,
    actor_id: user.id,
    target_id: targetId,
    ip: '127.0.0.1',
    user_agent: navigator.userAgent,
    detail,
  })
}

/** 인증이 필요한 핸들러의 공통 껍데기. */
function authed(resolve: (user: User, request: Request) => Response) {
  return ({ request }: { request: Request }) => {
    const user = authenticate()
    return user ? resolve(user, request) : unauthorized()
  }
}

export const handlers = [
  // 채팅은 MSW가 흉내 내지 않는다. 브라우저마다 따로 도는 목으로는 메시지가
  // 공유되지 않기 때문이다. vite가 개발 서버(`npm run server`)로 넘기도록
  // 그대로 통과시킨다.
  //
  // 개발 릴레이(`scripts/chat.js`)가 실제로 여는 아홉 개만 넘긴다. `/api/channels/*` 로
  // 뭉뚱그리면 아직 안 만든 경로까지 삼켜 릴레이의 404로 조용히 떨어지고,
  // 통과는 "처리됨"이라 onUnhandledRequest 경고도 안 뜬다.
  http.get('/api/channels', () => passthrough()),
  http.post('/api/channels', () => passthrough()),
  // 메시지는 GET 만. 보내기·읽음은 REST 가 아니라 소켓 op 이다(04 §4.1, 이슈 #128).
  http.get('/api/channels/:channelId/messages', () => passthrough()),
  http.post('/api/channels/:channelId/attachments', () => passthrough()),
  http.get('/api/channels/:channelId/attachments/*', () => passthrough()),
  // 비공개 채널의 멤버 더하기·빼기.
  http.post('/api/channels/:channelId/members', () => passthrough()),
  http.delete('/api/channels/:channelId/members/:userId', () => passthrough()),
  // 채널 이름 바꾸기와 DM 숨기기(백엔드 #280).
  http.patch('/api/channels/:channelId', () => passthrough()),
  http.post('/api/channels/:channelId/hide', () => passthrough()),

  // ── 인증 ──────────────────────────────────────────────────
  http.post('/api/auth/login', async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string }
    const user = MOCK_USERS.find((u) => u.email === email.trim().toLowerCase())

    if (!user || password !== DEMO_PASSWORD) {
      return HttpResponse.json(
        { detail: '이메일 또는 비밀번호가 올바르지 않습니다.', code: 'AUTH_INVALID' },
        { status: 401 },
      )
    }

    // 04 §1: 204 + 쿠키. 본문에 토큰이 없다.
    setMockSession(user)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/auth/refresh', () => {
    const user = authenticate()
    if (!user) return unauthorized()
    setMockSession(user)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(
    '/api/me',
    authed((user) => HttpResponse.json(user)),
  ),

  // 04 밖 환경설정(backend/README 17). 서버처럼 준 것만 덮어쓰고 전체를 돌려준다. 모르는 키·값은 422.
  // ponytail: 목의 알림 생성은 이 설정을 보지 않는다. 끄기가 실제로 먹는지는 실서버에서 본다.
  http.get(
    '/api/me/preferences',
    authed((user) => HttpResponse.json(preferencesOf(user.id))),
  ),

  http.patch('/api/me/preferences', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const patch = await readJson<PreferencesPatch>(request)
    if (!patch) return validationError('본문이 올바르지 않습니다.')
    const prefs = preferencesOf(user.id)
    const kinds = Object.keys(prefs.notifications)
    const bad =
      Object.keys(patch).some((key) => key !== 'notifications' && key !== 'start_page') ||
      Object.entries(patch.notifications ?? {}).some(
        ([kind, on]) => !kinds.includes(kind) || typeof on !== 'boolean',
      ) ||
      (patch.start_page != null && !START_PAGES.some((page) => page.value === patch.start_page))
    if (bad) return validationError('알 수 없는 설정입니다.')
    Object.assign(prefs.notifications, patch.notifications)
    if (patch.start_page) prefs.start_page = patch.start_page
    return HttpResponse.json(prefs)
  }),

  http.post('/api/auth/logout', () => {
    clearMockSession()
    return new HttpResponse(null, { status: 204 })
  }),

  // backend/README §1 확장. 성공 시 204, 현재 비밀번호 불일치는 400 PASSWORD_MISMATCH.
  // ponytail: 목은 비밀번호를 실제로 바꾸지 않는다. 데모 계정 전부가 DEMO_PASSWORD 하나를 쓴다.
  http.post('/api/me/password', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { current_password, new_password } = (await request.json()) as {
      current_password: string
      new_password: string
    }
    if (current_password !== DEMO_PASSWORD) {
      return HttpResponse.json(
        { detail: '현재 비밀번호가 올바르지 않습니다.', code: 'PASSWORD_MISMATCH' },
        { status: 400 },
      )
    }
    if (new_password.length < 8) {
      return HttpResponse.json(
        { detail: [{ msg: 'String should have at least 8 characters' }], code: 'VALIDATION' },
        { status: 422 },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // ── 게시판 ────────────────────────────────────────────────
  http.get(
    '/api/boards',
    authed((user) => HttpResponse.json({ items: listBoards(user) })),
  ),

  http.get(
    '/api/boards/:boardId/posts',
    authed((user, request) => {
      const boardId = new URL(request.url).pathname.split('/')[3]
      if (!BOARD_DEFS.some((board) => board.id === boardId)) return notFound()
      // 권한 밖 게시판이어도 목록 자체는 준다. 행이 전부 마스킹돼 나갈 뿐이다.
      return HttpResponse.json({ items: listPosts(user, boardId) })
    }),
  ),

  http.get('/api/posts/:postId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const post = findPost(String(params.postId))
    if (!post) return notFound()

    // 성공 기준: 목록은 마스킹, **본문은 403**. 제목조차 내려주지 않는다.
    if (!canRead(user, post.min_role)) {
      return HttpResponse.json(
        { detail: '열람 권한이 없습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    return HttpResponse.json(toDetail(post))
  }),

  /**
   * 글쓴이 또는 임원만. 백엔드와 순서까지 맞춘다.
   *
   * 제목·본문의 모양 검증은 백엔드에서 Pydantic 이 하고, FastAPI 는 그걸 **핸들러에
   * 들어가기 전에** 돌린다. 그래서 권한 없는 사람이 너무 긴 제목을 보내면 403 이 아니라
   * 422 다. `null` 검사만은 백엔드도 핸들러 안(권한 검사 뒤)에 있어서 여기서도 뒤에 남긴다.
   */
  http.patch('/api/posts/:postId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const body = await readJson<{ title?: unknown; body?: unknown; attachments?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    const shapeError = checkPostFields(body)
    if (shapeError) return shapeError

    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.min_role) || !canEdit(user, post)) return forbidden()

    // 첨부는 그 글이 있는 게시판에 올린 파일이어야 한다.
    const filesError = checkPostAttachments(
      post.board_id,
      body.attachments,
      user,
      post.attachments ?? [],
    )
    if (filesError) return validationError(filesError)

    // 보내지 않은 값은 그대로 둔다. null 은 "지움" 이 아니라 422 다.
    for (const key of ['title', 'body'] as const) {
      if (body[key] === null) return validationError(`${key} 는 null 일 수 없습니다.`)
    }

    return HttpResponse.json(
      updatePost(post, {
        title: typeof body.title === 'string' ? body.title.trim() : undefined,
        body: typeof body.body === 'string' ? body.body.trim() : undefined,
        attachments: body.attachments as PostAttachment[] | undefined,
      }),
    )
  }),

  http.delete('/api/posts/:postId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.min_role) || !canEdit(user, post)) return forbidden()

    deletePost(post.id)
    return new HttpResponse(null, { status: 204 })
  }),

  // ── 게시글 댓글 ─────────────────────────────────────────
  // 백엔드 #303 과 같은 모양이다(04 §6 에는 아직 없다).
  // 글을 읽을 수 있는 사람(게시판 등급)만 댓글을 보고 쓴다. 못 읽으면 글 본문과 같게 403 이다.
  // 고치기는 쓴 사람만, 지우기는 쓴 사람과 임원(글 지우기와 같은 기준).
  http.get('/api/posts/:postId/comments', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.min_role)) return forbidden()
    return HttpResponse.json({ items: listPostComments(post.id) })
  }),

  http.post('/api/posts/:postId/comments', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.min_role)) return forbidden()

    const body = await readJson<{ body?: unknown }>(request)
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text || text.length > POST_COMMENT_MAX) {
      return validationError(`댓글은 1자 이상 ${POST_COMMENT_MAX}자 이하여야 합니다.`)
    }
    return HttpResponse.json(addPostComment(post.id, user, text), { status: 201 })
  }),

  http.patch('/api/posts/:postId/comments/:commentId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.min_role)) return forbidden()

    const body = await readJson<{ body?: unknown }>(request)
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text || text.length > POST_COMMENT_MAX) {
      return validationError(`댓글은 1자 이상 ${POST_COMMENT_MAX}자 이하여야 합니다.`)
    }
    const result = editPostComment(post.id, user, String(params.commentId), text)
    if (result === 'not_found') return notFound('댓글을 찾을 수 없습니다.')
    if (result === 'forbidden') return forbidden()
    return HttpResponse.json(result)
  }),

  http.delete('/api/posts/:postId/comments/:commentId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const post = findPost(String(params.postId))
    if (!post) return notFound()
    if (!canRead(user, post.min_role)) return forbidden()

    const result = removePostComment(post.id, user, String(params.commentId))
    if (result === 'not_found') return notFound('댓글을 찾을 수 없습니다.')
    if (result === 'forbidden') return forbidden()
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/boards/:boardId/posts', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const boardId = String(params.boardId)
    const board = BOARD_DEFS.find((b) => b.id === boardId)
    if (!board) return notFound()

    // 05 FR-BRD-02. 열람할 수 있는 게시판에만 글을 쓸 수 있다.
    if (!canRead(user, board.min_role)) {
      return forbidden()
    }

    const parsed = await readJson<{ title?: unknown; body?: unknown; attachments?: unknown }>(
      request,
    )
    if (!parsed) return validationError('본문이 JSON 이 아닙니다.')
    if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string') {
      return validationError('제목과 내용을 입력해 주세요.')
    }
    const shapeError = checkPostFields(parsed)
    if (shapeError) return shapeError
    const filesError = checkPostAttachments(boardId, parsed.attachments, user)
    if (filesError) return validationError(filesError)

    return HttpResponse.json(
      createPost(user, boardId, {
        title: parsed.title.trim(),
        body: parsed.body.trim(),
        attachments: parsed.attachments as PostAttachment[] | undefined,
      }),
      { status: 201 },
    )
  }),

  // ── 게시글 첨부 ─────────────────────────────────────────
  // 백엔드 #306 과 같은 모양이다(채팅 첨부 `/channels/{id}/attachments` 와 같은 규약).
  // 그 게시판을 읽을 수 있는 사람(등급)만 올리고 받는다. 판정은 늘 경로의 게시판으로 한다.
  // 받기는 거기에 더해, 살아 있는 글이 싣고 있는 파일만 내준다.
  // 실서버(#323)와 같다. 안 붙인 파일은 올린 사람도 못 받는다.
  http.post('/api/boards/:boardId/attachments', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const board = BOARD_DEFS.find((b) => b.id === String(params.boardId))
    if (!board) return notFound()
    if (!canRead(user, board.min_role)) return forbidden()

    const file = (await request.formData()).get('file')
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return validationError('비어 있지 않은 10MB 이하 파일만 올릴 수 있습니다.')
    }
    // 앞머리 `a` 는 공용 `/api/files` 가 내주지 않는다. 등급 판정을 건너뛸 길이 없다.
    const stored = await saveFile(file, 'a')
    recordPostAttachment(board.id, stored.id, user.id)
    return HttpResponse.json(
      {
        url: `${postAttachmentPrefix(board.id)}${stored.id}/${encodeURIComponent(stored.name)}`,
        name: stored.name,
        size: stored.size,
        content_type: stored.type || null,
      },
      { status: 201 },
    )
  }),
  http.get('/api/boards/:boardId/attachments/:fileId/:name', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const board = BOARD_DEFS.find((b) => b.id === String(params.boardId))
    if (!board) return notFound()
    if (!canRead(user, board.min_role)) return forbidden()
    // 다른 게시판(이나 결재 문서)에 올린 파일 id 를 이 경로에 끼워 넣은 요청, 글에서 뗀 파일과
    // 지운 글의 파일을 막는다. 등급 판정(403)이 먼저라 등급 밖에서는 파일이 있는지도 알 수 없다.
    if (!canDownloadPostAttachment(board.id, new URL(request.url).pathname)) {
      return notFound('파일을 찾을 수 없습니다.')
    }
    const stored = await readFile(String(params.fileId))
    if (!stored) return notFound('파일을 찾을 수 없습니다.')
    // 실행될 수 있는 형식(html·svg)이 같은 오리진에서 열리지 않게 늘 내려받기로 준다.
    return new HttpResponse(stored.blob, {
      headers: {
        'Content-Type': stored.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(stored.name)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),

  // ── 사람 목록 ─────────────────────────────────────────────
  /**
   * 사람 고르는 자리가 쓰는 명단(#117). 계정 목록(`/admin/users`)과 달리 로그인하면 누구나.
   * `role` 은 서버 계약에 아직 없다. 결재 참조자를 사원·임원으로 가르려고 요청한 칸이다.
   *
   * 관리 화면과 같은 저장소를 본다. 두 벌이면 계정을 비활성으로 바꿔도 대화 상대 목록에
   * 그대로 남는다 — 실서버에서는 안 생기는 차이다.
   *
   * 반대 방향은 목에만 남는다: 여기서 **만든** 계정(`u-100`~)은 채팅 릴레이의 명단
   * (`scripts/chat.js` 는 `users.json` 만 안다)에 없어서, DM 을 열면 릴레이가 422 를 준다.
   */
  http.get(
    '/api/people',
    authed(() =>
      HttpResponse.json({
        items: listAccounts().map(({ id, name, active, role }) => ({ id, name, active, role })),
      }),
    ),
  ),

  // ── 홈 한 벌 ──────────────────────────────────────────────
  /**
   * 대시보드 1콜. 카드 다섯 개가 이것 하나를 나눠 쓴다.
   *
   * 조각을 따로 만들지 않는다. 공지는 게시판, 멘션은 알림, 할 일은 할 일 저장소에서 온다.
   * 별도 데이터를 두면 두 벌이 되어 어긋난다.
   */
  http.get('/api/me/home', async () => {
    const user = authenticate()
    if (!user) return unauthorized()
    return HttpResponse.json({
      recent_docs: recentDocs(user, 8),
      mentions: listMentionNotifications(user, 10),
      unread: await unreadChannels(user.id),
      posts: homePosts(user, 3),
      todos: listTasks().slice(0, 200),
    })
  }),

  // ── 통합검색 (⌘K) ────────────────────────────────────────
  http.get(
    '/api/search',
    authed((user, request) => {
      const url = new URL(request.url)
      const q = url.searchParams.get('q') ?? ''
      // 백엔드는 1자 이상 200자 이하만 받는다(`Query(min_length=1, max_length=200)`).
      if (q.length < 1 || q.length > 200) {
        return validationError('검색어는 1자 이상 200자 이하여야 합니다.')
      }
      const raw = url.searchParams.get('limit')
      const limit = raw === null ? 20 : Number(raw)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return validationError('limit 은 1 이상 50 이하의 정수여야 합니다.')
      }
      const types = (url.searchParams.get('types') ?? 'doc,chat,post')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (types.length === 0 || types.some((t) => !['doc', 'chat', 'post'].includes(t))) {
        return validationError('types 는 doc, chat, post 중에서.')
      }
      // 응답이 `{items}` 가 아니라 배열 그대로다.
      return HttpResponse.json(search(user, q, limit))
    }),
  ),

  // ── 알림함 (`/notifications`) ─────────────────────────────
  http.get(
    '/api/me/notifications',
    authed((user, request) => {
      const url = new URL(request.url)
      const unread = url.searchParams.get('unread') === '1'
      const raw = url.searchParams.get('limit')
      // 백엔드는 1 이상 200 이하만 받는다(`Query(50, ge=1, le=200)`). 숫자가 아니면 422.
      const limit = raw === null ? 50 : Number(raw)
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return validationError('limit 은 1 이상 200 이하의 정수여야 합니다.')
      }
      return HttpResponse.json({ items: listNotifications(user, { unread, limit }) })
    }),
  ),

  http.post('/api/me/notifications/read', async ({ request }) => {
    if (!authenticate()) return unauthorized()

    const body = await readJson<{ ids?: unknown }>(request)
    // 백엔드는 `ids` 를 1개 이상 200개 이하로 받는다(`ReadIn`).
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 200) {
      return validationError('읽음 처리할 알림 id 를 1개 이상 200개 이하로 보내 주세요.')
    }
    markNotificationsRead(body.ids.map(String))
    return new HttpResponse(null, { status: 204 })
  }),

  // 알림 지우기(백엔드 #276). 읽음 처리와 같은 모양이다: `ids` 1개 이상 200개 이하, 204,
  // 남의 것이나 없는 id 는 조용히 건너뛴다.
  http.post('/api/me/notifications/delete', async ({ request }) => {
    if (!authenticate()) return unauthorized()

    const body = await readJson<{ ids?: unknown }>(request)
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 200) {
      return validationError('지울 알림 id 를 1개 이상 200개 이하로 보내 주세요.')
    }
    removeNotifications(body.ids.map(String))
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(
    '/api/me/todos',
    authed(() => HttpResponse.json({ items: listTasks() })),
  ),

  http.post('/api/me/todos', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const body = await readJson<{ text?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    if (
      typeof body.text !== 'string' ||
      !body.text.trim() ||
      body.text.trim().length > TODO_TEXT_MAX
    ) {
      return validationError(`할 일은 1자 이상 ${TODO_TEXT_MAX}자 이하여야 합니다.`)
    }
    return HttpResponse.json(addTask(body.text.trim()), { status: 201 })
  }),

  // ── 전자결재 (13 §9) ──────────────────────────────────────
  http.get(
    '/api/approval-types',
    authed(() => HttpResponse.json({ items: APPROVAL_TYPES })),
  ),
  http.get(
    '/api/approvals',
    authed((user, request) => {
      const box = new URL(request.url).searchParams.get('box') ?? 'inbox'
      if (!['inbox', 'sent', 'reference', 'draft'].includes(box)) {
        return HttpResponse.json(
          { detail: 'box 가 올바르지 않습니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json({ items: listApprovals(user, box as 'inbox'), next_cursor: null })
    }),
  ),
  // ── 결재 위임 (13 §9.3, §4.2.3) ───────────────────────────
  // `/api/approvals/:id` 보다 **먼저** 등록해야 한다. 목은 먼저 걸린 핸들러가 이기므로
  // 뒤에 두면 `delegations` 가 문서 id 로 잡혀 404 가 된다.
  http.get(
    '/api/approvals/delegations',
    authed((user) => HttpResponse.json({ items: listDelegations(user) })),
  ),

  http.post('/api/approvals/delegations', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<Parameters<typeof createDelegation>[1]>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    const made = createDelegation(user, body)
    if ('error' in made) {
      return HttpResponse.json({ detail: made.error, code: made.code }, { status: made.status })
    }
    return HttpResponse.json(made, { status: 201 })
  }),

  http.delete('/api/approvals/delegations/:id', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const failure = deleteDelegation(user, String(params.id))
    if (failure) {
      return HttpResponse.json(
        { detail: failure.error, code: failure.code },
        { status: failure.status },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/approvals/drafts', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const result = createDraft(user, (await request.json()) as Parameters<typeof createDraft>[1])
    await delay(300)
    return approvalResponse(result, 201)
  }),
  http.patch('/api/approvals/drafts/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof updateDraft>[2]
    await delay(300)
    return approvalResponse(updateDraft(user, String(params.id), input))
  }),
  // 임시저장 지우기(백엔드 #316): 내 임시저장만 204, 남의 것이나 없는 것은 404, 상신한 문서는
  // 409 `NOT_DRAFT`.
  http.delete('/api/approvals/drafts/:id', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const failure = deleteDraft(user, String(params.id))
    if (failure) return approvalResponse(failure)
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(
    '/api/approvals/:id',
    authed((user, request) => {
      const id = new URL(request.url).pathname.split('/').pop() ?? ''
      return approvalResponse(getApproval(user, id))
    }),
  ),
  http.post('/api/approvals/:id/submit', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(400)
    return approvalResponse(submitApproval(user, String(params.id)))
  }),
  http.post('/api/approvals/:id/cancel', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    return approvalResponse(cancelApproval(user, String(params.id)))
  }),
  http.post('/api/approvals/:id/approve', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { version, comment } = (await request.json()) as { version: number; comment?: string }
    await delay(400)
    return approvalResponse(decide(user, String(params.id), 'approve', version, comment))
  }),
  http.post('/api/approvals/:id/reject', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const { version, reason } = (await request.json()) as { version: number; reason?: string }
    await delay(400)
    return approvalResponse(decide(user, String(params.id), 'reject', version, reason))
  }),

  // 결재 첨부(13 FR-APV-05). 계약에 없어 채팅 첨부 모양을 따랐다(PR 본문). 오브젝트는 문서
  // 이미지와 같은 목 저장소(IndexedDB)에 두고, 판정은 문서 경로로 한다.
  http.post('/api/approvals/:id/attachments', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const id = String(params.id)
    const denied = checkAttachTarget(user, id)
    if (denied) return approvalResponse(denied)
    const file = (await request.formData()).get('file')
    // 백엔드 채팅 첨부처럼 초과·빈 파일은 422 다. 형식은 가리지 않는다(영수증은 pdf 도 사진도 있다).
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return validationError('비어 있지 않은 10MB 이하 파일만 올릴 수 있습니다.')
    }
    const stored = await saveFile(file, 'a')
    recordAttachment(id, stored.id)
    return HttpResponse.json(
      {
        url: `${attachmentPrefix(id)}${stored.id}/${encodeURIComponent(stored.name)}`,
        name: stored.name,
        size: stored.size,
        content_type: stored.type || null,
      },
      { status: 201 },
    )
  }),
  http.get('/api/approvals/:id/attachments/:fileId/:name', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const denied = checkAttachmentDownload(user, String(params.id), new URL(request.url).pathname)
    if (denied) return approvalResponse(denied)
    const stored = await readFile(String(params.fileId))
    if (!stored) return notFound('파일을 찾을 수 없습니다.')
    // 실행될 수 있는 형식(html·svg)이 같은 오리진에서 열리지 않게 늘 내려받기로 준다.
    return new HttpResponse(stored.blob, {
      headers: {
        'Content-Type': stored.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(stored.name)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),

  // 강제 종결(13 §9.2). 임원만. `version` 을 안 받는다: 어느 단계에 걸려 있든 끝내는 동작이라
  // 단계 잠금을 볼 이유가 없다(승인·반려와 다른 점이다).
  http.post('/api/approvals/:id/force-close', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const payload = await readJson<{ reason?: unknown }>(request)
    const reason = typeof payload?.reason === 'string' ? payload.reason : ''
    await delay(400)
    return approvalResponse(forceClose(user, String(params.id), reason))
  }),

  // ── 근태 · 내 근태 (04 §10.1) ─────────────────────────────
  // 기간 집계(04 §10.1). `/api/attendance/me` 보다 먼저 등록할 필요는 없다(세그먼트 수가 다르다).
  http.get(
    '/api/attendance/me/summary',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      const from = params.get('from') ?? ''
      const to = params.get('to') ?? ''
      if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
        return validationError('from·to 는 YYYY-MM-DD 입니다.')
      }
      if (from > to) return validationError('from 이 to 보다 뒤입니다.')
      const span = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1
      if (span > RANGE_MAX_DAYS) {
        return validationError(`기간은 ${RANGE_MAX_DAYS}일까지 볼 수 있습니다.`)
      }
      return HttpResponse.json(attendanceRange(user, from, to))
    }),
  ),

  http.get(
    '/api/attendance/me',
    authed((user, request) => {
      const month = new URL(request.url).searchParams.get('month') ?? ''
      if (!MONTH.test(month)) {
        return HttpResponse.json(
          { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json(attendanceMonth(user, month))
    }),
  ),

  // 04 §10.5 의 팀 그리드를 `team_id` 없이 부르면 전사. 팀장이 없는 조직이라 팀 단위는 안 쓴다. 임원 외 403(10 §3).
  http.get(
    '/api/attendance/team',
    authed((user, request) => {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '전사 근태는 임원만 볼 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      const month = new URL(request.url).searchParams.get('month') ?? ''
      if (!MONTH.test(month)) {
        return HttpResponse.json(
          { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json(companyAttendance(month))
    }),
  ),

  // ── 관리자 · 팀 (04 §9, 임원) ──────────────────
  // 계정의 소속을 고르는 자리가 쓴다. 다른 목록과 달리 `{items}` 가 아니라 배열 그대로다.
  http.get(
    '/api/admin/teams',
    authed((user) => (user.role === 'exec' ? HttpResponse.json(MOCK_TEAM_LIST) : forbidden())),
  ),

  http.post('/api/admin/teams', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') return forbidden()
    await delay(300)
    const name = teamName(await readJson<{ name?: unknown }>(request))
    if (!name) return validationError('팀 이름을 입력하세요.')
    if (MOCK_TEAM_LIST.some((team) => team.name === name)) return teamConflict()
    const created = createTeam(name)
    recordAudit({
      kind: 'admin.team_created',
      actor_id: user.id,
      target_id: created.id,
      ip: '127.0.0.1',
      user_agent: navigator.userAgent,
      detail: { name },
    })
    return HttpResponse.json(created, { status: 201 })
  }),

  http.patch('/api/admin/teams/:teamId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') return forbidden()
    const team = MOCK_TEAM_LIST.find((t) => t.id === params.teamId)
    if (!team) return notFound('없는 팀입니다.')
    await delay(300)
    const name = teamName(await readJson<{ name?: unknown }>(request))
    if (!name) return validationError('팀 이름을 입력하세요.')
    // 서버처럼 같은 이름은 감사 줄 없이 그대로 돌려준다.
    if (name === team.name) return HttpResponse.json(team)
    if (MOCK_TEAM_LIST.some((t) => t.name === name)) return teamConflict()
    const before = team.name
    renameTeam(team, name)
    recordAudit({
      kind: 'admin.team_updated',
      actor_id: user.id,
      target_id: team.id,
      ip: '127.0.0.1',
      user_agent: navigator.userAgent,
      detail: { before, after: name },
    })
    return HttpResponse.json(team)
  }),

  // ── 관리자 · 계정 (04 §9, 임원) ──────────────────
  http.get(
    '/api/admin/users',
    authed((user) => (user.role === 'exec' ? HttpResponse.json(listAccounts()) : forbidden())),
  ),

  http.post('/api/admin/users', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') return forbidden()

    await delay(300)
    const body = await readJson<UserCreate>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    if (!name) return validationError('이름을 입력하세요.')
    if (!EMAIL_PATTERN.test(email)) return validationError('이메일 형식이 아닙니다.')
    if (String(body.password ?? '').length < PASSWORD_MIN) {
      return validationError(`비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`)
    }
    if (unknownTeam(body.team_id)) return validationError('없는 팀입니다.')
    if (emailTaken(email)) {
      return HttpResponse.json(
        { detail: '이미 있는 이메일입니다.', code: 'CONFLICT' },
        { status: 409 },
      )
    }
    const created = createAccount({ ...body, name, email })
    recordAudit({
      kind: 'admin.user_created',
      actor_id: user.id,
      target_id: created.id,
      ip: '127.0.0.1',
      user_agent: navigator.userAgent,
      detail: { email, role: created.role },
    })
    return HttpResponse.json(created, { status: 201 })
  }),

  http.patch('/api/admin/users/:userId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') return forbidden()

    const target = findAccount(String(params.userId))
    if (!target) return notFound('없는 계정입니다.')

    await delay(300)
    const patch = await readJson<UserPatch>(request)
    if (!patch) return validationError('본문이 올바르지 않습니다.')
    // 값이 같아도 칸이 왔으면 막는다. 백엔드가 `exclude_unset` 으로 가르는 것과 같다.
    if (target.id === user.id && ('role' in patch || 'active' in patch)) {
      return HttpResponse.json(
        { detail: '자기 자신의 등급·활성 상태는 바꿀 수 없습니다.', code: 'ADMIN_SELF' },
        { status: 400 },
      )
    }
    if (patch.name !== undefined && !patch.name.trim()) {
      return validationError('이름을 입력하세요.')
    }
    if (patch.password !== undefined && patch.password.length < PASSWORD_MIN) {
      return validationError(`비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`)
    }
    if (unknownTeam(patch.team_id)) return validationError('없는 팀입니다.')
    const before = { role: target.role, active: target.active }
    const updated = patchAccount(target, patch)
    recordAudit({
      kind: 'admin.user_updated',
      actor_id: user.id,
      target_id: updated.id,
      ip: '127.0.0.1',
      user_agent: navigator.userAgent,
      detail: {
        fields: Object.keys(patch).sort(),
        before,
        after: { role: updated.role, active: updated.active },
      },
    })
    return HttpResponse.json(updated)
  }),

  http.get(
    '/api/admin/audit',
    authed((user, request) => {
      if (user.role !== 'exec') return forbidden()

      const params = new URL(request.url).searchParams
      const cursor = params.get('cursor')
      if (cursor && badCursor(cursor)) return validationError('cursor 형식이 잘못됐습니다.')

      const limit = Number(params.get('limit') ?? 50)
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return validationError('limit 는 1 이상 200 이하입니다.')
      }
      return HttpResponse.json(listAudit(params.get('kind'), cursor, limit))
    }),
  ),

  // ── 근태 · 공휴일·회사 휴일 (10 §9.6, 임원) ─────────────
  // `?year=` 와 DELETE 는 프론트 확장(PR 본문). 바꾸면 근무 달력이 바로 따라온다(§6.2).
  http.get(
    '/api/admin/holidays',
    authed((user, request) => {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '휴일 설정은 임원만 볼 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      const year = Number(new URL(request.url).searchParams.get('year'))
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return HttpResponse.json(
          { detail: 'year 는 네 자리 연도입니다.', code: 'VALIDATION' },
          { status: 422 },
        )
      }
      return HttpResponse.json({ items: listHolidays(year) })
    }),
  ),
  // 근무 달력 재생성(10 §6.2). 휴일을 넣고 빼면 서버가 알아서 하지만, 손으로 부를 길도 열어 둔다.
  http.post('/api/admin/attendance/calendar/rebuild', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '근무 달력은 임원만 다시 만들 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const body = await readJson<{ year?: unknown }>(request)
    const year = Number(body?.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return validationError('year 는 네 자리 연도입니다.')
    }
    // 전 직원 달력을 새로 까는 일이라 실제 서버에서도 짧지 않다.
    await delay(600)
    return HttpResponse.json({ year, workdays: workdaysInYear(year) })
  }),

  http.post('/api/admin/holidays', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '휴일 설정은 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const input = (await request.json()) as Parameters<typeof addHoliday>[0]
    await delay(300)
    const result = addHoliday(input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  // 휴일 이름 고치기(백엔드 #316). 회사 휴일의 이름만 바꾼다. 마감된 달에도 된다.
  http.patch('/api/admin/holidays/:date', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '휴일 설정은 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const body = await readJson<{ name?: unknown }>(request)
    await delay(300)
    const result = renameHoliday(String(params.date), body?.name)
    if (result === 'not_found') {
      return HttpResponse.json(
        { detail: '등록되지 않은 휴일입니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item)
  }),
  http.delete('/api/admin/holidays/:date', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '휴일 설정은 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    await delay(300)
    const result = removeHoliday(String(params.date))
    if (result === 'not_found') {
      return HttpResponse.json(
        { detail: '등록되지 않은 휴일입니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (result !== 'ok') {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // ── 근태 · 월 마감 (10 §9.5) ─────────────────────────────
  // 조회 경로는 프론트 확장(PR 본문). 마감 여부는 비밀이 아니라 전원 조회, 마감·해제만 임원(10 §3).
  http.get('/api/attendance/closings', ({ request }) => {
    if (!authenticate()) return unauthorized()
    const year = Number(new URL(request.url).searchParams.get('year'))
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return HttpResponse.json(
        { detail: 'year 는 네 자리 연도입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    return HttpResponse.json({ items: listClosings(year) })
  }),
  http.get('/api/attendance/closings/:month', ({ params }) => {
    if (!authenticate()) return unauthorized()
    const month = String(params.month)
    if (!MONTH.test(month)) {
      return HttpResponse.json(
        { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    return HttpResponse.json(getClosing(month))
  }),
  http.post('/api/attendance/close', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '월 마감은 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const { month } = (await request.json()) as { month?: string }
    if (!month || !MONTH.test(month)) {
      return HttpResponse.json(
        { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    await delay(400)
    const result = closeMonth(user, month)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item)
  }),
  http.post('/api/attendance/reopen', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (user.role !== 'exec') {
      return HttpResponse.json(
        { detail: '마감 해제는 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
    const { month, reason } = (await request.json()) as { month?: string; reason?: string }
    if (!month || !MONTH.test(month)) {
      return HttpResponse.json(
        { detail: 'month 는 YYYY-MM 형식입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    }
    await delay(400)
    const result = reopenMonth(user, month, reason ?? '')
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item)
  }),

  // ── 근태 · 예외 근무 (04 §10.3) ───────────────────────────
  http.get(
    '/api/attendance/arrangements',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      // `scope=all` 은 04 에 없는 확장(홈 캘린더). 휴가의 `scope=all` 과 같은 모양.
      if (params.get('scope') === 'all') {
        return HttpResponse.json({
          items: listArrangementsInRange(params.get('from') ?? '', params.get('to') ?? ''),
        })
      }
      return HttpResponse.json({ items: listArrangements(user) })
    }),
  ),
  http.post('/api/attendance/arrangements', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createArrangement>[1]
    await delay(400)
    const result = createArrangement(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  http.get(
    '/api/attendance/overtime',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      return HttpResponse.json(
        listOvertime(user, params.get('from') ?? '', params.get('to') ?? '9999'),
      )
    }),
  ),
  http.post('/api/attendance/overtime', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createOvertime>[1]
    await delay(400)
    const result = createOvertime(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  http.get(
    '/api/attendance/corrections',
    authed((user) => HttpResponse.json({ items: listCorrections(user) })),
  ),
  http.post('/api/attendance/corrections', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createCorrection>[1]
    await delay(400)
    const result = createCorrection(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.item, { status: 201 })
  }),
  // 승인 전 취소. 04 에 없는 경로(프론트 확장, PR 본문). 휴가 취소와 같은 규칙.
  http.post('/api/attendance/:store/:id/cancel', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const store = String(params.store)
    if (!['arrangements', 'overtime', 'corrections'].includes(store)) return passthrough()
    await delay(300)
    const result = cancelException(user, store as ExceptionStore, String(params.id))
    if (result === 'not_found') {
      return HttpResponse.json(
        { detail: '신청을 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (result === 'conflict') {
      return HttpResponse.json(
        { detail: '이미 처리된 신청은 취소할 수 없습니다.', code: 'REQUEST_DECIDED' },
        { status: 409 },
      )
    }
    return HttpResponse.json(result)
  }),

  // ── 근태 · 휴가 (04 §10.2) ────────────────────────────────
  // 목록 응답의 `{items}` 감싸기와 항목 모양은 백엔드(#316)와 같다.
  http.get(
    '/api/leave-types',
    authed(() => HttpResponse.json({ items: LEAVE_TYPES })),
  ),
  http.get(
    '/api/leaves/balance',
    authed((user) => HttpResponse.json(leaveBalance(user))),
  ),
  // 04 에 없는 확장(연차 관리 탭). 전사 잔여는 임원만(10 §3), 그 외 403.
  http.get(
    '/api/leaves/balances',
    authed((user) => {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '전사 연차 현황은 임원만 볼 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      return HttpResponse.json({ items: listBalances() })
    }),
  ),
  http.get(
    '/api/leaves',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      // `scope=all` 은 04 에 없는 확장(홈 캘린더). 백엔드 #316 이 이 모양으로 받았다.
      if (params.get('scope') === 'all') {
        const from = params.get('from') ?? ''
        const to = params.get('to') ?? ''
        return HttpResponse.json({ items: listLeavesInRange(user, from, to) })
      }
      return HttpResponse.json({ items: listLeaves(user) })
    }),
  ),

  http.post('/api/leaves', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createLeave>[1]
    await delay(400)
    const result = createLeave(user, input)
    if ('error' in result) {
      return HttpResponse.json(
        { detail: result.error, code: result.code },
        { status: result.status },
      )
    }
    return HttpResponse.json(result.leave, { status: 201 })
  }),

  http.post('/api/leaves/:leaveId/cancel', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const result = cancelLeave(user, String(params.leaveId))
    if (result === 'not_found') {
      return HttpResponse.json(
        { detail: '휴가 신청을 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    if (result === 'conflict') {
      return HttpResponse.json(
        { detail: '이미 처리된 신청은 취소할 수 없습니다.', code: 'REQUEST_DECIDED' },
        { status: 409 },
      )
    }
    return HttpResponse.json(result)
  }),

  // ── 내 일정 (04 에 없는 경로. 백엔드 #300 이 이 모양 그대로 넣었다) ──────
  http.get(
    '/api/me/events',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      return HttpResponse.json({
        items: listEvents(user, params.get('from') ?? '', params.get('to') ?? ''),
      })
    }),
  ),

  http.post('/api/me/events', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const input = (await request.json()) as Parameters<typeof createEvent>[1]
    await delay(250)
    const result = createEvent(user, input)
    if ('error' in result) {
      return HttpResponse.json({ detail: result.error, code: 'VALIDATION' }, { status: 422 })
    }
    return HttpResponse.json(result.event, { status: 201 })
  }),

  http.delete('/api/me/events/:eventId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    if (!deleteEvent(user, String(params.eventId))) {
      return HttpResponse.json(
        { detail: '일정을 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // ── AI 어시스턴트 (04 §8) ─────────────────────────────────
  http.get(
    '/api/ai/models',
    authed(() => HttpResponse.json(AI_MODELS)),
  ),

  // 질문 첨부(백엔드 #396). 실제 서버는 평문을 뽑아 7일 두고, 올린 사람만 쓰고 내려받는다.
  // 목은 새로 고치면 비워진다. 그 뒤 같은 첨부로 다시 물으면 7일 지난 것처럼 422 가 된다.
  http.post('/api/ai/attachments', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const file = (await request.formData()).get('file')
    if (!(file instanceof File)) return validationError('파일이 없습니다.')
    if (file.size > MAX_UPLOAD_BYTES) return validationError('10MB 이하 파일만 올릴 수 있습니다.')
    if (file.size === 0) return validationError('빈 파일입니다.')
    const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    if (!AI_ATTACH_EXTS.includes(ext))
      return validationError('지원하지 않는 파일 형식입니다(txt·md·csv·docx·xlsx·pdf·hwpx).')
    // ponytail: 글자 파일만 실제로 읽는다. 문서 형식은 본문을 뽑지 않고 크기로 글자 수를 흉내 낸다.
    const text = ['txt', 'md', 'csv'].includes(ext)
      ? (await file.text()).trim()
      : `${file.name} 의 본문(목). 실제 서버는 이 자리에 파일에서 뽑은 글을 넣습니다.`.repeat(
          Math.max(1, Math.round(file.size / 2000)),
        )
    if (!text) return validationError('읽을 글자가 없는 파일입니다.')
    const id = crypto.randomUUID()
    AI_ATTACHMENTS.set(id, { owner: user.id, name: file.name, blob: file, text })
    await delay(400)
    return HttpResponse.json(
      {
        id,
        name: file.name,
        size: file.size,
        content_type: file.type || 'application/octet-stream',
        chars: text.length,
      },
      { status: 201 },
    )
  }),

  http.get('/api/ai/attachments/:id', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const file = AI_ATTACHMENTS.get(String(params.id))
    if (!file || file.owner !== user.id) return notFound('없는 첨부입니다.')
    return new HttpResponse(file.blob, {
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  }),

  // SSE: status → token → citations → done. 실제 서버(routers/ai.py)와 같은 프레임 모양.
  http.post('/api/ai/chat', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const {
      message,
      session_id,
      scope,
      docs = [],
      attachments = [],
    } = (await request.json()) as {
      message?: string
      session_id?: string
      scope?: string | null
      docs?: string[]
      attachments?: string[]
    }
    if (!message?.trim()) {
      // 실제 서버(errors.py)의 422 detail 은 Pydantic 오류 배열이다. 문자열이 아니다.
      return HttpResponse.json(
        {
          detail: [
            {
              loc: ['body', 'message'],
              msg: 'String should have at least 1 character',
              type: 'string_too_short',
            },
          ],
          code: 'VALIDATION',
        },
        { status: 422 },
      )
    }
    const folder = scope?.startsWith('doc:') ? null : (scope ?? null)
    // 서버와 같은 순서: 폴더, 문서 개수, 첨부 개수, 문서, 첨부.
    // 범위는 폴더 id 다(백엔드 #372). 참고 문서와 같이 올 수 있다. 없는 폴더는 422 이고 이때 detail 은 문자열이다.
    // 실제 서버는 UUID 로 안 읽히는 값을 전체로 받지만, 목의 폴더 id(`f-1`)는 UUID 가 아니라 목록에 있는지로 가른다.
    if (folder && !docTree().folders.some((each) => each.id === folder)) {
      return HttpResponse.json({ detail: '없는 폴더입니다.', code: 'VALIDATION' }, { status: 422 })
    }
    // 참고 문서(백엔드 #394). `doc:<문서 id>` 범위(#380)는 그 문서 하나짜리 별칭이라 앞에 붙여 합친다(중복 제거).
    // 5개를 넘거나, 하나라도 없음·휴지통·근거 꺼짐이면 422 이고 detail 은 문자열이다.
    const refIds = [...new Set([...(scope?.startsWith('doc:') ? [scope.slice(4)] : []), ...docs])]
    if (refIds.length > 5)
      return HttpResponse.json(
        { detail: '참고 문서는 5개까지입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    const attachIds = [...new Set(attachments)]
    if (attachIds.length > 3) return validationError('첨부는 3개까지입니다.')
    const refDocs = refIds.map(aliveDoc)
    if (refDocs.some((doc) => !doc))
      return HttpResponse.json({ detail: '없는 문서입니다.', code: 'VALIDATION' }, { status: 422 })
    if (refDocs.some((doc) => !doc!.ai_source))
      return HttpResponse.json(
        { detail: 'AI 근거로 쓰기가 꺼진 문서입니다.', code: 'VALIDATION' },
        { status: 422 },
      )
    const files = attachIds.map((id) => AI_ATTACHMENTS.get(id))
    if (files.some((file) => !file || file.owner !== user.id))
      return validationError('없는 첨부입니다.')
    // ponytail: 참고 문서가 있으면 그 카드만 1번부터 낸다. 실제 서버는 규정·참고 문서·첨부 순으로 먼저
    // 번호를 매기고 폴더·전체 검색 카드를 뒤에 이어 붙인다. 목은 첨부 카드를 맨 뒤에 붙여 번호가 다르다.
    const answered =
      refDocs.length > 0 ? docAnswer(refDocs.map((doc) => doc!)) : answer(user, Boolean(folder))
    const attached = fileCitations(
      attachIds.map((id, i) => ({ id, ...files[i]! })),
      Math.max(0, ...answered.citations.map((c) => c.n)) + 1,
    )
    const body =
      answered.body +
      attached.map((c) => ` 첨부한 ${c.title} 의 내용도 참고했습니다[[${c.n}]].`).join('')
    const citations = [...answered.citations, ...attached]
    const frame = (event: string, data: unknown) => `event: ${event}
data: ${JSON.stringify(data)}

`
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        await delay(300)
        // 서버는 문서를 찾는 동안 답변보다 먼저 진행 상황을 보낸다(백엔드 #366).
        controller.enqueue(encoder.encode(frame('status', { text: '문서를 찾는 중' })))
        await delay(900)
        // 공급자 실패 경로(routers/ai.py LLMError). error 뒤에는 done 이 오지 않고 스트림이 끝난다.
        if (message.includes('오류')) {
          controller.enqueue(encoder.encode(frame('token', { text: '답변을 시작하다가 ' })))
          await delay(300)
          controller.enqueue(
            encoder.encode(
              frame('error', {
                detail: 'AI 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요.',
                code: 'AI_RATE_LIMITED',
              }),
            ),
          )
          controller.close()
          return
        }
        // 어절 단위로 흘려 보내 스트리밍 타이핑이 실제로 보이게 한다.
        for (const word of body.split(/(?<= )/)) {
          controller.enqueue(encoder.encode(frame('token', { text: word })))
          await delay(40)
        }
        controller.enqueue(encoder.encode(frame('citations', citations)))
        // 서버는 저장한 답변의 id 와 세션 id 를 돌려준다(백엔드 #364). 안 보낸 세션은 서버가 만든다.
        controller.enqueue(
          encoder.encode(
            frame('done', {
              message_id: crypto.randomUUID(),
              session_id: session_id ?? crypto.randomUUID(),
            }),
          ),
        )
        controller.close()
      },
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }),

  // 04 §8 feedback. 응답은 204(백엔드 #317).
  http.post('/api/ai/feedback', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { message_id, value } = (await request.json()) as {
      message_id?: unknown
      value?: unknown
    }
    const bad =
      typeof message_id !== 'string' || !message_id
        ? {
            loc: ['body', 'message_id'],
            msg: 'Input should be a valid string',
            type: 'string_type',
          }
        : value !== 1 && value !== -1
          ? { loc: ['body', 'value'], msg: 'Input should be 1 or -1', type: 'literal_error' }
          : null
    if (bad) return HttpResponse.json({ detail: [bad], code: 'VALIDATION' }, { status: 422 })
    await delay(300)
    return new HttpResponse(null, { status: 204 })
  }),

  // 04 §8 doc-action. 응답 `{draft}` 는 백엔드(#317)의 `DocActionOut` 과 같다.
  http.post('/api/ai/doc-action', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { doc_id, action } = (await request.json()) as { doc_id?: string; action?: string }
    // 실제 서버는 Pydantic 검증(422)이 핸들러(404)보다 먼저다.
    if (!(DOC_ACTIONS as readonly string[]).includes(action ?? '')) {
      return HttpResponse.json(
        {
          detail: [
            {
              loc: ['body', 'action'],
              msg: 'Input should be one of the allowed actions',
              type: 'enum',
            },
          ],
          code: 'VALIDATION',
        },
        { status: 422 },
      )
    }
    const doc = doc_id ? findDoc(doc_id) : undefined
    if (!doc) return notFound()
    const act = action as (typeof DOC_ACTIONS)[number]
    // 근거 동작만 스위치를 본다(백엔드 #385). 빈 본문·8,000자 초과 422 는 목이 본문을 몰라 재현하지 않는다.
    if ((act === 'cite' || act === 'conform') && !doc.ai_source)
      return validationError('AI 근거로 쓰기가 꺼진 문서입니다.')
    await delay(700)
    return HttpResponse.json({
      draft: docActionDraft(act, doc.title),
      citations: docActionCitations(act),
    })
  }),

  // 팩트체크(백엔드 #382). 문서 id 와 글 중 정확히 하나. 응답은 스트림이 아니라 한 번에 온다.
  http.post('/api/ai/check', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const { doc_id, text, web } = (await request.json()) as {
      doc_id?: string | null
      text?: string | null
      web?: boolean
    }
    // 둘 다·둘 다 없음은 라우터가 문자열로, 빈 글·길이 초과는 스키마 검증이라 배열로 거절한다.
    if (Boolean(doc_id) === (text != null)) {
      return validationError('doc_id 와 text 중 하나만 보냅니다.')
    }
    if (text != null && (!text.trim() || text.length > 50000)) {
      return HttpResponse.json(
        {
          detail: [
            {
              loc: ['body', 'text'],
              msg: 'String should have 1 to 50000 characters',
              type: 'string_too_long',
            },
          ],
          code: 'VALIDATION',
        },
        { status: 422 },
      )
    }
    // 문서 id 의 거절(없음·휴지통·근거 꺼짐)은 detail 이 문자열이다. 404 가 아니다.
    const doc = doc_id ? aliveDoc(doc_id) : undefined
    if (doc_id && !doc) return validationError('없는 문서입니다.')
    if (doc && !doc.ai_source) return validationError('AI 근거로 쓰기가 꺼진 문서입니다.')
    await delay(1200)
    // 모델 출력이 정해진 모양이 아니었을 때(실제 서버 routers/ai.py). 본문에 '오류'를 넣으면 본다.
    if (text?.includes('오류')) {
      return HttpResponse.json(
        {
          detail: 'AI 가 검사 결과를 정해진 모양으로 내지 않았습니다. 다시 시도해 주세요.',
          code: 'AI_FORMAT',
        },
        { status: 503 },
      )
    }
    // 본문(Y.Doc)은 브라우저에만 있어 문서 id 로 오면 제목만 안다.
    // 웹도 찾기(백엔드 #388). 목은 서버 배포 스위치가 켜진 것으로 본다. 꺼져 있으면 실제 서버는
    // 422 「웹 검색이 꺼져 있습니다.」. 본문에 '웹꺼짐'을 넣으면 그 거절을 본다.
    if (web && text?.includes('웹꺼짐')) return validationError('웹 검색이 꺼져 있습니다.')
    return HttpResponse.json(checkClaims(text ?? doc!.title, web))
  }),

  http.patch('/api/me/todos/:taskId', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()
    // 남의 것도 404 다(TC-AUTH-04). 목은 사용자를 나누지 않아 없는 것만 404 가 된다.
    const task = findTask(String(params.taskId))
    if (!task) return notFound('없는 할 일입니다.')

    const body = await readJson<{ text?: unknown; done?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    for (const key of ['text', 'done'] as const) {
      if (body[key] === null) return validationError(`${key} 는 null 일 수 없습니다.`)
    }
    if (body.text !== undefined) {
      if (
        typeof body.text !== 'string' ||
        !body.text.trim() ||
        body.text.trim().length > TODO_TEXT_MAX
      ) {
        return validationError(`할 일은 1자 이상 ${TODO_TEXT_MAX}자 이하여야 합니다.`)
      }
      task.text = body.text.trim()
    }
    if (body.done !== undefined) {
      // 백엔드는 불리언이 아니면 422 다. 조용히 무시하면 목에서만 200 이 된다.
      if (typeof body.done !== 'boolean') return validationError('done 은 불리언이어야 합니다.')
      task.done = body.done
    }
    return HttpResponse.json(task)
  }),

  http.delete('/api/me/todos/:taskId', ({ params }) => {
    if (!authenticate()) return unauthorized()
    return removeTask(String(params.taskId))
      ? new HttpResponse(null, { status: 204 })
      : notFound('없는 할 일입니다.')
  }),

  // ── 문서 트리·폴더 ────────────────────────────────────────
  http.get(
    '/api/tree',
    authed(() => HttpResponse.json(docTree())),
  ),

  http.post('/api/folders', async ({ request }) => {
    if (!authenticate()) return unauthorized()

    const body = await readJson<{ title?: unknown; parent_id?: unknown; sort?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
      return validationError('폴더 이름은 1자 이상 200자 이하여야 합니다.')
    }
    const parentId =
      body.parent_id === undefined || body.parent_id === null ? null : String(body.parent_id)
    // 없는 폴더는 404 가 아니라 422 다. 백엔드가 외래키 위반을 미리 잡아 422 로 돌려준다.
    if (parentId !== null && !findFolder(parentId)) return validationError('없는 폴더입니다.')

    return HttpResponse.json(
      createFolder({
        title: body.title.trim(),
        parent_id: parentId,
        sort: typeof body.sort === 'number' ? body.sort : 0,
      }),
      { status: 201 },
    )
  }),

  http.patch('/api/folders/:folderId', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()

    const folder = findFolder(String(params.folderId))
    if (!folder) return notFound()

    const body = await readJson<{ title?: unknown; parent_id?: unknown; sort?: unknown }>(request)
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    // null 은 "지움" 이 아니라 422 다. 문서·할 일 PATCH 와 같은 계약.
    for (const key of ['title', 'parent_id', 'sort'] as const) {
      if (body[key] === null && key !== 'parent_id') {
        return validationError(`${key} 는 null 일 수 없습니다.`)
      }
    }
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
        return validationError('폴더 이름은 1자 이상 200자 이하여야 합니다.')
      }
    }
    let parentId: string | null | undefined
    if (body.parent_id !== undefined) {
      parentId = body.parent_id === null ? null : String(body.parent_id)
      if (parentId !== null) {
        if (!findFolder(parentId)) return validationError('없는 폴더입니다.')
        // 자기 자신이나 자기 자손 아래로 옮기면 트리에서 통째로 사라진다.
        if (isDescendantFolder(parentId, folder.id)) {
          return validationError('폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.')
        }
      }
    }

    return HttpResponse.json(
      updateFolder(folder, {
        title: typeof body.title === 'string' ? body.title.trim() : undefined,
        parent_id: parentId,
        sort: typeof body.sort === 'number' ? body.sort : undefined,
      }),
    )
  }),

  // 폴더 지우기(백엔드 #298). 빈 폴더만 지운다. 하위 폴더나 문서가 있으면 409, 휴지통에 그 폴더의
  // 문서가 남아 있어도 409(되살릴 자리가 없어진다). 없는 폴더는 404, 성공은 204.
  http.delete('/api/folders/:folderId', ({ params }) => {
    if (!authenticate()) return unauthorized()

    const folder = findFolder(String(params.folderId))
    if (!folder) return notFound()

    const blocked = removeFolder(folder)
    if (blocked) {
      return HttpResponse.json(
        {
          detail:
            blocked === 'not_empty'
              ? '안에 문서나 폴더가 있는 폴더는 지울 수 없습니다.'
              : '휴지통에 이 폴더의 문서가 남아 있어 지울 수 없습니다. 되살려 옮기거나 영구 삭제한 뒤 지워 주세요.',
          code: 'FOLDER_NOT_EMPTY',
        },
        { status: 409 },
      )
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // ── 문서 ──────────────────────────────────────────────────
  http.post('/api/docs', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const body = await readJson<{ folder_id?: unknown; title?: unknown; ai_source?: unknown }>(
      request,
    )
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    // 백엔드 `DocCreateIn` 은 `folder_id` 와 `title` 을 둘 다 요구한다.
    if (typeof body.folder_id !== 'string' || !findFolder(body.folder_id)) {
      return validationError('folder_id 가 필요합니다.')
    }
    // 백엔드는 제목도 요구한다. 목이 기본값을 채워 주면 서버에서만 422 가 나는 자리가 생긴다.
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return validationError('제목이 필요합니다.')
    }
    const title = body.title.trim()
    if (title.length > 200) return validationError('제목은 200자를 넘을 수 없습니다.')

    // 안 보내면 켜짐이다. AI 답변을 문서로 저장할 때만 끈 채로 온다.
    if (body.ai_source !== undefined && typeof body.ai_source !== 'boolean') {
      return validationError('ai_source 는 불리언이어야 합니다.')
    }
    return HttpResponse.json(createDoc(user, body.folder_id, title, body.ai_source), {
      status: 201,
    })
  }),

  http.get('/api/docs/:docId', ({ params }) => {
    if (!authenticate()) return unauthorized()
    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()
    // 실제 서버는 보관 중인 Yjs 상태(`ydoc`)를 준다. 목에는 그게 없어 초안(`seedHtml`)으로 대신한다.
    return HttpResponse.json({ ...doc, ydoc: null, seedHtml: DOC_SEEDS[doc.id] })
  }),

  // 휴지통 목록(04 §3, 2026-09-17 백엔드 구현). 트리의 여집합이라 살아 있는 문서와 안 겹친다.
  http.get(
    '/api/trash',
    authed((_user, request) => {
      const raw = new URL(request.url).searchParams.get('limit')
      const limit = raw === null ? 200 : Number(raw)
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return validationError('limit 은 1 이상 500 이하의 정수여야 합니다.')
      }
      return HttpResponse.json({ items: listTrash(limit) })
    }),
  ),

  http.delete('/api/docs/:docId', ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()

    // 백엔드는 이 값을 불리언으로 읽는다. `1`·`true`·`yes`·`on` 이 참이고 그 밖은 422.
    const raw = new URL(request.url).searchParams.get('hard')
    if (raw !== null && !['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(raw)) {
      return validationError('hard 는 불리언이어야 합니다.')
    }
    // ?hard=1 은 영구 삭제. 임원만 할 수 있고 버전·댓글까지 같이 지운다.
    if (raw !== null && ['1', 'true', 'yes', 'on'].includes(raw)) {
      if (user.role !== 'exec') {
        return HttpResponse.json(
          { detail: '영구 삭제는 임원만 할 수 있습니다.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
      // 휴지통에 든 문서만 지운다(백엔드 #294). 그사이 누가 되돌린 문서는 그대로 둔다.
      if (!doc.deleted_at) {
        return HttpResponse.json(
          { detail: '휴지통에 있는 문서만 영구 삭제할 수 있습니다.', code: 'NOT_TRASHED' },
          { status: 409 },
        )
      }
      purgeDoc(doc.id)
      return new HttpResponse(null, { status: 204 })
    }

    trashDoc(doc, user)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('/api/docs/:docId/untrash', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const doc = findDoc(String(params.docId))
    if (!doc) return notFound()
    return HttpResponse.json(untrashDoc(doc, user))
  }),

  http.patch('/api/docs/:docId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<{ title?: unknown; folder_id?: unknown; ai_source?: unknown }>(
      request,
    )
    if (!body) return validationError('본문이 JSON 이 아닙니다.')
    for (const key of ['title', 'folder_id', 'ai_source'] as const) {
      if (body[key] === null) return validationError(`${key} 는 null 일 수 없습니다.`)
    }
    if (body.ai_source !== undefined && typeof body.ai_source !== 'boolean') {
      return validationError('ai_source 는 불리언이어야 합니다.')
    }
    if (!aliveDoc(String(params.docId))) return notFound()
    if (body.folder_id !== undefined && !findFolder(String(body.folder_id))) {
      return validationError('없는 폴더입니다.')
    }
    const doc = touchDoc(String(params.docId), user, {
      title: typeof body.title === 'string' ? body.title : undefined,
      folder_id: typeof body.folder_id === 'string' ? body.folder_id : undefined,
      ai_source: typeof body.ai_source === 'boolean' ? body.ai_source : undefined,
    })
    return doc ? HttpResponse.json(doc) : notFound()
  }),

  // 휴지통 문서의 버전 목록은 열어 둔다(되돌리기 전에 확인할 수 있어야 한다). 없는 문서는 404.
  http.get('/api/docs/:docId/versions', ({ params }) => {
    if (!authenticate()) return unauthorized()
    if (!findDoc(String(params.docId))) return notFound()
    return HttpResponse.json({ items: listVersions(String(params.docId)) })
  }),

  /** 버전 복구. 그 버전의 스냅샷만 돌려준다. 되돌리는 일은 클라이언트가 한다. */
  http.post('/api/docs/:docId/restore', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()

    const body = await readJson<{ version_id?: unknown }>(request)
    if (!body || typeof body.version_id !== 'string') {
      return validationError('version_id 가 필요합니다.')
    }
    // 휴지통에 든 문서는 되돌릴 수 없다(백엔드 `_get_doc` 기본값).
    if (!aliveDoc(String(params.docId))) return notFound()

    const version = findVersion(String(params.docId), body.version_id)
    if (!version) {
      return HttpResponse.json(
        { detail: '이 문서에 없는 버전입니다.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    return HttpResponse.json(version)
  }),

  http.post('/api/docs/:docId/versions', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    // 본문 검증이 먼저다. 백엔드는 FastAPI 가 핸들러에 들어가기 전에 스키마를 본다.
    const parsed = await readJson<{ snapshot?: unknown; label?: unknown }>(request)
    if (!parsed) return validationError('본문이 JSON 이 아닙니다.')
    const { snapshot, label } = parsed
    // 백엔드 `VersionCreateIn`: 스냅샷은 base64 이고 8MB 이하, 라벨은 1~200자.
    if (typeof snapshot !== 'string' || !snapshot.trim() || snapshot.length > 8_000_000) {
      return validationError('스냅샷이 없습니다.')
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(snapshot)) {
      return validationError('snapshot 은 base64 여야 합니다.')
    }
    if (label !== undefined && label !== null) {
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 200) {
        return validationError('라벨은 1자 이상 200자 이하여야 합니다.')
      }
    }
    if (!aliveDoc(String(params.docId))) return notFound()
    return HttpResponse.json(
      addVersion(
        String(params.docId),
        user,
        snapshot,
        typeof label === 'string' ? label : undefined,
      ),
      { status: 201 },
    )
  }),

  // ── 첨부 파일 ─────────────────────────────────────────────
  // 자료실(백엔드 `routers/archive.py`). 채팅과 문서에 붙은 파일을 올린 지
  // 최근 순으로 모아 준다. 보는 사람이 받을 수 있는 것만 싣는다.
  http.get('/api/archive', async ({ request }) => {
    if (!authenticate()) return unauthorized()
    const raw = new URL(request.url).searchParams.get('limit')
    const limit = raw === null ? ARCHIVE_LIMIT : Number(raw)
    if (!Number.isInteger(limit) || limit < 1 || limit > ARCHIVE_LIMIT) {
      return validationError(`limit 은 1 이상 ${ARCHIVE_LIMIT} 이하의 정수여야 합니다.`)
    }
    // 목 저장소(IndexedDB)가 안 열려도 채팅 파일은 나와야 한다.
    const [chat, stored] = await Promise.all([chatArchive(), listFiles().catch(() => [])])
    // 살아 있는 문서의 파일만 싣는다. 휴지통에 든 문서의 파일은 뺀다.
    const docs = docFiles(stored, (docId) => aliveDoc(docId)?.title)
    return HttpResponse.json({ items: newestFirst([...chat, ...docs], limit) })
  }),

  http.post('/api/files', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()

    const form = await request.formData()
    const file = form.get('file')
    // 어느 문서에서 올렸는지. 자료실의 출처가 된다. 거절하는 경우와 문구는 백엔드 `files.py` 와 같다.
    const docId = form.get('doc_id')
    if (!(file instanceof File)) return validationError('파일이 없습니다.')
    if (typeof docId === 'string' && !aliveDoc(docId)) return validationError('없는 문서입니다.')
    // 형식은 가리지 않는다. 문서 파일 칩이 아무 파일이나 올린다.
    if (file.size > MAX_UPLOAD_BYTES) return validationError('10MB 이하 파일만 올릴 수 있습니다.')
    if (file.size === 0) return validationError('빈 파일입니다.')

    const stored = await saveFile(file, 'f', {
      doc_id: typeof docId === 'string' ? docId : null,
      uploaded_by: { id: user.id, name: user.name },
      created_at: new Date().toISOString(),
    })
    return HttpResponse.json(
      {
        id: stored.id,
        url: `/api/files/${stored.id}`,
        name: stored.name,
        size: stored.size,
        content_type: mockContentType(stored.name),
      },
      { status: 201 },
    )
  }),

  // <img src> 요청에는 Authorization 헤더가 붙지 않는다. 실제 서버는 서명 URL이나
  // 세션 쿠키로 막을 자리고, 목은 인증을 보지 않는다.
  http.get('/api/files/:fileId', async ({ params }) => {
    // 결재 첨부는 문서 경로로만 내준다. 여기서 주면 열람 판정 없이 받아진다.
    if (String(params.fileId).startsWith('a-')) return notFound('파일을 찾을 수 없습니다.')
    const stored = await readFile(String(params.fileId))
    if (!stored) return notFound('파일을 찾을 수 없습니다.')
    return new HttpResponse(stored.blob, {
      headers: {
        'Content-Type': mockContentType(stored.name),
        'Content-Length': String(stored.size),
        // 채팅 첨부와 같은 규칙: 그림 넷만 화면에 그리고 나머지는 내려받기로만 준다.
        'Content-Disposition': isImage(stored.name)
          ? 'inline'
          : `attachment; filename*=UTF-8''${encodeURIComponent(stored.name)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),

  http.get('/api/docs/:docId/comments', ({ params }) => {
    if (!authenticate()) return unauthorized()
    return HttpResponse.json({ items: listComments(String(params.docId)) })
  }),

  http.post('/api/docs/:docId/comments', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const payload = await readJson<{ body?: unknown; block_id?: unknown }>(request)
    const body = typeof payload?.body === 'string' ? payload.body.trim() : ''
    if (!body) return validationError('내용을 입력하세요.')
    // 백엔드는 공백을 턴 뒤에 길이를 본다(`LongText`). 목도 같은 기준이어야 한 글자 차이로 갈리지 않는다.
    if (body.length > COMMENT_BODY_MAX) {
      return validationError(`댓글은 ${COMMENT_BODY_MAX}자까지 쓸 수 있습니다.`)
    }
    // 블록 id 도 공백을 털고 길이를 본다(백엔드 `BlockId`: 1~100자). 빈 값은 문서 전체 댓글이다.
    const rawBlockId = typeof payload?.block_id === 'string' ? payload.block_id.trim() : ''
    if (rawBlockId.length > BLOCK_ID_MAX) {
      return validationError(`블록 id 는 ${BLOCK_ID_MAX}자까지입니다.`)
    }
    const blockId = rawBlockId || null
    if (!aliveDoc(String(params.docId))) return notFound()
    return HttpResponse.json(addComment(String(params.docId), user, body, blockId), {
      status: 201,
    })
  }),

  // 댓글 고치기(백엔드 #296). `{body}` 를 받아 고친 뒤의 `CommentOut` 을 돌려준다. 쓴 사람이 아니면
  // 403, 없는 댓글과 휴지통 문서는 404, 글 규칙은 등록과 같다.
  http.patch('/api/docs/:docId/comments/:commentId', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const docId = String(params.docId)
    if (!aliveDoc(docId)) return notFound()

    const body = await readJson<{ body?: unknown }>(request)
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text || text.length > 10_000) {
      return validationError('댓글은 1자 이상 10000자 이하여야 합니다.')
    }
    const result = editComment(docId, user, String(params.commentId), text)
    if (result === 'not_found') return notFound('댓글을 찾을 수 없습니다.')
    if (result === 'forbidden') return forbidden()
    return HttpResponse.json(result)
  }),

  // 댓글 지우기(백엔드 #273). 쓴 사람만 204, 남의 것은 403, 없는 댓글과 휴지통 문서는 404.
  // 서버는 그 댓글에서 나간 멘션 알림도 같이 지운다. 목은 댓글이 알림을 만들지 않아 지울 것이 없다.
  http.delete('/api/docs/:docId/comments/:commentId', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const docId = String(params.docId)
    if (!aliveDoc(docId)) return notFound()
    const result = removeComment(docId, user, String(params.commentId))
    if (result === 'not_found') return notFound('댓글을 찾을 수 없습니다.')
    if (result === 'forbidden') return forbidden()
    return new HttpResponse(null, { status: 204 })
  }),

  // ── CRM 주소록 (15 CRM 모듈 설계서 §9) ─────────────────────
  // 백엔드 #311·#318 이 이 모양으로 받았다(설계서 §9 를 넓힌 것).
  http.get(
    '/api/crm/orgs',
    authed((_, request) => {
      const params = new URL(request.url).searchParams
      const stale = Number(params.get('stale_days'))
      return HttpResponse.json({
        items: listOrgs({
          q: params.get('q') ?? '',
          type: params.get('type') ?? '',
          owner: params.get('owner') ?? '',
          staleDays: stale > 0 ? stale : undefined,
        }),
        next_cursor: null,
      })
    }),
  ),
  http.post('/api/crm/orgs', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<OrgInput>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(createOrg(user, body), 201)
  }),
  // 15 FR-CRM-05. `dry_run=true` 면 판정만 돌려준다. 반영할 때만 감사 기록을 남긴다(§8.1 대량 반입).
  http.post('/api/crm/orgs/import', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const file = (await request.formData().catch(() => null))?.get('file')
    if (!(file instanceof File)) return validationError('CSV 파일을 올려 주세요.')
    if (file.size > IMPORT_MAX_BYTES)
      return validationError(`파일은 ${IMPORT_MAX_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다.`)
    const dryRun = new URL(request.url).searchParams.get('dry_run') === 'true'
    const rows = parseCsv(decodeText(new Uint8Array(await file.arrayBuffer())))
    await delay(300)
    if (!rows)
      return validationError('따옴표 짝이 맞지 않습니다. 엑셀에서 CSV 로 다시 저장해 주세요.')
    const result = importContacts(user, rows, dryRun)
    if (!dryRun && !('error' in result)) {
      crmAudit('crm.imported', user, null, {
        orgs: result.new_orgs,
        contacts: result.new_contacts,
      })
    }
    return approvalResponse(result)
  }),
  // 가져오기 되돌리기. 15 §9 에 없는 경로다(프론트가 정한 가정). 가져온 사람만, 가져온 지 하루
  // 안에. 내가 한 마지막 가져오기만 보이고, 되돌리면 그때 만든 기관·담당자 중 아직 쓰이지 않은
  // 것을 지운다.
  http.get(
    '/api/crm/imports/last',
    authed((user) => HttpResponse.json({ import: lastImport(user) })),
  ),
  http.post('/api/crm/imports/:id/undo', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const result = undoImport(user, String(params.id))
    if (!('error' in result)) crmAudit('crm.import_undone', user, null, { ...result })
    return approvalResponse(result)
  }),
  // 지운 기관 목록과 되살리기. 15 §9 에 없는 경로다(프론트가 정한 가정). 임원만.
  // `/orgs/:id` 보다 앞에 둔다. 뒤에 두면 `deleted` 가 기관 id 로 읽힌다.
  http.get('/api/crm/orgs/deleted', () => {
    const user = authenticate()
    if (!user) return unauthorized()
    const result = listDeletedOrgs(user)
    return approvalResponse('error' in result ? result : { items: result })
  }),
  http.post('/api/crm/orgs/:id/restore', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const id = String(params.id)
    const result = restoreOrg(user, id)
    if (!('error' in result)) crmAudit('crm.org_restored', user, id, { name: result.name })
    return approvalResponse(result)
  }),
  http.get('/api/crm/orgs/:id', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    return approvalResponse(getOrg(user, String(params.id)))
  }),
  http.patch('/api/crm/orgs/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<Partial<OrgInput>>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(updateOrg(user, String(params.id), body))
  }),
  http.delete('/api/crm/orgs/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<{ reason?: unknown }>(request)
    await delay(300)
    const id = String(params.id)
    // 지운 뒤에는 목록에서 빠지니, 감사 화면에서 알아보게 이름을 먼저 잡아 둔다.
    const before = getOrg(user, id)
    const failure = deleteOrg(user, id, body?.reason)
    if (failure) return approvalResponse(failure)
    // 삭제 창이 「사유는 감사 기록에 남습니다」라고 약속한다(15 NFR-CRM-03).
    crmAudit('crm.org_deleted', user, id, {
      name: 'name' in before ? before.name : '',
      reason: String(body?.reason).trim(),
    })
    return new HttpResponse(null, { status: 204 })
  }),
  http.post('/api/crm/contacts', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<ContactInput>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(createContact(user, body), 201)
  }),
  http.patch('/api/crm/contacts/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<Partial<ContactInput>>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(updateContact(user, String(params.id), body))
  }),
  // 담당자 지우기. 15 §9 에 없는 경로다(프론트가 정한 가정). 등록한 사람(활동 기록에 붙기 전)과
  // 임원. 목록에서만 빠진다. 감사 기록에 이름은 남기지 않는다(개인정보 삭제와 같은 이유).
  http.delete('/api/crm/contacts/:id', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const id = String(params.id)
    const failure = deleteContact(user, id)
    if (failure) return approvalResponse(failure)
    crmAudit('crm.contact_deleted', user, id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.post('/api/crm/contacts/:id/erase', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const id = String(params.id)
    const result = eraseContact(user, id)
    // 지운 사람의 이름은 남기지 않는다. 남기면 개인정보 삭제가 아니다.
    if (!('error' in result)) crmAudit('crm.contact_erased', user, id)
    return approvalResponse(result)
  }),
  http.get(
    '/api/crm/activities',
    authed((user, request) => {
      const params = new URL(request.url).searchParams
      const orgId = params.get('org_id')
      const dealId = params.get('deal_id')
      if (!orgId && !dealId) return validationError('org_id 나 deal_id 가 필요합니다.')
      const result = listActivities(user, orgId ? { orgId } : { dealId: dealId! })
      return 'error' in result
        ? approvalResponse(result)
        : HttpResponse.json({ items: result, next_cursor: null })
    }),
  ),
  http.post('/api/crm/activities', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<ActivityInput>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(createActivity(user, body), 201)
  }),
  http.patch('/api/crm/activities/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<Partial<ActivityInput>>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(updateActivity(user, String(params.id), body))
  }),
  http.delete('/api/crm/activities/:id', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const id = String(params.id)
    const failure = deleteActivity(user, id)
    if (failure) return approvalResponse(failure)
    crmAudit('crm.activity_deleted', user, id) // 15 FR-CRM-22
    return new HttpResponse(null, { status: 204 })
  }),

  // 주소록 전체가 한 번에 나가는 길이다. 누가 무엇을 몇 행 뽑았는지 남긴다(15 §8.1, TC-CRM-SEC-04).
  // POST 다(설계서 §9 는 GET). 감사 기록을 남기는 요청이라 CSRF 검사를 받게 한다.
  http.post(
    '/api/crm/export',
    authed((user, request) => {
      const entity = new URL(request.url).searchParams.get('entity') ?? ''
      const table = exportRows(entity)
      if ('error' in table) return approvalResponse(table)
      crmAudit('crm.exported', user, null, { entity, rows: table.rows.length - 1 })
      const { sheet, rows, integerCols } = table
      return new HttpResponse(buildXlsx(rows, { sheet, integerCols, freezeCols: 1 }), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      })
    }),
  ),

  // ── CRM 안건 파이프라인 (15 §9) ─────────────────────────────
  http.get(
    '/api/crm/deals',
    authed((_, request) => {
      const params = new URL(request.url).searchParams
      return HttpResponse.json({
        items: listDeals({
          kind: params.get('kind') ?? '',
          status: params.get('status') ?? '',
          orgId: params.get('org_id') ?? '',
        }),
        next_cursor: null,
      })
    }),
  ),
  http.post('/api/crm/deals', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<DealInput>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(createDeal(user, body), 201)
  }),
  http.get('/api/crm/deals/:id', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    return approvalResponse(getDeal(user, String(params.id)))
  }),
  // 안건 지우기. 15 §9 에 없는 경로다(프론트가 정한 가정). 등록한 사람(활동 기록이 붙기 전)과
  // 임원. 보드·목록에서만 빠지고 활동 기록은 기관의 타임라인에 남는다.
  http.delete('/api/crm/deals/:id', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const id = String(params.id)
    // 지운 뒤에는 찾을 수 없으니, 감사 화면에서 알아보게 이름을 먼저 잡아 둔다.
    const before = getDeal(user, id)
    const failure = deleteDeal(user, id)
    if (failure) return approvalResponse(failure)
    crmAudit('crm.deal_deleted', user, id, { name: 'name' in before ? before.name : '' })
    return new HttpResponse(null, { status: 204 })
  }),
  http.patch('/api/crm/deals/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<Parameters<typeof updateDeal>[2]>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(updateDeal(user, String(params.id), body))
  }),
  http.post('/api/crm/deals/:id/drop', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = (await readJson<{ reason?: unknown; version?: unknown }>(request)) ?? {}
    await delay(300)
    return approvalResponse(dropDeal(user, String(params.id), body))
  }),
  http.post('/api/crm/deals/:id/reopen', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = (await readJson<{ version?: unknown }>(request)) ?? {}
    await delay(300)
    return approvalResponse(reopenDeal(user, String(params.id), body))
  }),

  // ── 협업 공간: 프로젝트 칸반보드 ────────────────────────────
  // 04 에 아직 없다. 프론트가 먼저 만든 모양이고 백엔드가 그대로 따라 만들었다(#362).
  http.get(
    '/api/projects',
    authed((user) => HttpResponse.json({ items: listProjects(user) })),
  ),
  http.post('/api/projects', async ({ request }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<ProjectInput>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(createProject(user, body), 201)
  }),
  http.get('/api/projects/:id', ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    return approvalResponse(getProject(user, String(params.id)))
  }),
  http.patch('/api/projects/:id', async ({ request, params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    const body = await readJson<Partial<ProjectInput>>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(updateProject(user, String(params.id), body))
  }),
  http.delete('/api/projects/:id', async ({ params }) => {
    const user = authenticate()
    if (!user) return unauthorized()
    await delay(300)
    const result = deleteProject(user, String(params.id))
    return 'error' in result ? approvalResponse(result) : new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/projects/:id/tasks', ({ params }) => {
    if (!authenticate()) return unauthorized()
    const result = listProjectTasks(String(params.id))
    return 'error' in result ? approvalResponse(result) : HttpResponse.json({ items: result })
  }),
  http.post('/api/projects/:id/tasks', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()
    const body = await readJson<Partial<TaskInput>>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(createTask(String(params.id), body), 201)
  }),
  http.patch('/api/project-tasks/:id', async ({ request, params }) => {
    if (!authenticate()) return unauthorized()
    const body = await readJson<Partial<TaskInput>>(request)
    if (!body) return validationError('본문이 올바르지 않습니다.')
    await delay(300)
    return approvalResponse(updateTask(String(params.id), body))
  }),
  http.delete('/api/project-tasks/:id', async ({ params }) => {
    if (!authenticate()) return unauthorized()
    await delay(300)
    const result = deleteTask(String(params.id))
    return 'error' in result ? approvalResponse(result) : new HttpResponse(null, { status: 204 })
  }),
]
