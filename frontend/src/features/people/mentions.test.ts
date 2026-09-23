import { expect, it } from 'vitest'
import { insertMention, mentionQueryAt, splitMentions } from './mentions'

it('본문의 @이름 을 멘션 조각으로 나누고 끝 문장부호는 평문으로 남긴다', () => {
  expect(splitMentions('@정성운 확인 부탁, @진수연.')).toEqual([
    { text: '@정성운', mention: true },
    { text: ' 확인 부탁, ', mention: false },
    { text: '@진수연', mention: true },
    { text: '.', mention: false },
  ])
  // 이름 없는 @ 는 평문이다.
  expect(splitMentions('가격 @ 5천원')).toEqual([{ text: '가격 @ 5천원', mention: false }])
})

it('커서 앞의 @질의 를 찾는다: 처음·문장 중간·조합 중·메일 주소', () => {
  expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' })
  expect(mentionQueryAt('확인 @정성', 6)).toEqual({ start: 3, query: '정성' })
  // 한글 조합 중인 글자('ㅈ')도 값에 들어 있어 질의가 된다.
  expect(mentionQueryAt('줄바꿈\n@ㅈ', 6)).toEqual({ start: 4, query: 'ㅈ' })
  // 공백을 치면 멘션이 끝난다.
  expect(mentionQueryAt('@정성운 ', 5)).toBeNull()
  // 메일 주소의 @ 는 아니다.
  expect(mentionQueryAt('a@b', 3)).toBeNull()
  // 커서가 토큰 앞에 있으면 커서 앞만 본다.
  expect(mentionQueryAt('@정성 뒤', 3)).toEqual({ start: 0, query: '정성' })
})

it('고른 이름으로 바꾸고 커서를 공백 뒤에 둔다', () => {
  expect(insertMention('확인 @정', 5, 3, '정성운')).toEqual({ text: '확인 @정성운 ', caret: 8 })
  // 뒤에 공백이 있으면 더 넣지 않는다.
  expect(insertMention('@정 부탁', 2, 0, '정성운')).toEqual({ text: '@정성운 부탁', caret: 5 })
})
