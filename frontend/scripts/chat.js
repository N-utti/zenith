/**
 * 개발용 채팅 서버. dev-server.js가 /chat/* 요청과 업그레이드를 여기로 넘긴다.
 *
 * 채팅은 MSW로 만들 수 없다. MSW는 브라우저 안에서만 도는 목이라, A가 보낸
 * 메시지를 B의 MSW는 알지 못한다. 공유 상태를 들고 있는 프로세스가 필요하다.
 *
 * ── 백엔드가 구현해야 할 것 ────────────────────────────────────
 * 앱은 `/api/chat/*` 으로 호출한다. vite가 여기로 넘길 뿐이므로, FastAPI가
 * 같은 경로·같은 모양으로 응답하면 앱 코드는 그대로다.
 *
 *   GET  /channels                    사용자별 목록 (안읽음·마지막 메시지 포함)
 *   GET  /channels/:id/messages       최근 메시지
 *   POST /channels/:id/messages       전송 → 구독자에게 WS 브로드캐스트
 *   POST /channels/:id/read           읽음 처리
 *   WS   /ws                          message · typing · read 이벤트
 *
 * 인증은 MSW 로그인이 심는 세션 쿠키(zenith.mock.session=<userId>)로만 한다. 실제 백엔드가
 * HttpOnly 쿠키의 JWT 에서 사용자를 꺼내는 것과 같은 자리다. URL·본문의 userId 는 보지 않는다
 * (11 §7.5). 채널 멤버가 아닌 사용자의 요청은 403이어야 한다.
 *
 * 메모리에만 보관한다. 서버를 끄면 대화가 사라진다.
 */

import users from '../src/mocks/users.json' with { type: 'json' }

/** src/lib/avatar.ts 의 hueOf 와 같은 식. 채팅 아바타 색이 다른 화면과 같아야 한다. */
function hueOf(id) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return hash % 360
}

/** 명단은 MSW 와 같은 users.json. u-1 진수연(사원) · u-2 정성운(사원) · u-3 홍성완(임원)이 시드 대화에 등장한다. */
const USERS = Object.fromEntries(users.map((u) => [u.id, { id: u.id, name: u.name, hue: hueOf(u.id) }]))

const ALL = Object.keys(USERS)

/** @type {{id:string, kind:'channel'|'dm', name?:string, memberIds:string[]}[]} */
const CHANNELS = [
  { id: 'c-notice', kind: 'channel', name: '공지', memberIds: ALL },
  { id: 'c-dev', kind: 'channel', name: '개발', memberIds: ALL },
  { id: 'c-random', kind: 'channel', name: '잡담', memberIds: ALL },
  { id: 'dm-u1-u2', kind: 'dm', memberIds: ['u-1', 'u-2'] },
  // u-5 안재호는 MSW 근태 시드에서 오늘 재택이다. DM 행의 근무 상태 표시를 보여 주는 용도.
  { id: 'dm-u2-u5', kind: 'dm', memberIds: ['u-2', 'u-5'] },
]

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()

let nextId = 1
function makeMessage(channelId, authorId, body, createdAt) {
  const author = USERS[authorId]
  return {
    id: `m-${nextId++}`,
    channelId,
    authorId,
    authorName: author.name,
    authorHue: author.hue,
    body,
    createdAt: createdAt ?? new Date().toISOString(),
  }
}

/** @type {Map<string, ReturnType<typeof makeMessage>[]>} */
const messages = new Map([
  [
    'c-notice',
    [
      makeMessage('c-notice', 'u-3', '워크숍 참석 여부 회신 부탁드립니다.', minutesAgo(175)),
    ],
  ],
  [
    'c-dev',
    [
      makeMessage('c-dev', 'u-2', '문서 모듈 어디까지 됐나요?', minutesAgo(95)),
      makeMessage('c-dev', 'u-1', '에디터랑 공동편집까지 붙였고 버전 기록 작업 중입니다.', minutesAgo(92)),
      makeMessage('c-dev', 'u-2', '좋네요. 백엔드 붙기 전에 목으로 확인 가능한가요?', minutesAgo(90)),
      makeMessage('c-dev', 'u-1', 'Yjs 커서 동기화 이슈 재현됐습니다. 스크린샷 올릴게요', minutesAgo(4)),
    ],
  ],
  ['c-random', []],
  [
    'dm-u1-u2',
    [makeMessage('dm-u1-u2', 'u-2', '내일 스탠드업 30분 당길 수 있을까요?', minutesAgo(38))],
  ],
  [
    'dm-u2-u5',
    [makeMessage('dm-u2-u5', 'u-5', '오늘 재택이라 펀드 보고서는 메일로 드릴게요.', minutesAgo(140))],
  ],
])

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
  if (channel.kind === 'channel') return channel.name
  const other = channel.memberIds.find((id) => id !== viewerId) ?? viewerId
  return USERS[other]?.name ?? '알 수 없음'
}

