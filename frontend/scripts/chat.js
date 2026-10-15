/**
 * 개발용 채팅 서버. dev-server.js가 /chat/* 요청과 업그레이드를 여기로 넘긴다.
 *
 * 채팅은 MSW로 만들 수 없다. MSW는 브라우저 안에서만 도는 목이라, A가 보낸
 * 메시지를 B의 MSW는 알지 못한다. 공유 상태를 들고 있는 프로세스가 필요하다.
 *
 * ── 백엔드가 구현해야 할 것 ────────────────────────────────────
 * 앱은 백엔드와 같은 경로(`/api/channels*`, `/api/ws`)로 호출한다. vite가 앞의 `/api` 를
 * `/chat` 으로 바꿔 여기로 넘길 뿐이므로, 백엔드에 붙일 때 앱 코드는 그대로다.
 *
 *   GET  /channels                    사용자별 목록 (안읽음·마지막 메시지 포함)
 *   GET  /channels/:id/messages       최근 메시지
 *   POST /channels/:id/members        비공개 채널에 사람 더하기
 *   DELETE /channels/:id/members/:uid 비공개 채널에서 사람 빼기·나가기
 *   DELETE /channels/:id              채널 지우기 (아래 `canDelete`)
 *   WS   /ws                          보내는 op: sub · msg · read · typing
 *                                     받는 ev: msg · unread · typing · error · channels
 *
 * 보내기·읽음은 REST 가 아니라 소켓 op 이다(04 §4.1). 실서버가 그렇게만 받으므로 릴레이도
 * 같게 맞춘다. 갈라 두면 목 모드에서 되는 것이 실서버에서 405 로 죽는다(이슈 #128).
 * presence · notice 는 실서버가 보내지만 릴레이는 보내지 않는다. 알림 목록은 MSW 가 들고
 * 있어 릴레이가 notice 를 보내도 다시 받은 목록이 그대로다. 실시간 알림은 실서버로 확인한다.
 *
 * 인증은 MSW 로그인이 심는 세션 쿠키(zenith.mock.session=<userId>)로만 한다. 실제 백엔드가
 * HttpOnly 쿠키의 JWT 에서 사용자를 꺼내는 것과 같은 자리다. URL·본문의 userId 는 보지 않는다
 * (11 §7.5). 채널 멤버가 아닌 사용자의 요청은 403이어야 한다.
 *
 * 메모리에만 보관한다. 서버를 끄면 대화가 사라진다.
 */

import users from '../src/mocks/users.json' with { type: 'json' }

/** 명단은 MSW 와 같은 users.json. u-1 진수연(사원) · u-2 정성운(사원) · u-3 홍성완(임원)이 시드 대화에 등장한다. */
const USERS = Object.fromEntries(users.map((u) => [u.id, { id: u.id, name: u.name }]))

/** 임원 id. 채널 지우기 권한에만 쓴다. `USERS` 에 등급을 넣으면 메시지의 `author` 로 새 나간다. */
const EXECS = new Set(users.filter((u) => u.role === 'exec').map((u) => u.id))

const ALL = Object.keys(USERS)

/** 아는 사용자 id 인가. `USERS[id]` 만 보면 `constructor` 같은 프로토타입 키도 참이 된다. */
const isUser = (id) => typeof id === 'string' && Object.hasOwn(USERS, id)

/** 없는 채널과 멤버가 아닌 채널을 가르지 않는다(백엔드 `_require_member`). 가르면 비공개 채널의 존재가 샌다. */
const FORBIDDEN = { detail: '권한이 부족합니다.', code: 'FORBIDDEN' }

/**
 * `memberIds` 는 릴레이 안에서만 쓴다. 밖으로는 `members`(이름까지)로 펼쳐 나간다.
 * `createdBy` 는 채널을 연 사람이다. 밖으로는 `created_by` 로 나간다(없으면 `null`).
 * @type {{id:string, is_dm:boolean, is_private?:boolean, name:string, memberIds:string[], createdBy?:string}[]}
 */
const CHANNELS = [
  { id: 'c-notice', is_dm: false, name: '공지', memberIds: ALL },
  { id: 'c-dev', is_dm: false, name: '개발', memberIds: ALL },
  { id: 'c-random', is_dm: false, name: '잡담', memberIds: ALL },
  // 비공개 채널. u-1 진수연과 u-3 홍성완만 본다. u-2 로 들어가면 목록에 없어야 한다.
  {
    id: 'c-hr',
    is_dm: false,
    is_private: true,
    name: '인사',
    memberIds: ['u-1', 'u-3'],
    createdBy: 'u-1',
  },
  { id: 'dm-u1-u2', is_dm: true, name: '', memberIds: ['u-1', 'u-2'] },
  // u-5 안재호는 MSW 근태 시드에서 오늘 재택이다. DM 행의 근무 상태 표시를 보여 주는 용도.
  { id: 'dm-u2-u5', is_dm: true, name: '', memberIds: ['u-2', 'u-5'] },
]

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()

let nextChannelId = 1

let nextId = 1
/** 백엔드 `MessageOut` 과 같은 모양(04 §5). 소켓의 `msg` 이벤트도 같은 것을 싣는다. */
function makeMessage(channelId, authorId, body, createdAt, files) {
  const author = USERS[authorId]
  // 모르는 id 로 만들면 `author: undefined` 가 그대로 실려 화면이 메시지를 그리다 죽는다.
  if (!author) throw new Error(`모르는 사용자: ${authorId}`)
  return {
    id: `m-${nextId++}`,
    channel_id: channelId,
    author,
    body,
    doc_ref: null,
    attachments: files?.length ? files : null,
    created_at: createdAt ?? new Date().toISOString(),
    // 고친 적이 없으면 null. 실서버 `MessageOut` 과 같은 칸이다(#284).
    edited_at: null,
  }
}

