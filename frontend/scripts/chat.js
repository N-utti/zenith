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
 *   POST /channels/:id/messages       전송 (04 에 없다. 백엔드는 WS 의 msg op)
 *   POST /channels/:id/read           읽음 처리 (04 에 없다. 백엔드는 WS 의 read 이벤트로 받는다)
 *   WS   /ws                          message · typing · read 이벤트
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

const ALL = Object.keys(USERS)

/**
 * `memberIds` 는 릴레이 안에서만 쓴다. 밖으로는 `members`(이름까지)로 펼쳐 나간다.
 * @type {{id:string, is_dm:boolean, name:string, memberIds:string[]}[]}
 */
const CHANNELS = [
  { id: 'c-notice', is_dm: false, name: '공지', memberIds: ALL },
  { id: 'c-dev', is_dm: false, name: '개발', memberIds: ALL },
  { id: 'c-random', is_dm: false, name: '잡담', memberIds: ALL },
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

/**
 * 올라온 첨부. 실제 서버는 MinIO 에 넣는다. 릴레이는 메모리라 다시 띄우면 사라진다.
 * 키는 백엔드와 같은 모양(`channels/{채널}/{파일}/{이름}`).
 * @type {Map<string, {data: Buffer, contentType: string}>}
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
 * 생성 응답. 백엔드는 이미 있던 DM 을 돌려줄 때도 안읽음 0 · 마지막 메시지 null 로 준다.
 * 릴레이가 진짜 값을 주면, 응답을 목록 캐시에 꽂는 순간 안읽음 배지가 지워지는 차이가 생긴다.
 */
function createdView(channel, viewerId) {
  return { ...channelView(channel, viewerId), unread: 0, last_message: null }
}

/** 백엔드 `ChannelOut` 과 같은 모양(04 §5). */
function channelView(channel, viewerId) {
  const list = messages.get(channel.id) ?? []
  const since = lastReadAt(viewerId, channel.id)

  return {
    id: channel.id,
    name: channelName(channel, viewerId),
    is_dm: channel.is_dm,
    // 백엔드는 이름순으로 준다. DM 상대를 고르는 화면이 이 순서를 그대로 그린다.
    members: channel.memberIds
      .map((id) => USERS[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name)),
    // 내가 보낸 메시지는 안읽음이 아니다.
    unread: list.filter((m) => m.created_at > since && m.author.id !== viewerId).length,
    last_message: list.at(-1) ?? null,
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

/** 경로로 쓸 수 없는 글자를 뺀다. 백엔드 `storage.safe_name` 이 하는 일이다. */
function safeName(raw) {
  // 정규식 대신 글자로 건다. 경로 구분자와 따옴표류가 섞여 있어 정규식으로 쓰면 읽기 어렵다.
  const base = String(raw || 'file').split('/').pop().split(String.fromCharCode(92)).pop() || 'file'
  const banned = '"*/:<>?|' + String.fromCharCode(92)
  const cleaned = [...base]
    .filter((ch) => ch >= ' ' && !banned.includes(ch))
    .join('')
    .trim()
  return (cleaned || 'file').slice(0, 200)
}

/**
 * multipart 본문에서 `file` 파트 하나를 꺼낸다. 라이브러리를 더하지 않으려고 직접 자른다.
 * 첨부는 파트 하나뿐이라 경계 문자열로 나누면 충분하다.
 */
function readMultipartFile(req) {
  /** 파트의 헤더와 본문 사이. 빈 줄 하나다. */
  const CRLF2 = '\r\n\r\n'
  const type = req.headers['content-type'] ?? ''
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type)?.slice(1).find(Boolean)
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
            const ct = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim().toLowerCase()
            // 헤더 값을 그대로 반사하므로 토큰 모양만 받는다. 나머지는 octet-stream.
            const contentType = ct && /^[\w.+-]+\/[\w.+-]+$/.test(ct) ? ct : 'application/octet-stream'
            // 파트 끝의 CRLF 는 경계에 속한다.
            const data = part.subarray(headEnd + 4, part.length - 2)
            return resolve({ filename, contentType, data })
          }
        }
        from = next
      }
      resolve(null)
    })
  })
}

/**
 * 메시지에 실린 첨부가 **이 채널에 올라온 것**인지 확인한다. 백엔드 `parse_attachment_url` 과
 * 같은 판정이다. 남의 채널 파일을 메시지에 끼울 수 없고, 이름도 업로드 때 정해진 것이어야 한다.
 */
function pickAttachments(raw, channelId) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 10).flatMap((item) => {
    if (!item || typeof item.url !== 'string') return []
    const match = /^\/api\/channels\/([^/]+)\/attachments\/([^/]+)\/(.+)$/.exec(item.url)
    if (!match || match[1] !== channelId) return []
    const name = decodeURIComponent(match[3])
    const stored = attachments.get(`${channelId}/${match[2]}/${name}`)
    if (!stored) return []
    return [{ url: item.url, name, size: stored.data.length }]
  })
}

