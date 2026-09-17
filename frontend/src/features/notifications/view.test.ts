import { expect, it } from 'vitest'
import { notificationView } from './view'
import type { Notification } from './types'

const base = { id: 'n', read_at: null, created_at: '2026-09-17T00:00:00Z' }
const from = { id: 'u-2', name: '정성운' }

function view(kind: string, payload: Notification['payload']) {
  return notificationView({ ...base, kind, payload })
}

it('같은 mention 이라도 payload 로 문서와 채팅이 갈린다', () => {
  expect(view('mention', { doc_id: 'd-1', doc_title: '로드맵', from, preview: '확인 부탁' }))
    .toMatchObject({ to: '/docs/d-1', icon: 'doc', detail: '확인 부탁' })
  expect(view('mention', { channel_id: 'c-1', from, preview: '확인 부탁' })).toMatchObject({
    to: '/chat/c-1',
    icon: 'chat',
  })
  // comment·reply 도 payload 모양이 같다.
  expect(view('reply', { doc_id: 'd-1', from })?.to).toBe('/docs/d-1')
})

it('권한 밖이라 가려진 글 알림은 누를 수 없다', () => {
  const open = view('post', { post_id: 'p-1', board_id: 'all', board_name: '전체 공지', title: '공지', from })
  expect(open).toMatchObject({ to: '/board/all/p-1', icon: 'board' })

  const masked = view('post', {
    post_id: 'p-6',
    board_id: 'exec',
    board_name: '경영 보고',
    title: '＿＿＿＿＿ 보고',
    masked: true,
    from,
  })
  expect(masked?.to).toBeNull()
  expect(masked?.summary).toBe('＿＿＿＿＿ 보고')
})

it('모르는 종류와 빈 payload 는 건너뛴다. 새 종류가 붙어도 목록이 깨지지 않는다', () => {
  // att_*·apv_* 는 아직 서버가 만들지 않는다. 붙었을 때 화면이 죽으면 안 된다.
  expect(view('att_approved', { from })).toBeNull()
  expect(view('post', { from })).toBeNull()
  expect(view('mention', null)).toBeNull()
})
