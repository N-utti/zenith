import { expect, it } from 'vitest'
import { countUnread, noticeToast, notificationView } from './view'
import type { Notification } from './types'

const base = { id: 'n', read_at: null, created_at: '2026-09-17T00:00:00Z' }
const from = { id: 'u-2', name: '정성운' }

function view(kind: string, payload: Notification['payload']) {
  return notificationView({ ...base, kind, payload })
}

it('같은 mention 이라도 payload 로 문서와 채팅이 갈린다', () => {
  expect(
    view('mention', { doc_id: 'd-1', doc_title: '로드맵', from, preview: '확인 부탁' }),
  ).toMatchObject({ to: '/docs/d-1', icon: 'doc', detail: '확인 부탁' })
  expect(view('mention', { channel_id: 'c-1', from, preview: '확인 부탁' })).toMatchObject({
    to: '/chat/c-1',
    icon: 'chat',
  })
  // comment·reply 도 payload 모양이 같다.
  expect(view('reply', { doc_id: 'd-1', from })?.to).toBe('/docs/d-1')
  // 댓글 멘션은 그 댓글로 간다.
  expect(view('mention', { doc_id: 'd-1', comment_id: 'dc-1', from })?.to).toBe(
    '/docs/d-1?comment=dc-1',
  )
})

it('채팅 멘션은 메시지 id 가 있으면 그 메시지로 간다', () => {
  expect(view('mention', { channel_id: 'c-1', message_id: 'm-9', from })?.to).toBe(
    '/chat/c-1?m=m-9',
  )
})

it('방금 온 알림의 OS 알림 문구. 채팅 멘션은 msg 가 이미 울리므로 뺀다', () => {
  expect(noticeToast({ kind: 'mention', payload: { channel_id: 'c-1', from } })).toBeNull()
  expect(
    noticeToast({
      kind: 'mention',
      payload: { doc_id: 'd-1', doc_title: '로드맵', from, preview: '확인 부탁' },
    }),
  ).toEqual({ title: '정성운님이 로드맵 문서에서 회원님을 불렀습니다', body: '확인 부탁' })
  expect(
    noticeToast({
      kind: 'post',
      payload: { post_id: 'p-1', board_id: 'all', board_name: '전체 공지', title: '공지', from },
    }),
  ).toEqual({ title: '공지', body: '전체 공지 · 정성운' })
  // 모르는 종류는 알림함이 못 그린다. 울리기만 하고 열 곳이 없으면 안 된다.
  expect(noticeToast({ kind: 'att_approved', payload: { from } })).toBeNull()
})

it('배지는 알림함이 그릴 수 있는 안 읽은 알림만 센다', () => {
  const mention = { kind: 'mention', payload: { channel_id: 'c-1', from } }
  expect(
    countUnread([
      { ...base, id: 'a', ...mention },
      { ...base, id: 'b', ...mention, read_at: '2026-09-17T01:00:00Z' },
      // 모르는 종류는 알림함에 안 보인다. 세면 배지와 목록이 어긋난다.
      { ...base, id: 'c', kind: 'att_approved', payload: { from } },
    ]),
  ).toBe(1)
})

it('채팅 멘션은 채널 이름을 요약에 넣는다. DM 은 넣지 않는다', () => {
  // 공개 채널이면 어느 채널인지 누르기 전에 알 수 있어야 한다.
  expect(view('mention', { channel_id: 'c-1', channel_name: '개발', from })?.summary).toBe(
    '정성운님이 개발 채널에서 회원님을 불렀습니다',
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
  const open = view('post', {
    post_id: 'p-1',
    board_id: 'all',
    board_name: '전체 공지',
    title: '공지',
    from,
  })
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
  // att_* 는 아직 서버가 만들지 않는다. 붙었을 때 화면이 죽으면 안 된다.
  // 문서 id 도 채널 id 도 없으니 멘션으로 흘려보내면 빈 링크가 된다.
  expect(view('att_approved', { from, doc_id: undefined })).toBeNull()
  expect(view('att_pending', { from, channel_id: 'c-1' })).toBeNull()
  // 결재 문서 id 가 없으면 갈 곳이 없다.
  expect(view('apv_request', { from, title: '품의' })).toBeNull()
  expect(view('post', { from })).toBeNull()
  expect(view('mention', null)).toBeNull()
})

it('결재 알림은 그 결재 문서로 간다. 요청과 결과 네 종류를 그린다', () => {
  const payload = {
    approval_id: 'a-1',
    type_code: 'general' as const,
    title: '거치대 구매 품의',
    from,
  }
  expect(view('apv_request', payload)).toMatchObject({
    summary: '거치대 구매 품의 결재 차례입니다',
    detail: '일반 기안 · 정성운',
    to: '/approvals/a-1',
    icon: 'approval',
  })
  expect(view('apv_approved', payload)?.summary).toBe('거치대 구매 품의 결재가 승인되었습니다')
  expect(view('apv_rejected', payload)?.summary).toBe('거치대 구매 품의 결재가 반려되었습니다')
  expect(view('apv_closed', payload)?.summary).toBe('거치대 구매 품의 결재가 강제 종결되었습니다')
  // 근태 신청의 결과도 이 종류로 온다.
  expect(view('apv_approved', { ...payload, type_code: 'leave' })?.detail).toBe('휴가 · 정성운')
  // 배지와 OS 알림에도 잡힌다.
  expect(countUnread([{ ...base, kind: 'apv_request', payload }])).toBe(1)
  expect(noticeToast({ kind: 'apv_request', payload })?.title).toBe(
    '거치대 구매 품의 결재 차례입니다',
  )
})