/** @type {Map<string, ReturnType<typeof makeMessage>[]>} */
const messages = new Map([
  [
    'c-notice',
    [makeMessage('c-notice', 'u-3', '워크숍 참석 여부 회신 부탁드립니다.', minutesAgo(175))],
  ],
  [
    'c-dev',
    [
      makeMessage('c-dev', 'u-2', '문서 모듈 어디까지 됐나요?', minutesAgo(95)),
      makeMessage(
        'c-dev',
        'u-1',
        '에디터랑 공동편집까지 붙였고 버전 기록 작업 중입니다.',
        minutesAgo(92),
      ),
      makeMessage(
        'c-dev',
        'u-2',
        '좋네요. 백엔드 붙기 전에 목으로 확인 가능한가요?',
        minutesAgo(90),
      ),
      makeMessage(
        'c-dev',
        'u-1',
        'Yjs 커서 동기화 이슈 재현됐습니다. 스크린샷 올릴게요',
        minutesAgo(4),
      ),
    ],
  ],
  ['c-random', []],
  [
    'dm-u1-u2',
    [makeMessage('dm-u1-u2', 'u-2', '내일 스탠드업 30분 당길 수 있을까요?', minutesAgo(38))],
  ],
  [
    'dm-u2-u5',
    [
      makeMessage(
        'dm-u2-u5',
        'u-5',
        '오늘 재택이라 펀드 보고서는 메일로 드릴게요.',
        minutesAgo(140),
      ),
    ],
  ],
])

/**
 * 올라온 첨부. 실제 서버는 MinIO 에 넣는다. 릴레이는 메모리라 다시 띄우면 사라진다.
 * 키는 백엔드와 같은 모양(`channels/{채널}/{파일}/{이름}`). 올린 사람을 같이 둔다(백엔드
 * `channel_uploads`, #327). 메시지에는 내가 올린 파일만 실을 수 있다.
 * @type {Map<string, {data: Buffer, contentType: string, uploaderId: string}>}
 */
const attachments = new Map()

/** FR-CHT-04 · 백엔드 `MAX_ATTACHMENT_BYTES` 와 같다. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** 브라우저가 인라인으로 그려도 스크립트가 돌지 않는 형식만. SVG·HTML 은 같은 오리진에서 XSS 다. */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** userId → channelId → 마지막으로 읽은 시각 */
const reads = new Map()

function lastReadAt(userId, channelId) {
  return reads.get(userId)?.get(channelId) ?? '1970-01-01T00:00:00.000Z'
}

function markRead(userId, channelId) {
  if (!reads.has(userId)) reads.set(userId, new Map())
  reads.get(userId).set(channelId, new Date().toISOString())
}

/** DM 이름은 보는 사람에 따라 다르다. 상대의 이름이다. */
function channelName(channel, viewerId) {
  if (!channel.is_dm) return channel.name
  const other = channel.memberIds.find((id) => id !== viewerId) ?? viewerId
  return USERS[other]?.name ?? '알 수 없음'
}

/**
 * 생성·멤버 더하기 응답. 백엔드는 이미 있던 DM 을 돌려줄 때도 안읽음 0 · 마지막 메시지 null 로 준다.
 * 릴레이가 진짜 값을 주면, 응답을 목록 캐시에 꽂는 순간 안읽음 배지가 지워지는 차이가 생긴다.
 */
function createdView(channel, viewerId) {
  return { ...channelView(channel, viewerId), unread: 0, last_message: null }
}

/**
 * 이 사람이 이 채널을 지울 수 있는가. 실서버(#352)와 같은 규칙이다.
 * 공개 채널은 임원, 비공개 채널은 그 채널을 연 멤버. 연 사람이 멤버로 없으면(기록이 없거나
 * 나갔으면) 멤버인 임원이 지운다. DM 은 못 지운다(숨기기가 있다).
 */
function canDelete(channel, viewerId) {
  if (channel.is_dm || !channel.memberIds.includes(viewerId)) return false
  if (!channel.is_private || !channel.memberIds.includes(channel.createdBy)) {
    return EXECS.has(viewerId)
  }
  return channel.createdBy === viewerId
}

/** 백엔드 `ChannelOut` 과 같은 모양(04 §5). */
function channelView(channel, viewerId) {
  const list = messages.get(channel.id) ?? []
  const since = lastReadAt(viewerId, channel.id)

  return {
    id: channel.id,
    name: channelName(channel, viewerId),
    is_dm: channel.is_dm,
    // 이 칸이 실려 오는지로 화면이 「비공개로 만들기」를 그릴지 정한다(`supportsPrivate`).
    is_private: channel.is_private === true,
    // 백엔드는 이름순으로 준다. DM 상대를 고르는 화면이 이 순서를 그대로 그린다.
    members: channel.memberIds
      .map((id) => USERS[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name)),
    // 내가 보낸 메시지는 안읽음이 아니다.
    unread: list.filter((m) => m.created_at > since && m.author.id !== viewerId).length,
    last_message: list.at(-1) ?? null,
    can_delete: canDelete(channel, viewerId),
    created_by: channel.createdBy ?? null,
  }
}

// ── WebSocket ────────────────────────────────────────────────

/** @type {Map<import('ws').WebSocket, string>} 연결 → userId */
const sockets = new Map()

/**
 * 사람마다 목록에서 숨긴 DM 방(아래 `/channels/{id}/hide`). 방과 대화는 그대로 있고 그 사람의
 * 목록에서만 빠진다. 그 방에 새 메시지가 오거나 그 사람이 같은 상대와 대화를 다시 열면 돌아온다.
 * @type {Map<string, Set<string>>} userId → 채널 id
 */
const hiddenDms = new Map()
const isHidden = (userId, channelId) => hiddenDms.get(userId)?.has(channelId) === true

