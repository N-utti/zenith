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

it('채팅 멘션은 채널 이름을 요약에 넣는다. DM 은 넣지 않는다', () => {
  // 공개 채널이면 어느 채널인지 누르기 전에 알 수 있어야 한다.
  expect(view('mention', { channel_id: 'c-1', channel_name: '개발', from })?.summary).toBe(
    '정성운님이 «개발»에서 회원님을 불렀습니다',
  )
  // DM 은 `channel_name` 이 `null`(#150).
  expect(view('mention', { channel_id: 'dm-1', channel_name: null, from })?.summary).toBe(
    '정성운님이 채팅에서 회원님을 불렀습니다',
  )
  // #150 이전에 쌓인 DM 알림 행에는 보낸 사람 이름이 들어 있다. 그것도 DM 으로 그린다.
  expect(view('mention', { channel_id: 'dm-1', channel_name: '정성운', from })?.summary).toBe(
    '정성운님이 채팅에서 회원님을 불렀습니다',
  )
  // 2026-09-18 이전에 쌓인 알림에는 채널 이름이 없다.
  expect(view('mention', { channel_id: 'c-1', from })?.summary).toBe(
    '정성운님이 채팅에서 회원님을 불렀습니다',
  )
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
  // 제목만 가리고 글쓴이를 남기면 누가 썼는지는 알려 주는 셈이다.
  expect(masked?.detail).toBe('경영 보고')
  expect(masked?.actorName).not.toBe('정성운')
  expect(masked?.actorId).toBe('')

  /*
   * 서버가 이미 지우고 보낸 경우(2026-09-18~). 가려진 분기는 원래 보낸 사람을 읽지 않으니
   * 이 단언은 로직이 아니라 `from: null` 을 타입이 받아들이는지를 지킨다(컴파일 시점).
   */
  const serverMasked = view('post', {
    post_id: 'p-6',
    board_id: 'exec',
    board_name: '경영 보고',
    title: '＿＿＿＿＿ 보고',
    masked: true,
    from: null,
  })
  expect(serverMasked).toMatchObject({ to: null, actorId: '', icon: 'locked' })
})

it('모르는 종류와 빈 payload 는 건너뛴다. 새 종류가 붙어도 목록이 깨지지 않는다', () => {
  // att_*·apv_* 는 아직 서버가 만들지 않는다. 붙었을 때 화면이 죽으면 안 된다.
  // 문서 id 도 채널 id 도 없으니 멘션으로 흘려보내면 빈 링크가 된다.
  expect(view('att_approved', { from, doc_id: undefined })).toBeNull()
  expect(view('apv_pending', { from, channel_id: 'c-1' })).toBeNull()
  expect(view('post', { from })).toBeNull()
  expect(view('mention', null)).toBeNull()
})