export async function handleChatRequest(req, res, url) {
  const path = url.pathname.replace(/^\/chat/, '')
  const viewerId = sessionUserId(req)

  if (path === '/channels' && req.method === 'GET') {
    if (!USERS[viewerId]) return json(res, 401, { detail: '알 수 없는 사용자입니다.' })
    const items = CHANNELS.filter((c) => c.memberIds.includes(viewerId))
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
   * 공개 채널 또는 DM 생성. 백엔드 `create_channel` 과 같은 규칙이다.
   *
   * 공개 채널은 만들 때 **전원**을 멤버로 넣는다(15명 사내, 초대·탈퇴 없음). 백엔드는 비활성
   * 계정도 넣는다. 복직하면 그 사이 생긴 채널도 보여야 하기 때문이다.
   * DM 은 두 사람짜리 채널이고 같은 두 사람의 DM 은 하나만 둔다.
   */
  if (path === '/channels' && req.method === 'POST') {
    if (!USERS[viewerId]) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }

    // `readBody` 는 본문 전체를 준다. 메시지 전송은 그 안의 `body` 필드를 쓰지만 여기는 아니다.
    const payload = await readBody(req)
    const name = typeof payload?.name === 'string' ? payload.name.trim() : undefined
    const dmUserId = typeof payload?.dm_user_id === 'string' ? payload.dm_user_id : undefined

    // 백엔드 `ChannelCreateIn` 은 둘 중 하나만 받는다.
    if ((name === undefined) === (dmUserId === undefined)) {
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
      return json(res, 201, createdView(channel, viewerId))
    }

    if (!name || name.length > 100) {
      return json(res, 422, {
        detail: '채널 이름은 1자 이상 100자 이하여야 합니다.',
        code: 'VALIDATION',
      })
    }
    if (CHANNELS.some((c) => !c.is_dm && c.name === name)) {
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
    if (!USERS[viewerId]) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }
    const channelId = uploadMatch[1]
    const channel = CHANNELS.find((c) => c.id === channelId)
    if (!channel || !channel.memberIds.includes(viewerId)) {
      return json(res, 403, { detail: '이 채널의 멤버가 아닙니다.', code: 'FORBIDDEN' })
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
    })
    return json(res, 201, {
      url: `/api/channels/${channelId}/attachments/${fileId}/${encodeURIComponent(name)}`,
      name,
      size: part.data.length,
    })
  }

  /** 첨부 내려받기. 채널 멤버만. 이미지는 inline, 나머지는 내려받기. */
  const downloadMatch = path.match(/^\/channels\/([^/]+)\/attachments\/([^/]+)\/(.+)$/)
  if (downloadMatch && req.method === 'GET') {
    if (!USERS[viewerId]) {
      return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
    }
    const [, channelId, fileId, rawName] = downloadMatch
    const channel = CHANNELS.find((c) => c.id === channelId)
    if (!channel || !channel.memberIds.includes(viewerId)) {
      return json(res, 403, { detail: '이 채널의 멤버가 아닙니다.', code: 'FORBIDDEN' })
    }
    const name = decodeURIComponent(rawName)
    const found = attachments.get(`${channelId}/${fileId}/${name}`)
    if (!found) return json(res, 404, { detail: '없는 첨부입니다.', code: 'NOT_FOUND' })

    const inline = INLINE_TYPES.has(found.contentType)
    res.writeHead(200, {
      'Content-Type': found.contentType,
      'Content-Length': found.data.length,
      // 한글 파일명은 filename* 로(RFC 6266). 스크립트가 돌 수 있는 형식은 내려받기만.
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
    })
    return res.end(found.data)
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
      // 봉투도 백엔드와 같다(`MessagePage`). 릴레이는 전부 메모리에 있어 더 과거가 없다.
      return json(res, 200, { items: list.slice(-limit), next_cursor: null })
    }

    if (req.method === 'POST') {
      const payload = await readBody(req)
      const body = typeof payload?.body === 'string' ? payload.body : ''
      const userId = viewerId
      if (!USERS[userId]) {
        return json(res, 401, { detail: '알 수 없는 사용자입니다.', code: 'AUTH_REQUIRED' })
      }
      if (!channel.memberIds.includes(userId)) {
        return json(res, 403, { detail: '이 채널의 멤버가 아닙니다.', code: 'FORBIDDEN' })
      }
      // 첨부만 보내는 메시지도 있다. 둘 다 없을 때만 막는다.
      const files = pickAttachments(payload?.attachments, channelId)
      if (!body.trim() && files.length === 0) {
        return json(res, 422, { detail: '내용을 입력하세요.', code: 'VALIDATION' })
      }

      const message = makeMessage(channelId, userId, body.trim(), undefined, files)
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
