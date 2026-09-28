import { describe, expect, it } from 'vitest'
import { findAccount, patchAccount } from './adminDb'
import { MOCK_USERS } from './db'
import {
  createActivity,
  createContact,
  createOrg,
  deleteActivity,
  deleteOrg,
  eraseContact,
  getOrg,
  listActivities,
  listOrgs,
  normalizeOrgName,
  updateActivity,
  updateOrg,
} from './crmDb'

const infra = MOCK_USERS.find((u) => u.id === 'u-4')! // 장지윤, 인프라 유치팀
const fund = MOCK_USERS.find((u) => u.id === 'u-5')! // 안재호, 펀드팀
const exec = MOCK_USERS.find((u) => u.id === 'u-11')!

/** 실패(`{error}`)면 던지고, 성공 쪽 타입으로 좁혀 돌려준다. */
const ok = <R extends object>(result: R): Exclude<R, { error: string }> => {
  if ('error' in result) throw new Error(String(result.error))
  return result as Exclude<R, { error: string }>
}

describe('CRM 목 저장소 (15 CRM 모듈 설계서 §4·§9)', () => {
  it('법인 표기·공백·대소문자가 달라도 같은 이름으로 본다', () => {
    expect(normalizeOrgName('(주)미래 인프라자산운용')).toBe(
      normalizeOrgName('미래인프라자산운용 주식회사'),
    )
    expect(normalizeOrgName('㈜ABC')).toBe(normalizeOrgName('abc'))
  })

  it('이름이 겹치는 기관도 등록은 되고, 겹친 기관을 알려 준다', () => {
    const made = ok(
      createOrg({ name: '미래인프라자산운용 주식회사', org_type: 'am', memo: '', owner_ids: [] }),
    )
    expect(made.duplicates.map((d) => d.id)).toContain('org-4')
    expect(getOrg(made.org.id)).toMatchObject({ name: '미래인프라자산운용 주식회사' })
  })

  it('이름·유형이 비었거나 비활성 계정을 창구로 두면 422', () => {
    expect(createOrg({ name: ' ', org_type: 'am', memo: '', owner_ids: [] })).toMatchObject({
      status: 422,
    })
    expect(
      createOrg({ name: '새 기관', org_type: 'am', memo: '', owner_ids: ['u-없음'] }),
    ).toMatchObject({ status: 422 })
  })

  it('퇴사한 창구가 남아 있어도 다른 칸은 고쳐지고, 퇴사자를 새로 앉히지는 못한다', () => {
    const made = ok(createOrg({ name: '창구 퇴사', org_type: 'etc', memo: '', owner_ids: ['u-7'] }))
    const leaver = findAccount('u-7')!
    patchAccount(leaver, { active: false })
    try {
      // 폼은 창구 목록을 통째로 다시 보낸다.
      expect(ok(updateOrg(made.org.id, { memo: '메모', owner_ids: ['u-7'] })).memo).toBe('메모')
      expect(updateOrg('org-5', { owner_ids: ['u-7'] })).toMatchObject({ status: 422 })
    } finally {
      patchAccount(leaver, { active: true })
    }
  })

  it('"N일 넘게 연락 없음" 은 기록이 없는 기관도 포함하고, 새 기록이 생기면 빠진다', () => {
    const stale = () => listOrgs({ staleDays: 90 }).map((o) => o.id)
    // 한결연금(3일 전 미팅)은 아니고, 다온생명(130일 전)과 세움은행(기록 없음)은 걸린다.
    expect(stale()).not.toContain('org-1')
    expect(stale()).toEqual(expect.arrayContaining(['org-3', 'org-5']))

    ok(
      createActivity(fund, {
        kind: 'call',
        occurred_at: new Date().toISOString(),
        org_id: 'org-3',
        contact_ids: [],
        user_ids: [fund.id],
        body: '재접촉',
      }),
    )
    expect(stale()).not.toContain('org-3')
  })

  it('활동의 외부 참석자는 그 기관 담당자만 된다', () => {
    const result = createActivity(infra, {
      kind: 'meeting',
      occurred_at: new Date().toISOString(),
      org_id: 'org-1',
      contact_ids: ['con-3'], // 누리공제회 소속
      user_ids: [],
      body: '다른 기관 사람을 섞음',
    })
    expect(result).toMatchObject({ status: 422 })
  })

  it('기관 없이 활동을 기록하면 400', () => {
    const result = createActivity(infra, {
      kind: 'memo',
      occurred_at: new Date().toISOString(),
      org_id: '',
      contact_ids: [],
      user_ids: [],
      body: '메모',
    })
    expect(result).toMatchObject({ status: 400 })
  })

  it('남의 활동 기록은 사원이 고치거나 지울 수 없고, 작성자와 임원은 된다', () => {
    const mine = ok(
      createActivity(infra, {
        kind: 'memo',
        occurred_at: new Date().toISOString(),
        org_id: 'org-1',
        contact_ids: [],
        user_ids: [],
        body: '내 메모',
      }),
    )
    expect(mine.can_edit).toBe(true)
    const seenByOther = ok(listActivities(fund, 'org-1')).find((a) => a.id === mine.id)
    expect(seenByOther?.can_edit).toBe(false)

    expect(updateActivity(fund, mine.id, { body: '남이 고침' })).toMatchObject({ status: 403 })
    expect(deleteActivity(fund, mine.id)).toMatchObject({ status: 403 })
    expect(ok(updateActivity(infra, mine.id, { body: '내가 고침' })).body).toBe('내가 고침')
    expect(deleteActivity(exec, mine.id)).toBeNull()
    expect(ok(listActivities(infra, 'org-1')).some((a) => a.id === mine.id)).toBe(false)
  })

  it('기관 삭제는 임원만, 사유가 있어야 한다', () => {
    const made = ok(createOrg({ name: '지울 기관', org_type: 'etc', memo: '', owner_ids: [] }))
    expect(deleteOrg(infra, made.org.id, '정리')).toMatchObject({ status: 403 })
    expect(deleteOrg(exec, made.org.id, '  ')).toMatchObject({ status: 400 })
    expect(deleteOrg(exec, made.org.id, '중복 등록')).toBeNull()
    expect(getOrg(made.org.id)).toMatchObject({ status: 404 })
    expect(listOrgs({}).some((o) => o.id === made.org.id)).toBe(false)
  })

  it('개인정보 삭제는 임원만. 연락처는 비우고 활동 기록의 참석자 자리는 남긴다', () => {
    const contact = ok(
      createContact({
        org_id: 'org-2',
        name: '지울사람',
        title: '과장',
        phone: '010-0000-0000',
        email: 'x@example.com',
        memo: '',
      }),
    )
    const act = ok(
      createActivity(fund, {
        kind: 'meeting',
        occurred_at: new Date().toISOString(),
        org_id: 'org-2',
        contact_ids: [contact.id],
        user_ids: [],
        body: '미팅',
      }),
    )

    expect(eraseContact(fund, contact.id)).toMatchObject({ status: 403 })
    const erased = ok(eraseContact(exec, contact.id))
    expect(erased).toMatchObject({ erased: true, name: '', phone: '', email: '' })

    const after = ok(listActivities(fund, 'org-2')).find((a) => a.id === act.id)
    expect(after?.contacts).toEqual([{ id: contact.id, name: '' }])
  })

  it('잘못된 이메일은 422', () => {
    expect(
      createContact({
        org_id: 'org-1',
        name: '홍길동',
        title: '',
        phone: '',
        email: 'x@',
        memo: '',
      }),
    ).toMatchObject({ status: 422 })
  })
})