function publish(channelId, event) {
  const channel = CHANNELS.find((c) => c.id === channelId)
  if (!channel) return
  publishTo(channel.memberIds, event)
}

/** 특정 사람들에게만. `unread` 는 사람마다 숫자가 달라 채널 전체로 뿌릴 수 없다. */
function publishTo(userIds, event) {
  const payload = JSON.stringify(event)
  for (const [socket, userId] of sockets) {
    if (!userIds.includes(userId)) continue
    if (socket.readyState !== socket.OPEN) continue
    socket.send(payload)
  }
}

/** 멤버마다 자기 안읽음 숫자를 보낸다. 백엔드 `_unread_counts` 와 같은 뜻. */
function publishUnread(channel) {
  for (const uid of channel.memberIds) {
    publishTo([uid], {
      ev: 'unread',
      channel_id: channel.id,
      count: channelView(channel, uid).unread,
    })
  }
}

function sendError(conn, code, detail, channelId) {
  if (conn.readyState !== conn.OPEN) return
  const event = { ev: 'error', code, detail }
  if (channelId) event.channel_id = channelId
  conn.send(JSON.stringify(event))
}

/** 봇 계정. 실서버처럼 저장본에는 `is_bot` 이 없다(과거 메시지 조회엔 안 실린다, 이슈 #403). */
const BOT = { id: 'u-ai', name: 'AI 어시스턴트' }

/**
 * 채팅 `/ai` 커맨드(백엔드 #400) 흉내. 잠시 뒤 「AI 어시스턴트」 명의의 답을 같은 채널에 단다.
 * ponytail: 답은 고정 글이다.
 */
function replyAsBot(channel) {
  setTimeout(() => {
    const author = BOT
    const message = {
      id: `m-${nextId++}`,
      channel_id: channel.id,
      author: { ...author, is_bot: true },
      body: '연차는 입사 1년 뒤 15일이 생깁니다[[1]]. **1년 미만**은 한 달 개근마다 1일입니다[[2]].\n\n근거: [1] 취업규칙 /docs/doc-rules · [2] 연차 안내 /board/b-notice/p-1',
      doc_ref: null,
      attachments: null,
      created_at: new Date().toISOString(),
      edited_at: null,
    }
    messages.get(channel.id)?.push({ ...message, author }) ??
      messages.set(channel.id, [{ ...message, author }])
    publish(channel.id, { ev: 'msg', channel_id: channel.id, message })
    publishUnread(channel)
  }, 2500)
}

export function handleChatConnection(conn, userId) {
  if (!USERS[userId]) return conn.close(4401, 'unknown user')

  sockets.set(conn, userId)
  console.log(`[chat] 접속: ${USERS[userId].name} (${sockets.size}명)`)

  // 보내기·읽음·타이핑은 전부 여기로 온다(04 §4.1). 실서버(`realtime/chat.py`)와 같은 규약이라야
  // 목 모드에서 되는 것이 실서버에서도 된다. 갈라지면 실서버에서만 터지는 버그가 생긴다(이슈 #128).
  conn.on('message', (raw) => {
    let op
    try {
      op = JSON.parse(String(raw))
    } catch {
      return sendError(conn, 'VALIDATION', '프레임을 읽을 수 없습니다.')
    }

    // 구독 범위는 멤버십이 정한다. 받아들이기만 한다(백엔드 SubOp 과 같다).
    if (op.op === 'sub') return

    const channelId = op.channel_id
    const channel = CHANNELS.find((c) => c.id === channelId)
    // 없는 채널도 멤버 아님과 같은 답을 준다. 존재를 새지 않는다.
    if (!channel || !channel.memberIds.includes(userId)) {
      return sendError(conn, 'FORBIDDEN', '권한이 부족합니다.', channelId)
    }

    if (op.op === 'msg') {
      const body = typeof op.body === 'string' ? op.body.trim() : ''
      // 백엔드 `MsgOp.body` 의 상한과 같다. 릴레이가 이걸 모르면 프론트의 선검사가 나중에
      // 헐거워졌을 때 목에서는 계속 통과하고 실서버에서만 죽는다.
      if (body.length > 10_000) {
        return sendError(conn, 'VALIDATION', '본문이 너무 깁니다.', channelId)
      }
      const checked = checkAttachments(op.attachments, channelId, userId)
      if (checked.error) return sendError(conn, 'VALIDATION', checked.error, channelId)
      // 첨부만 보내는 메시지도 있다. 둘 다 없을 때만 막는다.
      if (!body && checked.files.length === 0) {
        return sendError(conn, 'VALIDATION', '본문이나 첨부 중 하나는 있어야 한다.', channelId)
      }

      const message = makeMessage(channelId, userId, body, undefined, checked.files)
      // 질문에 「잦」이 들어 있으면 실서버의 요청 과다 거절을 흉내 낸다. 실서버처럼 내 글을 뿌리기 전에 보낸다.
      const asksAi = body === '/ai' || body.startsWith('/ai ')
      const throttled = asksAi && body.includes('잦')
      if (throttled) {
        sendError(
          conn,
          'AI_THROTTLED',
          'AI 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
          channelId,
        )
      }
      messages.get(channelId)?.push(message) ?? messages.set(channelId, [message])
      // 숨겨 둔 사람에게도 다시 보인다. 화면은 목록에 없는 채널의 `msg` 를 받으면 목록을 다시 받는다.
      for (const uid of channel.memberIds) hiddenDms.get(uid)?.delete(channelId)
      // 보낸 사람은 그 채널을 보고 있다. 서버도 보낸 사람의 last_read_at 을 같이 올린다.
      markRead(userId, channelId)
      publish(channelId, { ev: 'msg', channel_id: channelId, message })
      publishUnread(channel)
      if (asksAi && !throttled) replyAsBot(channel)
      return
    }

    // 고치기·지우기. 실서버(#284)가 아래 규칙대로 구현했다(04 §4.1 에는 아직 없다).
    //   {op:'edit', channel_id, message_id, body} → 멤버 전원에게 {ev:'msg_edit', channel_id, message}
    //   {op:'del',  channel_id, message_id}       → 멤버 전원에게 {ev:'msg_del', channel_id, message_id}
    // 쓴 사람만 할 수 있다. 첨부는 고치기로 바뀌지 않는다.
    if (op.op === 'edit' || op.op === 'del') {
      const list = messages.get(channelId) ?? []
      const index = list.findIndex((m) => m.id === op.message_id)
      const target = list[index]
      if (!target) return sendError(conn, 'NOT_FOUND', '없는 메시지입니다.', channelId)
      // 임원은 봇 글을 지울 수 있다(실서버 #400, 잘못된 답 회수). 고치기는 안 된다.
      const botByExec = op.op === 'del' && target.author.id === BOT.id && EXECS.has(userId)
      if (target.author.id !== userId && !botByExec) {
        return sendError(
          conn,
          'FORBIDDEN',
          '내가 보낸 메시지만 고치거나 지울 수 있습니다.',
          channelId,
        )
      }

      if (op.op === 'del') {
        list.splice(index, 1)
        publish(channelId, { ev: 'msg_del', channel_id: channelId, message_id: target.id })
        // 안 읽은 메시지가 지워졌으면 숫자가 준다. 보는 사람마다 다시 센다.
        return publishUnread(channel)
      }

      const body = typeof op.body === 'string' ? op.body.trim() : ''
      if (body.length > 10_000) {
        return sendError(conn, 'VALIDATION', '본문이 너무 깁니다.', channelId)
      }
      // 보낼 때와 같은 규칙. 첨부가 있으면 글을 비워도 된다.
      if (!body && !target.attachments) {
        return sendError(conn, 'VALIDATION', '본문이나 첨부 중 하나는 있어야 한다.', channelId)
      }
      // 그대로면 고친 것이 아니다. 「수정됨」을 붙이지 않는다.
      if (body === target.body) return
      const message = { ...target, body, edited_at: new Date().toISOString() }
      list[index] = message
      return publish(channelId, { ev: 'msg_edit', channel_id: channelId, message })
    }

    if (op.op === 'read') {
      markRead(userId, channelId)
      return publishTo([userId], { ev: 'unread', channel_id: channelId, count: 0 })
    }

    // 타이핑은 서버에 남기지 않는다. 같은 채널의 다른 사람에게 흘려보내기만 한다.
    if (op.op === 'typing') {
      return publishTo(
        channel.memberIds.filter((id) => id !== userId),
        { ev: 'typing', channel_id: channelId, user_id: userId, name: USERS[userId].name },
      )
    }

    return sendError(conn, 'VALIDATION', `모르는 op: ${op.op}`, channelId)
  })

  conn.on('close', () => {
    sockets.delete(conn)
    console.log(`[chat] 해제: ${USERS[userId].name} (${sockets.size}명)`)
  })
}

