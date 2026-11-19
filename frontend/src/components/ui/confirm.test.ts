import { describe, expect, it } from 'vitest'
import { answerConfirm, askConfirm, getConfirmRequest } from './confirm'

const options = { title: '삭제할까요?', confirmLabel: '삭제' }

describe('askConfirm', () => {
  it('확인을 고르면 true, 닫으면 false 를 돌려주고 창을 내린다', async () => {
    const yes = askConfirm(options)
    expect(getConfirmRequest()?.title).toBe('삭제할까요?')
    answerConfirm(true)
    await expect(yes).resolves.toBe(true)
    expect(getConfirmRequest()).toBeNull()

    const no = askConfirm(options)
    answerConfirm(false)
    await expect(no).resolves.toBe(false)
  })

  it('떠 있는 창이 있는데 또 부르면 앞 창은 취소로 끝난다', async () => {
    const first = askConfirm(options)
    const second = askConfirm({ ...options, title: '다른 것' })
    await expect(first).resolves.toBe(false)
    expect(getConfirmRequest()?.title).toBe('다른 것')
    answerConfirm(true)
    await expect(second).resolves.toBe(true)
  })
})
