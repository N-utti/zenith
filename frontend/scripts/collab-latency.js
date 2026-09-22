/**
 * 공동편집 반영 시간 실측. 성공 기준 "2인 동시편집 시 1초 이내 변경·커서 반영 (충돌 0)"
 * (README §성공 기준 · 01 PRD §5)의 게이트를 숫자로 닫기 위한 계측기다.
 *
 * 클라이언트 두 개를 같은 방에 붙여 놓고, A 가 편집한 순간부터 B 의 Y.Doc 에
 * 그 편집이 도착할 때까지를 잰다. 커서는 awareness 로 같은 방식.
 *
 *   node scripts/collab-latency.js                      # 개발 릴레이(npm run server, :1234)
 *   node scripts/collab-latency.js --url ws://<서버>/api/yjs --room <문서UUID> --cookie "session=..."
 *
 * 재는 것: 릴레이 왕복(A 트랜잭션 → 서버 중계 → B 적용). 재지 않는 것: tiptap 렌더 시간과
 * 사람의 입력 지연. 기준의 "반영"에는 렌더가 포함되므로 화면 확인은 따로 해야 한다.
 */
import { WebSocket as NodeWebSocket } from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const url = arg('url', 'ws://localhost:1234/collab')
const room = arg('room', `latency-${Date.now()}`)
const cookie = arg('cookie', '')
const rounds = Number(arg('rounds', 30))

// y-websocket 은 소켓을 `new WS(url)` 로만 만든다. 쿠키(11 §7.5 — 백엔드 인증)를 실으려면 감싸야 한다.
class Socket extends NodeWebSocket {
  constructor(target, protocols) {
    super(target, protocols, cookie ? { headers: { Cookie: cookie } } : undefined)
  }
}

function connect(label) {
  const doc = new Y.Doc({ gc: false })
  // disableBc: 한 프로세스 안의 두 클라이언트가 BroadcastChannel 로 직통하면 릴레이를 재는 게 아니게 된다.
  const provider = new WebsocketProvider(url, room, doc, {
    WebSocketPolyfill: Socket,
    disableBc: true,
  })
  provider.on('connection-error', () => console.error(`[${label}] 연결 실패: ${url}/${room}`))
  provider.on('closed', (event) => console.error(`[${label}] 닫힘 code=${event.code}`))
  return { doc, provider, text: doc.getText('probe') }
}

const settled = (provider) =>
  provider.synced
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
        provider.once('sync', resolve)
        setTimeout(() => reject(new Error(`릴레이 동기화 실패: ${url}/${room}`)), 5000)
      })

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]

const report = (name, samples) => {
  const p50 = percentile(samples, 0.5)
  const p95 = percentile(samples, 0.95)
  const max = Math.max(...samples)
  const verdict = max < 1000 ? '통과' : '초과'
  console.log(
    `${name}: p50 ${p50.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · 최악 ${max.toFixed(1)}ms ` +
      `(n=${samples.length}) → 1초 기준 ${verdict}`,
  )
  return max < 1000
}

const a = connect('A')
const b = connect('B')
await Promise.all([settled(a.provider), settled(b.provider)])

// ── 변경 반영 ────────────────────────────────────────────────
const textSamples = []
for (let round = 0; round < rounds; round += 1) {
  const arrived = new Promise((resolve) => b.doc.once('update', resolve))
  const sentAt = performance.now()
  a.text.insert(a.text.length, `${round};`)
  await arrived
  textSamples.push(performance.now() - sentAt)
}

// ── 커서 반영 ────────────────────────────────────────────────
const cursorSamples = []
for (let round = 0; round < rounds; round += 1) {
  const arrived = new Promise((resolve) => b.provider.awareness.once('change', resolve))
  const sentAt = performance.now()
  a.provider.awareness.setLocalStateField('cursor', { anchor: round, head: round })
  await arrived
  cursorSamples.push(performance.now() - sentAt)
}

// ── 충돌 0 ───────────────────────────────────────────────────
// 양쪽이 같은 자리에 동시에 끼워 넣는다. CRDT 가 성립하면 두 문서가 같은 문장으로 수렴하고
// 어느 쪽 입력도 사라지지 않는다. 하나라도 어긋나면 충돌이다.
for (let round = 0; round < rounds; round += 1) {
  a.text.insert(0, `a${round}`)
  b.text.insert(0, `b${round}`)
}
await new Promise((resolve) => setTimeout(resolve, 2000))
const left = a.text.toString()
const right = b.text.toString()
const missing = Array.from({ length: rounds }, (_, i) => [`a${i}`, `b${i}`])
  .flat()
  .filter((marker) => !left.includes(marker) || !right.includes(marker))
const converged = left === right && missing.length === 0
console.log(
  `충돌: ${converged ? 0 : 1}건 ` +
    (converged
      ? `(양쪽 ${left.length}자 일치, 동시 입력 ${rounds * 2}건 모두 남음)`
      : `(수렴 ${left === right} · 유실 ${missing.length}건: ${missing.slice(0, 8).join(',')})`),
)

const passed = report('변경 반영', textSamples) && report('커서 반영', cursorSamples) && converged
console.log(`\n대상: ${url}/${room}`)
a.provider.destroy()
b.provider.destroy()
process.exit(passed ? 0 : 1)