function channelView(channel, viewerId) {
  const list = messages.get(channel.id) ?? []
  const since = lastReadAt(viewerId, channel.id)
  const last = list.at(-1)

  return {
    id: channel.id,
    kind: channel.kind,
    name: channelName(channel, viewerId),
    memberIds: channel.memberIds,
    // 내가 보낸 메시지는 안읽음이 아니다.
    unread: list.filter((m) => m.createdAt > since && m.authorId !== viewerId).length,
    lastMessage: last?.body ?? null,
    lastAt: last?.createdAt ?? null,
  }
}

// ── WebSocket ────────────────────────────────────────────────

/** @type {Map<import('ws').WebSocket, string>} 연결 → userId */
const sockets = new Map()

function publish(channelId, event) {
  const channel = CHANNELS.find((c) => c.id === channelId)
  if (!channel) return
  const payload = JSON.stringify(event)

  for (const [socket, userId] of sockets) {
    if (!channel.memberIds.includes(userId)) continue
    if (socket.readyState !== socket.OPEN) continue
    socket.send(payload)
  }
}

export function handleChatConnection(conn, userId) {
  if (!USERS[userId]) return conn.close(4401, 'unknown user')

  sockets.set(conn, userId)
  console.log(`[chat] 접속: ${USERS[userId].name} (${sockets.size}명)`)

  conn.on('message', (raw) => {
    let event
    try {
      event = JSON.parse(String(raw))
    } catch {
      return
    }
    // 타이핑은 서버에 남기지 않는다. 같은 채널의 다른 사람에게 흘려보내기만 한다.
    if (event.type === 'typing' && event.channelId) {
      publish(event.channelId, {
        type: 'typing',
        channelId: event.channelId,
        userId,
        name: USERS[userId].name,
      })
    }
  })

  conn.on('close', () => {
    sockets.delete(conn)
    console.log(`[chat] 해제: ${USERS[userId].name} (${sockets.size}명)`)
  })
}

// ── HTTP ─────────────────────────────────────────────────────

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

export async function handleChatRequest(req, res, url) {
  const path = url.pathname.replace(/^\/chat/, '')
  const viewerId = sessionUserId(req)

  if (path === '/channels' && req.method === 'GET') {
    if (!USERS[viewerId]) return json(res, 401, { detail: '알 수 없는 사용자입니다.' })
    const items = CHANNELS.filter((c) => c.memberIds.includes(viewerId))
      .map((c) => channelView(c, viewerId))
      // 최근 대화가 위로. 대화가 없는 채널은 아래로 밀린다.
      .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
    return json(res, 200, { items })
  }

  const messagesMatch = path.match(/^\/channels\/([^/]+)\/messages$/)
  if (messagesMatch) {
    const channelId = messagesMatch[1]
    const channel = CHANNELS.find((c) => c.id === channelId)
    if (!channel) return json(res, 404, { detail: '채널을 찾을 수 없습니다.' })

    if (req.method === 'GET') {
      if (!channel.memberIds.includes(viewerId)) {
        return json(res, 403, { detail: '이 채널의 멤버가 아닙니다.' })
      }
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const list = messages.get(channelId) ?? []
      return json(res, 200, { items: list.slice(-limit) })
    }

    if (req.method === 'POST') {
      const { body } = await readBody(req)
      const userId = viewerId
      if (!USERS[userId]) return json(res, 401, { detail: '알 수 없는 사용자입니다.' })
      if (!channel.memberIds.includes(userId)) {
        return json(res, 403, { detail: '이 채널의 멤버가 아닙니다.' })
      }
      if (!body?.trim()) return json(res, 400, { detail: '내용을 입력하세요.' })

      const message = makeMessage(channelId, userId, body.trim())
      messages.get(channelId)?.push(message) ?? messages.set(channelId, [message])
      // 보낸 사람 기준으로는 읽은 상태다.
      markRead(userId, channelId)
      publish(channelId, { type: 'message', message })
      return json(res, 201, message)
    }
  }

  const readMatch = path.match(/^\/channels\/([^/]+)\/read$/)
  if (readMatch && req.method === 'POST') {
    const userId = viewerId
    if (!USERS[userId]) return json(res, 401, { detail: '알 수 없는 사용자입니다.' })
    markRead(userId, readMatch[1])
    publish(readMatch[1], { type: 'read', channelId: readMatch[1], userId })
    return json(res, 200, { ok: true })
  }

  return json(res, 404, { detail: '없는 경로입니다.' })
}