// ── HTTP ─────────────────────────────────────────────────────

/**
 * 채널 이름을 실서버(`routers/channels.py` 의 `_clean_name`, #308)처럼 다듬는다. 거절이면 `error`.
 * 실서버의 이 거절은 Pydantic 422 라 `detail` 이 문자열이 아니라 배열이다. 화면이 그 모양을 받는지
 * 개발에서도 보이게 같은 모양으로 돌려준다(`nameRejected`).
 */
function cleanChannelName(raw) {
  const name = raw.normalize('NFKC').trim()
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(name)) return { error: '이름에 쓸 수 없는 문자가 있습니다.' }
  if (!name) return { error: '이름을 적어 주세요.' }
  if ([...name].length > 100) return { error: '이름은 100자 이하여야 합니다.' }
  return { name }
}

function nameRejected(res, error) {
  return json(res, 422, {
    detail: [{ type: 'value_error', loc: ['body', 'name'], msg: `Value error, ${error}` }],
    code: 'VALIDATION',
  })
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1e6) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** 처리했으면 true. dev-server가 나머지를 404로 응답한다. */
/** 세션 쿠키의 사용자 id. dev-server 의 WebSocket 업그레이드도 이걸로 사용자를 정한다. */
export function sessionUserId(req) {
  const cookie = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('zenith.mock.session='))
  return cookie ? decodeURIComponent(cookie.slice('zenith.mock.session='.length)) : null
}

/**
 * 경로로 쓸 수 없는 글자를 뺀다. 백엔드 `storage.safe_name` 과 같은 규칙이다.
 *
 * 앞뒤의 점·공백을 떼는 것이 중요하다. `..` 가 그대로 남으면 브라우저가 경로를 해소해
 * 엉뚱한 주소로 요청한다. 200자는 글자가 아니라 **바이트** 기준이다(한글은 3바이트).
 */
function safeName(raw) {
  const base =
    String(raw || 'file')
      .split('/')
      .pop()
      .split(String.fromCharCode(92))
      .pop() || 'file'
  const banned = '"*/:<>?|' + String.fromCharCode(92)
  let cleaned = [...base]
    // 제어·서식 문자를 뺀다. U+202E 같은 것이 남으면 파일명 표시를 뒤집을 수 있다.
    .filter((ch) => !/\p{C}/u.test(ch) && !banned.includes(ch))
    .join('')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  if (!cleaned) cleaned = 'file'
  while (Buffer.byteLength(cleaned, 'utf8') > 200) cleaned = cleaned.slice(0, -1)
  return cleaned || 'file'
}

