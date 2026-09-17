import { expect, it } from 'vitest'
import { MOCK_USERS } from './db'
import { listMentionNotifications, listNotifications, markRead } from './notificationsDb'

const member = MOCK_USERS.find((u) => u.id === 'u-2')!
const exec = MOCK_USERS.find((u) => u.role === 'exec')!
// 모듈 전역 배열을 공유하고 리셋이 없다. 읽음 처리는 되돌릴 수 없으니 케이스를 더할 때 주의.

it('글 알림의 제목은 지금 등급으로 다시 판정해 가린다', () => {
  const execBoard = (user: typeof member) =>
    listNotifications(user).find((n) => n.payload?.board_id === 'exec')!

  // 알림을 만든 시점의 제목이 그대로 남아 있어도, 사원에게는 가려서 내려간다.
  expect(execBoard(member).payload).toMatchObject({ masked: true, title: '＿＿＿＿＿ 보고' })
  expect(execBoard(exec).payload?.masked).toBeUndefined()
  expect(execBoard(exec).payload?.title).toBe('4분기 예산안 검토 회의 자료')
})

it('읽음 처리는 안 읽은 것만 세고, 안 읽음 목록에서 빠진다', () => {
  const target = listNotifications(member, { unread: true })[0]
  expect(target).toBeDefined()

  expect(markRead([target.id])).toBe(1)
  // 이미 읽은 것을 다시 보내도 아무 일이 없다.
  expect(markRead([target.id])).toBe(0)
  expect(listNotifications(member, { unread: true }).some((n) => n.id === target.id)).toBe(false)
  expect(listNotifications(member).some((n) => n.id === target.id)).toBe(true)
})

it('홈 한 벌의 멘션은 알림 그대로다. 멘션 종류만 실린다', () => {
  const mentions = listMentionNotifications(member, 3)
  expect(mentions.length).toBeGreaterThan(0)
  // 허용 목록이다. 글 알림이나 앞으로 생길 근태·결재 알림이 섞이면 안 된다.
  expect(mentions.every((m) => ['mention', 'comment', 'reply'].includes(m.kind))).toBe(true)
  // 같은 사건이므로 알림 목록에도 그대로 있다. 두 벌이면 여기서 어긋난다.
  const ids = listNotifications(member).map((n) => n.id)
  expect(mentions.every((m) => ids.includes(m.id))).toBe(true)
})
