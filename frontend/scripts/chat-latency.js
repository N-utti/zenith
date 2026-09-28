/**
 * 채팅 전달 시간 실측. 07 TC-CHT-01 "채널 메시지 송수신(2클라이언트) P95 ≤ 500ms"(NFR-04)의 게이트를
 * 숫자로 닫기 위한 계측기다. collab-latency.js 와 짝.
 *
 * 두 사람이 각자 /ws 소켓을 열고, A 가 msg 를 보낸 순간부터 B 에게 그 메시지의 ev:msg 가 도착할
 * 때까지를 잰다. 한 번에 하나씩 보낸다(도착을 기다린 뒤 다음). 큐 적체가 아니라 한 건의 왕복을 잰다.
 *
 *   node scripts/chat-latency.js                          # 개발 서버(npm run server, :1234)
 *   node scripts/chat-latency.js --url ws://<서버>/api/ws --channel <채널UUID> \
 *     --cookie-a "access=...; csrf=..." --cookie-b "access=...; csrf=..."
 *
 * 재는 것: 소켓 왕복(A 전송 → 서버 저장·중계 → B 수신). 재지 않는 것: 화면 렌더.
 * 보낸 메시지는 채널에 실제로 남는다. 운영 채널이 아니라 실측용 채널에 쏜다.
 */
import { WebSocket } from 'ws'

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

const url = arg('url', 'ws://localhost:1234/chat/ws')
const channel = arg('channel', 'c-dev')
// 개발 서버는 MSW 로그인이 심는 목 세션 쿠키로 사람을 가린다(scripts/chat.js). 백엔드는 로그인 쿠키.
const cookieA = arg('cookie-a', 'zenith.mock.session=u-1')
const cookieB = arg('cookie-b', 'zenith.mock.session=u-2')
const rounds = Number(arg('rounds', 100))
const LIMIT = 500

function open(label, cookie) {
  const ws = new WebSocket(url, { headers: { Cookie: cookie } })
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      // 열리자마자 붙인다. 서버가 거절을 오류 이벤트로 알리거나(멤버 아님·형식 오류) 연결 뒤에 닫으면
      // (개발 서버의 모르는 쿠키 4401, 세션 만료) 5초 시간 초과로 둔갑하지 않게 원인을 찍고 멈춘다.
      // 상대 소켓을 여는 동안 닫힐 수도 있어서 두 소켓이 다 열린 뒤가 아니라 여기서 붙인다.
      ws.on('message', (raw) => {
        const event = JSON.parse(raw)
        if (event.ev === 'error') {
          // 백엔드의 VALIDATION 은 detail 이 객체 배열이다.
          console.error(`[${label}] 서버 오류: ${event.code} ${JSON.stringify(event.detail ?? '')}`)
          process.exit(1)
        }
      })
      ws.on('close', (code) => {
        console.error(`[${label}] 닫힘 code=${code}`)
        process.exit(1)
      })
      resolve(ws)
    })
    ws.once('error', (error) =>
      reject(new Error(`[${label}] 연결 실패: ${url} (${error.message})`)),
    )
  })
}

const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]

const a = await open('A', cookieA)
const b = await open('B', cookieB)

const tag = `latency-${Date.now()}`
const samples = []
for (let round = 0; round < rounds; round += 1) {
  const body = `${tag} #${round}`
  const arrived = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${round}번 메시지가 5초 안에 오지 않았다`)),
      5000,
    )
    const onMessage = (raw) => {
      const event = JSON.parse(raw)
      if (event.ev === 'msg' && event.message?.body === body) {
        clearTimeout(timer)
        b.off('message', onMessage)
        resolve()
      }
    }
    b.on('message', onMessage)
  })
  const sentAt = performance.now()
  a.send(JSON.stringify({ op: 'msg', channel_id: channel, body }))
  await arrived
  samples.push(performance.now() - sentAt)
}

const p50 = percentile(samples, 0.5)
const p95 = percentile(samples, 0.95)
const max = Math.max(...samples)
console.log(
  `채팅 전달: p50 ${p50.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · 최악 ${max.toFixed(1)}ms ` +
    `(n=${samples.length}) → P95 ${LIMIT}ms 기준 ${p95 <= LIMIT ? '통과' : '초과'}`,
)
console.log(`\n대상: ${url} · 채널 ${channel}`)
a.close()
b.close()
process.exit(p95 <= LIMIT ? 0 : 1)