/**
 * multipart 본문에서 `file` 파트 하나를 꺼낸다. 라이브러리를 더하지 않으려고 직접 자른다.
 * 첨부는 파트 하나뿐이라 경계 문자열로 나누면 충분하다.
 */
function readMultipartFile(req) {
  /** 파트의 헤더와 본문 사이. 빈 줄 하나다. */
  const CRLF2 = '\r\n\r\n'
  const type = req.headers['content-type'] ?? ''
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type)?.slice(1).find(Boolean)?.trim()
  if (!boundary) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      // 상한의 두 배까지만 받는다. 그보다 크면 어차피 422 라 끝까지 읽을 이유가 없다.
      if (size > MAX_ATTACHMENT_BYTES * 2) return reject(new Error('body too large'))
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const sep = Buffer.from(`--${boundary}`)
      let from = raw.indexOf(sep)
      // 같은 이름의 파트가 여럿이면 **마지막** 것을 쓴다. 백엔드(Starlette)가 그렇다.
      // 검사한 파트와 저장한 파트가 달라지는 파서 차이를 만들지 않는다.
      let picked = null
      while (from !== -1) {
        const start = from + sep.length
        const next = raw.indexOf(sep, start)
        if (next === -1) break
        const part = raw.subarray(start, next)
        const headEnd = part.indexOf(CRLF2)
        if (headEnd !== -1) {
          const head = part.subarray(0, headEnd).toString('utf8')
          if (/name="file"/.test(head)) {
            const filename = /filename="([^"]*)"/.exec(head)?.[1] ?? 'file'
            // 헤더 줄 시작에 앵커를 건다. 파일명 안에 든 문자열이 먼저 잡히면 안 된다.
            const ctLine = head
              .split(/\r?\n/)
              .find((line) => /^content-type:/i.test(line))
              ?.slice('content-type:'.length)
            // 매개변수(`; charset=`)는 떼고 본다. 그대로 반사하므로 토큰 모양만 받는다.
            const ct = ctLine?.split(';')[0]?.trim().toLowerCase()
            const contentType =
              ct && /^[\w.+-]+\/[\w.+-]+$/.test(ct) ? ct : 'application/octet-stream'
            // 파트 끝의 CRLF 는 경계에 속한다.
            const data = part.subarray(headEnd + 4, part.length - 2)
            picked = { filename, contentType, data }
          }
        }
        from = next
      }
      resolve(picked)
    })
  })
}

/**
 * 메시지에 실린 첨부가 **이 채널에 올라온 것**인지 확인한다. 백엔드 `MsgOp` 검증과 같다.
 *
 * 하나라도 걸리면 첨부만 빼는 게 아니라 **메시지를 만들지 않는다.** 백엔드가 그렇게 한다.
 * 조용히 빼면 개발에서는 멀쩡히 보내지는데 실서버에서만 거절당한다.
 *
 * @returns 검사를 통과한 목록, 또는 거절 사유
 */
function checkAttachments(raw, channelId, userId) {
  if (raw === undefined || raw === null) return { files: [] }
  if (!Array.isArray(raw)) return { error: '첨부는 배열이어야 합니다.' }
  if (raw.length > 10) return { error: '첨부는 10개까지입니다.' }

  const files = []
  for (const item of raw) {
    if (!item || typeof item.url !== 'string') return { error: '첨부 모양이 올바르지 않습니다.' }
    const match = /^\/api\/channels\/([^/]+)\/attachments\/([^/]+)\/(.+)$/.exec(item.url)
    if (!match || match[1] !== channelId) {
      return { error: '이 채널에 올린 첨부가 아닙니다.' }
    }
    let name
    try {
      name = decodeURIComponent(match[3])
    } catch {
      // 잘못된 퍼센트 인코딩. 던지면 500 이 된다.
      return { error: '이 채널에 올린 첨부가 아닙니다.' }
    }
    // 이름도 업로드 때 정해진 것이어야 한다. 고쳐 주지 않고 거절한다(백엔드와 같다).
    if (typeof item.name !== 'string' || item.name !== name) {
      return { error: '이 채널에 올린 첨부가 아닙니다.' }
    }
    const stored = attachments.get(`${channelId}/${match[2]}/${name}`)
    // 이 채널에 내가 올린 파일만 싣는다(백엔드 #327). 남이 올린 주소를 미리 실어 두면 원래
    // 메시지를 지워도 그 파일이 계속 받아져 회수가 안 된다. 크기는 올릴 때 잰 값이다.
    if (!stored || stored.uploaderId !== userId) {
      return { error: '이 채널에 직접 올린 첨부만 붙일 수 있습니다.' }
    }
    files.push({ url: item.url, name, size: stored.data.length })
  }
  return { files }
}

export async function handleChatRequest(req, res, url) {
  const path = url.pathname.replace(/^\/chat/, '')
  const viewerId = sessionUserId(req)

  if (path === '/channels' && req.method === 'GET') {
    if (!isUser(viewerId)) return json(res, 401, { detail: '알 수 없는 사용자입니다.' })
    const items = CHANNELS.filter(
      (c) => c.memberIds.includes(viewerId) && !isHidden(viewerId, c.id),
    )
      .map((c) => channelView(c, viewerId))
      // 최근 대화가 위로. 대화가 없는 채널은 아래로 밀리고, 그 안에서는 이름순(백엔드와 같다).
      .sort((a, b) => {
        const at = a.last_message?.created_at ?? ''
        const bt = b.last_message?.created_at ?? ''
        if (at !== bt) return at < bt ? 1 : -1
        return a.name.localeCompare(b.name)
      })
    return json(res, 200, { items })
  }

  /**
   * 채널 또는 DM 생성. 공개 채널과 DM 은 백엔드 `create_channel` 과 같은 규칙이다.
   * 비공개 채널(`is_private` + `member_ids`)도 같다(#236). 다만 릴레이는 모르는 칸을 무시하고
   * 서버는 422 로 거절한다. 릴레이에서 통과한 본문이 실서버에서도 통과한다고 믿지 않는다.
   *
   * 공개 채널은 만들 때 **전원**을 멤버로 넣는다(15명 사내, 초대·탈퇴 없음). 백엔드는 비활성
   * 계정도 넣는다. 복직하면 그 사이 생긴 채널도 보여야 하기 때문이다.
   * DM 은 두 사람짜리 채널이고 같은 두 사람의 DM 은 하나만 둔다.
   */
  if (path === '/channels' && req.method === 'POST') {
    if (!isUser(viewerId)) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }

    // `readBody` 는 본문 전체를 준다. 메시지 전송은 그 안의 `body` 필드를 쓰지만 여기는 아니다.
    const payload = await readBody(req)
    const cleaned = typeof payload?.name === 'string' ? cleanChannelName(payload.name) : undefined
    const name = cleaned?.name
    const dmUserId = typeof payload?.dm_user_id === 'string' ? payload.dm_user_id : undefined

    // 백엔드 `ChannelCreateIn` 은 둘 중 하나만 받는다.
    if ((cleaned === undefined) === (dmUserId === undefined)) {
      return json(res, 422, {
        detail: 'name 또는 dm_user_id 중 하나만 보낸다.',
        code: 'VALIDATION',
      })
    }

    if (dmUserId !== undefined) {
      if (dmUserId === viewerId) {
        return json(res, 422, {
          detail: '자기 자신과는 DM 을 만들 수 없습니다.',
          code: 'VALIDATION',
        })
      }
      if (!USERS[dmUserId]) {
        return json(res, 422, { detail: '없는 사용자입니다.', code: 'VALIDATION' })
      }
      // 같은 두 사람의 DM 이 이미 있으면 그것을 돌려준다. 새로 만들지 않는다.
      const existing = CHANNELS.find(
        (c) =>
          c.is_dm &&
          c.memberIds.length === 2 &&
          c.memberIds.includes(viewerId) &&
          c.memberIds.includes(dmUserId),
      )
      const channel = existing ?? {
        id: `dm-${nextChannelId++}`,
        is_dm: true,
        name: '',
        memberIds: [viewerId, dmUserId],
      }
      if (!existing) CHANNELS.push(channel)
      // 숨겨 둔 대화를 다시 열면 내 목록에 돌아온다.
      hiddenDms.get(viewerId)?.delete(channel.id)
      return json(res, 201, createdView(channel, viewerId))
    }

    if (cleaned.error) return nameRejected(res, cleaned.error)

    // 비공개 채널. 만든 사람과 고른 사람만 멤버다. 혼자 만들고 나중에 사람을 더해도 된다.
    // 두 칸은 같이 와야 한다. 한쪽만 오거나 모양이 틀린 요청을 무시하면 전원이 들어오는
    // 공개 채널이 만들어지고, 보낸 쪽은 그것을 비공개로 안다.
    const { is_private: isPrivate, member_ids: ids } = payload ?? {}
    if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
      return json(res, 422, { detail: 'is_private 는 참·거짓이어야 한다.', code: 'VALIDATION' })
    }
    if ((isPrivate === true) !== (ids !== undefined)) {
      return json(res, 422, {
        detail: 'member_ids 는 is_private: true 와 같이 보낸다.',
        code: 'VALIDATION',
      })
    }
    if (isPrivate === true) {
      if (!Array.isArray(ids)) {
        return json(res, 422, { detail: 'member_ids 는 배열이어야 한다.', code: 'VALIDATION' })
      }
      if (!ids.every(isUser)) {
        return json(res, 422, { detail: '없는 사용자입니다.', code: 'VALIDATION' })
      }
      // 이름 중복을 보지 않는다. 409 를 주면 안 보이는 채널이 있다는 사실이 샌다.
      const channel = {
        id: `c-${nextChannelId++}`,
        is_dm: false,
        is_private: true,
        name,
        memberIds: [...new Set([viewerId, ...ids])],
        createdBy: viewerId,
      }
      CHANNELS.push(channel)
      publishTo(channel.memberIds, { ev: 'channels' })
      return json(res, 201, createdView(channel, viewerId))
    }

    // 공개 채널끼리만 견준다. 비공개 채널과 이름이 겹치는 것은 막지 않는다(위와 같은 이유).
    if (CHANNELS.some((c) => !c.is_dm && !c.is_private && c.name === name)) {
      return json(res, 409, { detail: '같은 이름의 채널이 있습니다.', code: 'CONFLICT' })
    }
    // `ALL` 을 그대로 참조하면 나중에 멤버를 건드릴 때 시드 채널까지 같이 바뀐다.
    const channel = { id: `c-${nextChannelId++}`, is_dm: false, name, memberIds: [...ALL] }
    CHANNELS.push(channel)
    return json(res, 201, createdView(channel, viewerId))
  }

  /**
   * 첨부 업로드(multipart `file`). 백엔드 `upload_attachment` 와 같은 규칙이다.
   * 10MB 초과·빈 파일은 422, 채널 멤버가 아니면 403. 돌려주는 `{url, name, size}` 를
   * 메시지의 `attachments[]` 에 그대로 넣는다.
   */
  const uploadMatch = path.match(/^\/channels\/([^/]+)\/attachments$/)
  if (uploadMatch && req.method === 'POST') {
    if (!isUser(viewerId)) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }
    const channelId = uploadMatch[1]
    const channel = CHANNELS.find((c) => c.id === channelId)
    if (!channel || !channel.memberIds.includes(viewerId)) {
      return json(res, 403, { detail: '권한이 부족합니다.', code: 'FORBIDDEN' })
    }

    const part = await readMultipartFile(req)
    if (!part) return json(res, 422, { detail: '파일이 없습니다.', code: 'VALIDATION' })
    if (part.data.length === 0) {
      return json(res, 422, { detail: '빈 파일입니다.', code: 'VALIDATION' })
    }
    if (part.data.length > MAX_ATTACHMENT_BYTES) {
      return json(res, 422, { detail: '10MB 이하 파일만 올릴 수 있습니다.', code: 'VALIDATION' })
    }

    const fileId = `f-${nextId++}`
    const name = safeName(part.filename)
    attachments.set(`${channelId}/${fileId}/${name}`, {
      data: part.data,
      contentType: part.contentType,
      uploaderId: viewerId,
    })
    return json(res, 201, {
      url: `/api/channels/${channelId}/attachments/${fileId}/${encodeURIComponent(name)}`,
      name,
      size: part.data.length,
    })
  }

  /**
   * 첨부 내려받기. 채널 멤버만, 그리고 그 채널의 살아 있는 메시지가 싣고 있는 파일만(백엔드 #327).
   * 메시지를 지우면 주소를 알아도 못 받는다. 아직 안 보낸 파일도 404 다. 이미지는 inline, 나머지는
   * 내려받기.
   */
  const downloadMatch = path.match(/^\/channels\/([^/]+)\/attachments\/([^/]+)\/(.+)$/)
  if (downloadMatch && req.method === 'GET') {
    if (!isUser(viewerId)) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }
    const [, channelId, fileId, rawName] = downloadMatch
    const channel = CHANNELS.find((c) => c.id === channelId)
    if (!channel || !channel.memberIds.includes(viewerId)) {
      return json(res, 403, { detail: '권한이 부족합니다.', code: 'FORBIDDEN' })
    }
    let name
    try {
      name = decodeURIComponent(rawName)
    } catch {
      // 잘못된 퍼센트 인코딩. 던지면 500 이 된다.
      return json(res, 404, { detail: '없는 첨부입니다.', code: 'NOT_FOUND' })
    }
    const found = attachments.get(`${channelId}/${fileId}/${name}`)
    const carried = (messages.get(channelId) ?? []).some((m) =>
      (m.attachments ?? []).some((a) => a.url.split('/')[5] === fileId),
    )
    if (!found || !carried) return json(res, 404, { detail: '없는 첨부입니다.', code: 'NOT_FOUND' })

    const inline = INLINE_TYPES.has(found.contentType)
    res.writeHead(200, {
      'Content-Type': found.contentType,
      'Content-Length': found.data.length,
      // 한글 파일명은 filename* 로(RFC 6266). 스크립트가 돌 수 있는 형식은 내려받기만.
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      // 캐시에 남기지 않는다(백엔드 #327). 브라우저 캐시는 쿠키를 가리지 않아 같은 브라우저의
      // 다음 사용자가 판정 없이 열 수 있고, 지운 메시지의 파일도 남는다.
      'Cache-Control': 'no-store',
    })
    return res.end(found.data)
  }

  /**
   * 채널 지우기. 실서버(#352)와 같은 계약이다.
   *
   *   DELETE /channels/{id} → 204. 지울 수 있는 사람은 `canDelete`. 멤버인데 권한이 없어도,
   *                           없는 채널이어도 403(존재를 새지 않는다). DM 은 422.
   *
   * 대화와 첨부를 같이 지우고, 지우기 전 멤버 전원에게 `channels` 이벤트를 보낸다.
   */
  const deleteMatch = req.method === 'DELETE' && path.match(/^\/channels\/([^/]+)$/)
  if (deleteMatch) {
    if (!isUser(viewerId)) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }
    const channel = CHANNELS.find((c) => c.id === deleteMatch[1])
    if (!channel || !channel.memberIds.includes(viewerId)) return json(res, 403, FORBIDDEN)
    if (channel.is_dm) {
      return json(res, 422, { detail: 'DM 은 지울 수 없습니다.', code: 'VALIDATION' })
    }
    if (!canDelete(channel, viewerId)) return json(res, 403, FORBIDDEN)
    CHANNELS.splice(CHANNELS.indexOf(channel), 1)
    messages.delete(channel.id)
    for (const key of attachments.keys()) {
      if (key.startsWith(`${channel.id}/`)) attachments.delete(key)
    }
    publishTo(channel.memberIds, { ev: 'channels' })
    res.writeHead(204)
    return res.end()
  }

  /**
   * 채널 이름 바꾸기와 DM 숨기기. 실서버(#280)가 아래 규칙대로 구현했다(04 §4 에는 없다).
   *
   *   PATCH /channels/{id} {name}   → 200 `ChannelOut`. 멤버면 누구나.
   *                                   DM 은 이름이 없어 422. 이름 규칙은 만들 때와 같다.
   *   POST  /channels/{id}/hide     → 204. DM 만(채널은 422). 내 목록에서만 빠진다.
   *
   * 이름이 바뀌면 멤버 전원에게, 숨기면 나에게만 `channels` 이벤트를 보낸다.
   */
  const channelMatch = path.match(/^\/channels\/([^/]+)(\/hide)?$/)
  if (channelMatch && (req.method === 'PATCH' || req.method === 'POST')) {
    const hide = channelMatch[2] !== undefined
    if (hide !== (req.method === 'POST')) return json(res, 404, { detail: '없는 경로입니다.' })
    const payload = hide ? undefined : await readBody(req)
    if (!isUser(viewerId)) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }
    const channel = CHANNELS.find((c) => c.id === channelMatch[1])
    if (!channel || !channel.memberIds.includes(viewerId)) return json(res, 403, FORBIDDEN)

    if (hide) {
      if (!channel.is_dm) {
        return json(res, 422, { detail: 'DM 만 숨길 수 있습니다.', code: 'VALIDATION' })
      }
      const mine = hiddenDms.get(viewerId) ?? new Set()
      hiddenDms.set(viewerId, mine.add(channel.id))
      publishTo([viewerId], { ev: 'channels' })
      res.writeHead(204)
      return res.end()
    }

    if (channel.is_dm) {
      return json(res, 422, { detail: 'DM 은 이름을 바꿀 수 없습니다.', code: 'VALIDATION' })
    }
    const cleaned = cleanChannelName(typeof payload?.name === 'string' ? payload.name : '')
    if (cleaned.error) return nameRejected(res, cleaned.error)
    const { name } = cleaned
    // 만들 때와 같다. 공개 채널끼리만 견주고, 비공개 채널의 이름은 겹쳐도 막지 않는다.
    const taken = CHANNELS.some(
      (c) => c !== channel && !c.is_dm && !c.is_private && c.name === name,
    )
    if (!channel.is_private && taken) {
      return json(res, 409, { detail: '같은 이름의 채널이 있습니다.', code: 'CONFLICT' })
    }
    channel.name = name
    publishTo(channel.memberIds, { ev: 'channels' })
    return json(res, 200, channelView(channel, viewerId))
  }

  /**
   * 비공개 채널의 멤버를 더하고 뺀다. 실서버(#236)가 아래 규칙대로 구현했다.
   *
   * 멤버면 누구나 더하고 뺄 수 있다. 연 사람만 남이 못 뺀다(403). 자기 자신을 빼는 것이 나가기다.
   * 공개 채널은 전원이고 DM 은 두 사람으로 고정이라 둘 다 422.
   * 바뀐 뒤에는 전·후 멤버 모두에게 `channels` 이벤트를 보낸다. 빠진 사람의 목록에서 채널이
   * 사라지고, 들어온 사람의 목록에 채널이 생겨야 한다.
   */
  const membersMatch = path.match(/^\/channels\/([^/]+)\/members(?:\/([^/]+))?$/)
  if (membersMatch) {
    // 본문을 권한 확인보다 먼저 읽는다. 확인한 뒤에 기다리면, 그 사이 빠진 사람의 요청이
    // 옛 명단 위에 반영돼 그 사람이 되살아난다. 실서버는 채널별 잠금으로 막는다.
    const body = req.method === 'POST' ? await readBody(req) : undefined
    if (!isUser(viewerId)) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }
    const channel = CHANNELS.find((c) => c.id === membersMatch[1])
    if (!channel || !channel.memberIds.includes(viewerId)) return json(res, 403, FORBIDDEN)
    if (!channel.is_private) {
      return json(res, 422, {
        detail: '비공개 채널만 멤버를 바꿀 수 있습니다.',
        code: 'VALIDATION',
      })
    }
    const before = channel.memberIds

    if (req.method === 'POST' && membersMatch[2] === undefined) {
      const ids = body?.user_ids
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUser)) {
        return json(res, 422, { detail: '없는 사용자입니다.', code: 'VALIDATION' })
      }
      // 이미 멤버인 사람은 건너뛴다(같은 요청을 두 번 보내도 결과가 같다).
      channel.memberIds = [...new Set([...before, ...ids])]
      publishTo(channel.memberIds, { ev: 'channels' })
      return json(res, 200, createdView(channel, viewerId))
    }

    if (req.method === 'DELETE' && membersMatch[2] !== undefined) {
      const target = membersMatch[2]
      if (!before.includes(target)) {
        return json(res, 404, { detail: '이 채널의 멤버가 아닙니다.', code: 'NOT_FOUND' })
      }
      if (target === channel.createdBy && target !== viewerId) {
        return json(res, 403, {
          detail: '채널을 연 사람은 본인만 나갈 수 있습니다.',
          code: 'FORBIDDEN',
        })
      }
      channel.memberIds = before.filter((id) => id !== target)
      // 마지막 사람이 나가면 아무에게도 안 보이는 채널이 된다. 릴레이는 지운다. 실서버는 지우지
      // 않고 멤버 0 으로 남긴다(메시지·첨부 보존). 목록에서 사라지는 것은 같다.
      if (channel.memberIds.length === 0) CHANNELS.splice(CHANNELS.indexOf(channel), 1)
      publishTo(before, { ev: 'channels' })
      res.writeHead(204)
      return res.end()
    }
  }

  const messagesMatch = path.match(/^\/channels\/([^/]+)\/messages$/)
  if (messagesMatch) {
    const channelId = messagesMatch[1]
    const channel = CHANNELS.find((c) => c.id === channelId)
    if (!channel || !channel.memberIds.includes(viewerId)) return json(res, 403, FORBIDDEN)

    if (req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const list = messages.get(channelId) ?? []
      // 봉투도 백엔드와 같다(`MessagePage`). `?cursor=` 보다 과거인 것을 limit 개, 오래된 순으로 준다.
      // 릴레이의 커서는 그 쪽에서 가장 오래된 메시지의 id 다. 실서버는 시각과 id 를 묶은 문자열을
      // 주는데, 화면은 어느 쪽이든 뜻을 읽지 않고 그대로 돌려보낸다.
      const cursor = url.searchParams.get('cursor')
      const end = cursor ? list.findIndex((m) => m.id === cursor) : list.length
      if (end < 0) return json(res, 422, { code: 'VALIDATION', detail: '잘못된 커서입니다.' })
      const start = Math.max(0, end - limit)
      return json(res, 200, {
        items: list.slice(start, end),
        next_cursor: start > 0 ? list[start].id : null,
      })
    }

    // POST 는 없다. 보내기는 소켓 `msg` op 이다(04 §4.1). 실서버도 이 경로에 405 를 준다.
  }

  // `/channels/{id}/read` 도 없다. 읽음은 소켓 `read` op 이다.

  return json(res, 404, { detail: '없는 경로입니다.' })
}
