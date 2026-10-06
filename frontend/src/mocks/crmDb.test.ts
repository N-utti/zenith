import { describe, expect, it, vi } from 'vitest'
import { IMPORT_UNDO_HOURS } from '@/features/crm/types'
import { findAccount, patchAccount } from './adminDb'
import { MOCK_USERS } from './db'
import {
  createActivity,
  createContact,
  createDeal,
  createOrg,
  deleteActivity,
  deleteContact,
  deleteDeal,
  deleteOrg,
  dropDeal,
  eraseContact,
  exportRows,
  getDeal,
  listDeals,
  listDeletedOrgs,
  reopenDeal,
  restoreOrg,
  undoImport,
  updateDeal,
  getOrg,
  importContacts,
  lastImport,
  listActivities,
  listOrgs,
  normalizeOrgName,
  updateActivity,
  updateContact,
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
      createOrg(infra, {
        name: '미래인프라자산운용 주식회사',
        org_type: 'am',
        memo: '',
        owner_ids: [],
      }),
    )
    expect(made.duplicates.map((d) => d.id)).toContain('org-4')
    expect(getOrg(infra, made.org.id)).toMatchObject({ name: '미래인프라자산운용 주식회사' })
  })

  it('이름·유형이 비었거나 비활성 계정을 창구로 두면 422', () => {
    expect(createOrg(infra, { name: ' ', org_type: 'am', memo: '', owner_ids: [] })).toMatchObject({
      status: 422,
    })
    expect(
      createOrg(infra, { name: '새 기관', org_type: 'am', memo: '', owner_ids: ['u-없음'] }),
    ).toMatchObject({ status: 422 })
  })

  it('퇴사한 창구가 남아 있어도 다른 칸은 고쳐지고, 퇴사자를 새로 앉히지는 못한다', () => {
    const made = ok(
      createOrg(infra, { name: '창구 퇴사', org_type: 'etc', memo: '', owner_ids: ['u-7'] }),
    )
    const leaver = findAccount('u-7')!
    patchAccount(leaver, { active: false })
    try {
      // 폼은 창구 목록을 통째로 다시 보낸다.
      expect(ok(updateOrg(infra, made.org.id, { memo: '메모', owner_ids: ['u-7'] })).memo).toBe(
        '메모',
      )
      expect(updateOrg(infra, 'org-5', { owner_ids: ['u-7'] })).toMatchObject({ status: 422 })
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
        deal_id: null,
        contact_ids: [],
        user_ids: [fund.id],
        body: '재접촉',
      }),
    )
    expect(stale()).not.toContain('org-3')
  })

  it('앞으로의 일시는 기록하지 못한다. 마지막 연락일이 앞당겨져 위 필터를 속인다', () => {
    const at = (ms: number) => new Date(Date.now() + ms).toISOString()
    // 시드 기관을 쓰면 다른 테스트의 「연락 없음」 판정이 흔들린다. 자기 기관을 만든다.
    const made = ok(
      createOrg(infra, { name: '미래 기록 기관', org_type: 'etc', memo: '', owner_ids: [] }),
    )
    const input = {
      kind: 'call' as const,
      org_id: made.org.id,
      deal_id: null,
      contact_ids: [],
      user_ids: [],
      body: '예정',
    }
    expect(createActivity(fund, { ...input, occurred_at: at(86_400_000) })).toMatchObject({
      status: 422,
    })
    // 기기 시계가 조금 빠른 것은 봐준다.
    const act = ok(createActivity(fund, { ...input, occurred_at: at(60_000) }))
    expect(updateActivity(fund, act.id, { occurred_at: at(86_400_000) })).toMatchObject({
      status: 422,
    })
  })

  it('활동의 외부 참석자는 그 기관 담당자만 된다', () => {
    const result = createActivity(infra, {
      kind: 'meeting',
      occurred_at: new Date().toISOString(),
      org_id: 'org-1',
      deal_id: null,
      contact_ids: ['con-3'], // 누리공제회 소속
      user_ids: [],
      body: '다른 기관 사람을 섞음',
    })
    expect(result).toMatchObject({ status: 422 })
  })

  it('기관 없이 활동을 기록하면 422', () => {
    const result = createActivity(infra, {
      kind: 'memo',
      occurred_at: new Date().toISOString(),
      org_id: '',
      deal_id: null,
      contact_ids: [],
      user_ids: [],
      body: '메모',
    })
    expect(result).toMatchObject({ status: 422 })
  })

  it('남의 활동 기록은 사원이 고치거나 지울 수 없고, 작성자와 임원은 된다', () => {
    const mine = ok(
      createActivity(infra, {
        kind: 'memo',
        occurred_at: new Date().toISOString(),
        org_id: 'org-1',
        deal_id: null,
        contact_ids: [],
        user_ids: [],
        body: '내 메모',
      }),
    )
    expect(mine.can_edit).toBe(true)
    const seenByOther = ok(listActivities(fund, { orgId: 'org-1' })).find((a) => a.id === mine.id)
    expect(seenByOther?.can_edit).toBe(false)

    expect(updateActivity(fund, mine.id, { body: '남이 고침' })).toMatchObject({ status: 403 })
    expect(deleteActivity(fund, mine.id)).toMatchObject({ status: 403 })
    expect(ok(updateActivity(infra, mine.id, { body: '내가 고침' })).body).toBe('내가 고침')
    expect(deleteActivity(exec, mine.id)).toBeNull()
    expect(ok(listActivities(infra, { orgId: 'org-1' })).some((a) => a.id === mine.id)).toBe(false)
  })

  it('기관 삭제는 임원만, 사유가 있어야 한다', () => {
    const made = ok(
      createOrg(infra, { name: '지울 기관', org_type: 'etc', memo: '', owner_ids: [] }),
    )
    expect(deleteOrg(infra, made.org.id, '정리')).toMatchObject({ status: 403 })
    expect(deleteOrg(exec, made.org.id, '  ')).toMatchObject({ status: 422 })
    // 서버의 사유 상한(500자). 목이 받아 주면 실서버에서만 거절당한다.
    expect(deleteOrg(exec, made.org.id, 'x'.repeat(501))).toMatchObject({ status: 422 })
    expect(deleteOrg(exec, made.org.id, '중복 등록')).toBeNull()
    expect(getOrg(infra, made.org.id)).toMatchObject({ status: 404 })
    expect(listOrgs({}).some((o) => o.id === made.org.id)).toBe(false)
  })

  it('담당자의 이름·직함·전화·이메일은 칸마다 200자까지다(서버와 같은 상한)', () => {
    const base = { org_id: 'org-2', name: '길이', title: '', phone: '', email: '', memo: '' }
    expect(createContact(infra, { ...base, title: 'x'.repeat(201) })).toMatchObject({ status: 422 })
    expect(createContact(infra, { ...base, title: 'x'.repeat(200) })).not.toHaveProperty('error')
  })

  it('개인정보 삭제는 임원만. 연락처는 비우고 활동 기록의 참석자 자리는 남긴다', () => {
    const contact = ok(
      createContact(infra, {
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
        deal_id: null,
        contact_ids: [contact.id],
        user_ids: [],
        body: '미팅',
      }),
    )

    expect(eraseContact(fund, contact.id)).toMatchObject({ status: 403 })
    const erased = ok(eraseContact(exec, contact.id))
    expect(erased).toMatchObject({ erased: true, name: '', phone: '', email: '' })

    const after = ok(listActivities(fund, { orgId: 'org-2' })).find((a) => a.id === act.id)
    expect(after?.contacts).toEqual([{ id: contact.id, name: '' }])
    // 행은 남지만 담당자 수에는 넣지 않는다(내보내기와 같은 기준).
    const count = () => listOrgs({}).find((o) => o.id === 'org-2')!.contact_count
    const before = ok(getOrg(infra, 'org-2')).contacts.length
    expect(count()).toBe(before - 1)
  })

  it('담당자 기관을 바꾸면 이직 이력이 남고, 옛 활동 기록은 이전 기관에 그대로 있다', () => {
    const contact = ok(
      createContact(infra, {
        org_id: 'org-1',
        name: '옮길사람',
        title: '',
        phone: '',
        email: '',
        memo: '',
      }),
    )
    const act = ok(
      createActivity(infra, {
        kind: 'call',
        occurred_at: new Date().toISOString(),
        org_id: 'org-1',
        deal_id: null,
        contact_ids: [contact.id],
        user_ids: [],
        body: '통화',
      }),
    )

    expect(updateContact(infra, contact.id, { org_id: 'org-없음' })).toMatchObject({ status: 422 })
    const moved = ok(updateContact(infra, contact.id, { org_id: 'org-2' }))
    expect(moved.org_id).toBe('org-2')
    expect(moved.moves).toEqual([
      { from: { id: 'org-1', name: '한결연금공단' }, moved_at: expect.any(String) },
    ])
    expect(ok(getOrg(infra, 'org-1')).contacts.some((c) => c.id === contact.id)).toBe(false)
    expect(ok(getOrg(infra, 'org-2')).contacts.some((c) => c.id === contact.id)).toBe(true)

    // 기록은 한결연금공단 타임라인에 남고, 이미 참석자였던 사람이라 그대로 두고 고칠 수 있다.
    const timeline = ok(listActivities(infra, { orgId: 'org-1' }))
    expect(timeline.some((a) => a.id === act.id)).toBe(true)
    expect(
      updateActivity(infra, act.id, { contact_ids: [contact.id], body: '통화 수정' }),
    ).not.toHaveProperty('error')
    // 다른 기관 사람을 새로 넣는 건 여전히 막는다.
    expect(updateActivity(infra, act.id, { contact_ids: [contact.id, 'con-5'] })).toMatchObject({
      status: 422,
    })
  })

  it('내보내기는 지운 기관·개인정보를 지운 담당자를 빼고, 금액은 숫자로 낸다 (FR-CRM-32)', () => {
    const gone = ok(
      createOrg(infra, { name: '지워질 기관', org_type: 'etc', memo: '', owner_ids: [] }),
    )
    const erased = ok(
      createContact(infra, {
        org_id: 'org-3',
        name: '지울사람2',
        title: '',
        phone: '',
        email: '',
        memo: '',
      }),
    )
    ok(eraseContact(exec, erased.id))
    expect(deleteOrg(exec, gone.org.id, '정리')).toBeNull()

    const orgRows = ok(exportRows('orgs')).rows
    expect(orgRows[0][0]).toBe('기관')
    expect(orgRows.some((r) => r[0] === '지워질 기관')).toBe(false)
    expect(orgRows.find((r) => r[0] === '한결연금공단')?.[1]).toBe('연기금')

    const contactRows = ok(exportRows('contacts')).rows
    expect(contactRows.some((r) => r[1] === '')).toBe(false)
    // 기관 시트의 담당자 수는 담당자 시트 행 수와 같다(지운 사람은 둘 다에서 빠진다).
    const daon = orgRows.find((r) => r[0] === '다온생명보험')!
    expect(daon[3]).toBe(contactRows.filter((r) => r[0] === '다온생명보험').length)

    const deals = ok(exportRows('deals'))
    const dealRows = deals.rows
    const amountCol = dealRows[0].indexOf('금액(원)')
    expect(deals.integerCols).toEqual([amountCol])
    expect(dealRows.slice(1).some((r) => typeof r[amountCol] === 'number')).toBe(true)

    expect(exportRows('users')).toMatchObject({ status: 422 })
  })

  it('잘못된 이메일은 422', () => {
    expect(
      createContact(infra, {
        org_id: 'org-1',
        name: '홍길동',
        title: '',
        phone: '',
        email: 'x@',
        memo: '',
      }),
    ).toMatchObject({ status: 422 })
  })

  describe('안건 (15 §2.2 · §6)', () => {
    const newDeal = () =>
      ok(
        createDeal(fund, {
          kind: 'investment',
          name: '테스트 안건',
          org_id: 'org-4',
          owner_id: fund.id,
          amount_krw: 10_000_000_000,
          target_date: null,
          next_action: '',
          next_action_due: null,
        }),
      )

    it('첫 단계에서 시작하고, 앞뒤로 옮길 수 있고, 옮길 때마다 이력이 남는다', () => {
      const deal = newDeal()
      expect(deal).toMatchObject({ stage: 'sourcing', status: 'open', version: 1 })
      const forward = ok(updateDeal(fund, deal.id, { stage: 'diligence', version: 1 }))
      const back = ok(updateDeal(fund, deal.id, { stage: 'screening', version: forward.version }))
      expect(back.stage).toBe('screening')
      expect(back.events.map((e) => [e.from_stage, e.to_stage])).toEqual([
        ['diligence', 'screening'],
        ['sourcing', 'diligence'],
        [null, 'sourcing'],
      ])
    })

    it('같은 version 으로 두 번 옮기면 나중 것은 409', () => {
      const deal = newDeal()
      ok(updateDeal(fund, deal.id, { stage: 'screening', version: 1 }))
      expect(updateDeal(infra, deal.id, { stage: 'diligence', version: 1 })).toMatchObject({
        status: 409,
      })
    })

    it('마지막 단계에 닿으면 성사로 끝나고 보드(진행 중)에서 빠진다. 끝난 안건은 옮길 수 없다', () => {
      const deal = newDeal()
      const won = ok(updateDeal(fund, deal.id, { stage: 'closed', version: 1 }))
      expect(won).toMatchObject({ status: 'won' })
      expect(won.closed_at).not.toBeNull()
      expect(listDeals({ kind: 'investment', status: 'open' }).map((d) => d.id)).not.toContain(
        deal.id,
      )
      expect(updateDeal(fund, deal.id, { stage: 'sourcing', version: won.version })).toMatchObject({
        status: 409,
      })
      expect(reopenDeal(fund, deal.id, { version: won.version })).toMatchObject({ status: 409 })
    })

    it('잘못 성사 처리한 안건은 임원이 단계를 옮겨 진행 중으로 되돌린다 (15 §6)', () => {
      const deal = newDeal()
      const won = ok(updateDeal(fund, deal.id, { stage: 'closed', version: 1 }))
      const back = ok(updateDeal(exec, deal.id, { stage: 'diligence', version: won.version }))
      expect(back).toMatchObject({ status: 'open', stage: 'diligence', closed_at: null })
      expect(back.events.map((e) => [e.from_stage, e.to_stage])[0]).toEqual(['closed', 'diligence'])
    })

    it('중단된 안건은 임원이어도 단계를 옮기지 못한다. 재개로 연다', () => {
      const deal = newDeal()
      const dropped = ok(dropDeal(fund, deal.id, { reason: '보류', version: 1 }))
      expect(
        updateDeal(exec, deal.id, { stage: 'screening', version: dropped.version }),
      ).toMatchObject({ status: 409 })
    })

    it('다음 할 일 없이 기한만 두면 422. 할 일을 지울 때 기한도 같이 지우면 된다', () => {
      const deal = ok(
        updateDeal(fund, newDeal().id, {
          next_action: '실사 자료 요청',
          next_action_due: '2026-10-03',
          version: 1,
        }),
      )
      expect(updateDeal(fund, deal.id, { next_action: ' ', version: deal.version })).toMatchObject({
        status: 422,
      })
      expect(
        ok(
          updateDeal(fund, deal.id, {
            next_action: '',
            next_action_due: null,
            version: deal.version,
          }),
        ),
      ).toMatchObject({ next_action: '', next_action_due: null })
    })

    it('중단은 사유가 없으면 422, 재개하면 같은 안건으로 돌아온다', () => {
      const deal = newDeal()
      expect(dropDeal(fund, deal.id, { reason: ' ', version: 1 })).toMatchObject({ status: 422 })
      expect(dropDeal(fund, deal.id, { reason: 'x'.repeat(501), version: 1 })).toMatchObject({
        status: 422,
      })
      // 다음 할 일은 500자까지(서버 `NextAction`).
      expect(updateDeal(fund, deal.id, { next_action: 'x'.repeat(501), version: 1 })).toMatchObject(
        {
          status: 422,
        },
      )
      const dropped = ok(dropDeal(fund, deal.id, { reason: '조건 불일치', version: 1 }))
      expect(dropped).toMatchObject({ status: 'dropped', drop_reason: '조건 불일치' })
      const back = ok(reopenDeal(infra, deal.id, { version: dropped.version }))
      expect(back).toMatchObject({ id: deal.id, status: 'open', drop_reason: null })
      expect(back.events.map((e) => e.action).slice(0, 2)).toEqual(['reopen', 'drop'])
    })

    it('없는 단계·음수 금액은 422', () => {
      const deal = newDeal()
      expect(updateDeal(fund, deal.id, { stage: 'contact', version: 1 })).toMatchObject({
        status: 422,
      })
      expect(updateDeal(fund, deal.id, { amount_krw: -1, version: 1 })).toMatchObject({
        status: 422,
      })
    })

    it('활동은 그 기관의 안건에만 걸리고, 안건과 기관 타임라인 양쪽에 뜬다', () => {
      const deal = newDeal()
      const base = {
        kind: 'memo' as const,
        occurred_at: new Date().toISOString(),
        contact_ids: [],
        user_ids: [],
        body: '안건 메모',
      }
      expect(createActivity(fund, { ...base, org_id: 'org-1', deal_id: deal.id })).toMatchObject({
        status: 422,
      })
      const act = ok(createActivity(fund, { ...base, org_id: 'org-4', deal_id: deal.id }))
      expect(act.deal).toEqual({ id: deal.id, name: '테스트 안건' })
      const onDeal = ok(listActivities(fund, { dealId: deal.id })).map((a) => a.id)
      const onOrg = ok(listActivities(fund, { orgId: 'org-4' })).map((a) => a.id)
      expect(onDeal).toContain(act.id)
      expect(onOrg).toContain(act.id)
    })

    it('진행 중 안건이 있는 기관은 409, 안건이 끝나면 지워지고 안건·타임라인도 같이 숨는다', () => {
      const made = ok(
        createOrg(infra, { name: '곧 지울 기관', org_type: 'etc', memo: '', owner_ids: [] }),
      )
      const deal = ok(
        createDeal(fund, {
          kind: 'fundraising',
          name: '딸린 안건',
          org_id: made.org.id,
          owner_id: null,
          amount_krw: null,
          target_date: null,
          next_action: '',
          next_action_due: null,
        }),
      )
      expect(deleteOrg(exec, made.org.id, '정리')).toMatchObject({ status: 409 })
      expect(getDeal(infra, deal.id)).toMatchObject({ status: 'open' })
      ok(dropDeal(fund, deal.id, { reason: '정리', version: 1 }))
      expect(deleteOrg(exec, made.org.id, '정리')).toBeNull()
      expect(getDeal(infra, deal.id)).toMatchObject({ status: 404 })
      expect(listDeals({}).some((d) => d.id === deal.id)).toBe(false)
      expect(listActivities(fund, { dealId: deal.id })).toMatchObject({ status: 404 })

      // 성사로 끝난 안건만 남은 기관도 지워진다. 막는 것은 진행 중 안건뿐이다.
      const other = ok(
        createOrg(infra, { name: '성사 기관', org_type: 'etc', memo: '', owner_ids: [] }),
      )
      const done = ok(
        createDeal(fund, {
          kind: 'investment',
          name: '끝난 안건',
          org_id: other.org.id,
          owner_id: null,
          amount_krw: null,
          target_date: null,
          next_action: '',
          next_action_due: null,
        }),
      )
      ok(updateDeal(fund, done.id, { stage: 'closed', version: 1 }))
      expect(deleteOrg(exec, other.org.id, '정리')).toBeNull()
    })
  })
  it('CSV 가져오기: 미리보기는 아무것도 만들지 않고, 반영은 오류 행만 빼고 만든다 (FR-CRM-05)', () => {
    const existing = ok(
      createOrg(infra, { name: '(주)가져오기자산운용', org_type: 'am', memo: '', owner_ids: [] }),
    )
    ok(
      createContact(infra, {
        org_id: existing.org.id,
        name: '기존인',
        title: '',
        phone: '',
        email: '',
        memo: '',
      }),
    )
    const rows = [
      ['기관', '유형', '이름', '이메일'],
      ['가져오기자산운용', '', '기존인', ''], // 정규화 이름으로 기존 기관에 붙고, 담당자는 이미 있다
      ['가져오기자산운용 주식회사', '', '새사람', 'new@x.kr'],
      ['새가져오기공제회', '공제회', '', ''], // 기관만
      ['새가져오기공제회', '', '둘째', ''], // 파일 안에서 앞 줄 기관에 붙는다
      ['오류기관', '연금', '누구', ''],
      ['', '', '이름만', ''],
      ['', '', '', ''], // 엑셀이 빈 행을 ,,, 로 저장한다. 건너뛰되 줄 번호는 센다
      ['메일오류', '', '누구', 'not-mail'],
      ['가져오기자산운용', '', '', ''], // 기관만 있는 행인데 기관이 이미 있다
    ]
    const before = listOrgs({}).length
    const preview = ok(importContacts(infra, rows, true))
    expect(listOrgs({}).length).toBe(before)
    expect(preview.rows.map((r) => [r.line, r.status])).toEqual([
      [2, 'skip'],
      [3, 'ok'],
      [4, 'ok'],
      [5, 'ok'],
      [6, 'error'],
      [7, 'error'],
      [9, 'error'],
      [10, 'skip'],
    ])
    expect(preview.rows[1].note).toContain('(주)가져오기자산운용')
    expect(preview).toMatchObject({ new_orgs: 1, new_contacts: 2 })

    const done = ok(importContacts(infra, rows, false))
    expect(done).toMatchObject({ new_orgs: 1, new_contacts: 2 })
    expect(listOrgs({}).length).toBe(before + 1)
    expect(getOrg(infra, existing.org.id)).toMatchObject({ contact_count: 2 })
    const created = listOrgs({ q: '새가져오기공제회' })
    expect(created).toMatchObject([{ org_type: 'mutual_aid', contact_count: 1 }])
  })

  it('CSV 가져오기: 기관 칸이 없는 파일은 통째로 거절한다', () => {
    expect(importContacts(infra, [['이름'], ['누구']], true)).toMatchObject({ status: 422 })
  })
})

describe('CRM 지우기 (15 §9 에 없는 경로. 등록한 사람은 활동 기록이 붙기 전까지, 임원은 언제나)', () => {
  const record = (extra: { deal_id?: string | null; contact_ids?: string[] }) =>
    ok(
      createActivity(fund, {
        kind: 'memo',
        occurred_at: new Date().toISOString(),
        org_id: 'org-4',
        deal_id: null,
        contact_ids: [],
        user_ids: [],
        body: '기록',
        ...extra,
      }),
    )

  it('안건: 지우면 보드에서 빠지고, 붙어 있던 활동 기록은 기관에 남는다', () => {
    const made = () =>
      ok(
        createDeal(fund, {
          kind: 'investment',
          name: '지울 안건',
          org_id: 'org-4',
          owner_id: null,
          amount_krw: null,
          target_date: null,
          next_action: '',
          next_action_due: null,
        }),
      )
    const fresh = made()
    expect(fresh.can_delete).toBe(true)
    // 남은 못 지운다.
    expect(ok(getDeal(infra, fresh.id)).can_delete).toBe(false)
    expect(deleteDeal(infra, fresh.id)).toMatchObject({ status: 403 })
    expect(deleteDeal(fund, fresh.id)).toBeNull()
    expect(getDeal(fund, fresh.id)).toMatchObject({ status: 404 })
    expect(listDeals({ orgId: 'org-4' }).some((d) => d.id === fresh.id)).toBe(false)
    expect(deleteDeal(fund, fresh.id)).toMatchObject({ status: 404 })

    // 활동 기록이 붙으면 등록한 사람도 못 지운다. 임원은 지운다.
    const used = made()
    const activity = record({ deal_id: used.id })
    expect(ok(getDeal(fund, used.id)).can_delete).toBe(false)
    expect(deleteDeal(fund, used.id)).toMatchObject({ status: 403 })
    expect(ok(getDeal(exec, used.id)).can_delete).toBe(true)
    expect(deleteDeal(exec, used.id)).toBeNull()
    const left = ok(listActivities(fund, { orgId: 'org-4' })).find((a) => a.id === activity.id)
    expect(left).toMatchObject({ deal: null })
    // 낡은 화면이 지운 안건의 id 를 그대로 다시 보내도 고칠 수 있다(안건을 바꾸는 것이 아니다).
    expect(
      ok(updateActivity(fund, activity.id, { body: '고친 기록', deal_id: used.id })).body,
    ).toBe('고친 기록')
    expect(ok(exportRows('deals')).rows.some((row) => row[1] === '지울 안건')).toBe(false)
  })

  it('담당자: 지우면 목록과 수에서 빠지고, 활동 기록의 참석자 이름은 남는다', () => {
    const made = (name: string) =>
      ok(createContact(fund, { org_id: 'org-4', name, title: '', phone: '', email: '', memo: '' }))
    const fresh = made('잘못 넣은 사람')
    expect(fresh.can_delete).toBe(true)
    expect(deleteContact(infra, fresh.id)).toMatchObject({ status: 403 })
    expect(deleteContact(fund, fresh.id)).toBeNull()
    expect(ok(getOrg(fund, 'org-4')).contacts.some((c) => c.id === fresh.id)).toBe(false)
    expect(deleteContact(fund, fresh.id)).toMatchObject({ status: 404 })
    expect(updateContact(fund, fresh.id, { title: '부장' })).toMatchObject({ status: 404 })

    const used = made('기록에 붙은 사람')
    const activity = record({ contact_ids: [used.id] })
    expect(deleteContact(fund, used.id)).toMatchObject({ status: 403 })
    const before = ok(getOrg(fund, 'org-4')).contact_count
    expect(deleteContact(exec, used.id)).toBeNull()
    expect(ok(getOrg(fund, 'org-4')).contact_count).toBe(before - 1)
    const left = ok(listActivities(fund, { orgId: 'org-4' })).find((a) => a.id === activity.id)
    expect(left?.contacts).toEqual([{ id: used.id, name: '기록에 붙은 사람' }])

    // 시드 담당자는 등록한 사람이 없다. 임원만 지운다.
    const seeded = ok(getOrg(fund, 'org-1')).contacts
    expect(seeded.length).toBeGreaterThan(0)
    expect(seeded.every((c) => !c.can_delete)).toBe(true)
    expect(ok(getOrg(exec, 'org-1')).contacts.every((c) => c.can_delete)).toBe(true)

    // 지운 담당자는 새 활동 기록에 붙일 수 없다. 개인정보 삭제는 지운 뒤에도 된다(이름이 기록에
    // 남아 있어서다).
    expect(
      createActivity(fund, {
        kind: 'memo',
        occurred_at: new Date().toISOString(),
        org_id: 'org-4',
        deal_id: null,
        contact_ids: [used.id],
        user_ids: [],
        body: '지운 사람을 다시 붙임',
      }),
    ).toMatchObject({ status: 422 })
    expect(ok(eraseContact(exec, used.id))).toMatchObject({ name: '', erased: true })
    const erased = ok(listActivities(fund, { orgId: 'org-4' })).find((a) => a.id === activity.id)
    expect(erased?.contacts).toEqual([{ id: used.id, name: '' }])
  })
})

describe('지운 기관 되살리기 (15 §9 에 없는 경로. 임원만)', () => {
  it('되살리면 담당자·안건·활동 기록이 그대로 돌아온다', () => {
    const made = ok(
      createOrg(infra, { name: '되살릴 기관', org_type: 'etc', memo: '', owner_ids: [] }),
    )
    const id = made.org.id
    const contact = ok(
      createContact(infra, {
        org_id: id,
        name: '남을 사람',
        title: '',
        phone: '',
        email: '',
        memo: '',
      }),
    )
    const deal = ok(
      createDeal(infra, {
        kind: 'investment',
        name: '남을 안건',
        org_id: id,
        owner_id: null,
        amount_krw: null,
        target_date: null,
        next_action: '',
        next_action_due: null,
      }),
    )
    // 진행 중 안건이 있으면 기관을 지울 수 없다. 중단해 둔다.
    ok(dropDeal(infra, deal.id, { reason: '보류', version: deal.version }))
    ok(
      createActivity(infra, {
        kind: 'memo',
        occurred_at: new Date().toISOString(),
        org_id: id,
        deal_id: deal.id,
        contact_ids: [contact.id],
        user_ids: [],
        body: '남을 기록',
      }),
    )
    expect(deleteOrg(exec, id, '잘못 등록')).toBeNull()

    // 지운 기관 목록은 임원만 본다. 사유가 같이 온다.
    expect(listDeletedOrgs(infra)).toMatchObject({ status: 403 })
    expect(ok(listDeletedOrgs(exec)).find((o) => o.id === id)).toMatchObject({
      name: '되살릴 기관',
      reason: '잘못 등록',
      duplicate: null,
    })

    expect(restoreOrg(infra, id)).toMatchObject({ status: 403 })
    const back = ok(restoreOrg(exec, id))
    expect(back.contacts.map((c) => c.name)).toEqual(['남을 사람'])
    expect(listDeals({ orgId: id }).map((d) => d.name)).toEqual(['남을 안건'])
    expect(ok(listActivities(infra, { orgId: id })).map((a) => a.body)).toEqual(['남을 기록'])
    expect(ok(listDeletedOrgs(exec)).some((o) => o.id === id)).toBe(false)
    // 살아 있는 기관은 되살릴 것이 없다.
    expect(restoreOrg(exec, id)).toMatchObject({ status: 404 })
  })

  it('그사이 같은 이름의 기관이 생겼으면 알려 주되 되살리기를 막지 않는다', () => {
    const first = ok(
      createOrg(infra, { name: '(주)쌍둥이운용', org_type: 'am', memo: '', owner_ids: [] }),
    )
    expect(deleteOrg(exec, first.org.id, '중복')).toBeNull()
    const second = ok(
      createOrg(infra, { name: '쌍둥이운용 주식회사', org_type: 'am', memo: '', owner_ids: [] }),
    )
    expect(ok(listDeletedOrgs(exec)).find((o) => o.id === first.org.id)?.duplicate).toEqual({
      id: second.org.id,
      name: '쌍둥이운용 주식회사',
    })
    expect(ok(restoreOrg(exec, first.org.id)).name).toBe('(주)쌍둥이운용')
  })
})

describe('가져오기 되돌리기 (15 §9 에 없는 경로. 가져온 사람만, 하루 안에)', () => {
  const activityOn = (orgId: string, contactIds: string[]) =>
    ok(
      createActivity(fund, {
        kind: 'memo',
        occurred_at: new Date().toISOString(),
        org_id: orgId,
        deal_id: null,
        contact_ids: contactIds,
        user_ids: [],
        body: '벌써 연락함',
      }),
    )
  const orgNamed = (name: string) => listOrgs({ q: name })[0]!

  it('바로 되돌리면 그때 만든 기관과 담당자가 사라진다. 미리보기는 기록을 남기지 않는다', () => {
    const rows = [
      ['기관', '이름'],
      ['되돌릴 기관', '가'],
      ['되돌릴 기관', '나'],
      ['한결연금공단', '다'],
    ]
    ok(importContacts(fund, rows, true))
    expect(lastImport(fund)).toBeNull()

    const before = ok(getOrg(fund, 'org-1')).contact_count
    ok(importContacts(fund, rows, false))
    const last = lastImport(fund)!
    expect(last).toMatchObject({ new_orgs: 1, new_contacts: 3 })
    // 남의 가져오기는 보이지 않고 되돌릴 수도 없다. 임원도 그렇다.
    expect(lastImport(infra)?.id).not.toBe(last.id)
    expect(undoImport(infra, last.id)).toMatchObject({ status: 403 })
    expect(undoImport(exec, last.id)).toMatchObject({ status: 403 })

    expect(ok(undoImport(fund, last.id))).toEqual({
      removed_orgs: 1,
      removed_contacts: 3,
      kept_orgs: 0,
      kept_contacts: 0,
    })
    expect(listOrgs({ q: '되돌릴 기관' })).toEqual([])
    expect(ok(getOrg(fund, 'org-1')).contact_count).toBe(before)
    expect(lastImport(fund)).toBeNull()
    expect(undoImport(fund, last.id)).toMatchObject({ status: 404 })
  })

  it('활동 기록이 생긴 기관은 담당자째 남긴다. 기존 기관에 붙인 담당자는 쓰인 사람만 남는다', () => {
    ok(
      importContacts(
        fund,
        [
          ['기관', '이름'],
          ['쓰기 시작한 기관', '가'],
          ['쓰기 시작한 기관', '나'],
          ['한결연금공단', '라'],
        ],
        false,
      ),
    )
    const org = orgNamed('쓰기 시작한 기관')
    const used = ok(getOrg(fund, org.id)).contacts.find((c) => c.name === '가')!
    activityOn(org.id, [used.id])
    expect(ok(undoImport(fund, lastImport(fund)!.id))).toEqual({
      removed_orgs: 0,
      removed_contacts: 1,
      kept_orgs: 1,
      kept_contacts: 2,
    })
    expect(ok(getOrg(fund, org.id)).contacts.map((c) => c.name)).toEqual(['가', '나'])
    expect(ok(getOrg(fund, 'org-1')).contacts.some((c) => c.name === '라')).toBe(false)
  })

  it('안건만 생긴 기관도 담당자째 남긴다', () => {
    ok(
      importContacts(
        fund,
        [
          ['기관', '이름'],
          ['안건 생긴 기관', '마'],
        ],
        false,
      ),
    )
    const org = orgNamed('안건 생긴 기관')
    ok(
      createDeal(infra, {
        kind: 'investment',
        name: '동료가 만든 안건',
        org_id: org.id,
        owner_id: null,
        amount_krw: null,
        target_date: null,
        next_action: '',
        next_action_due: null,
      }),
    )
    expect(ok(undoImport(fund, lastImport(fund)!.id))).toMatchObject({
      removed_contacts: 0,
      kept_orgs: 1,
      kept_contacts: 1,
    })
    expect(ok(getOrg(fund, org.id)).contacts.map((c) => c.name)).toEqual(['마'])
  })

  it('목록에서 지운 담당자 때문에 빈 기관이 남지 않는다', () => {
    ok(
      importContacts(
        fund,
        [
          ['기관', '이름'],
          ['빈 껍데기 기관', '바'],
          ['빈 껍데기 기관', '사'],
        ],
        false,
      ),
    )
    const org = orgNamed('빈 껍데기 기관')
    const gone = ok(getOrg(fund, org.id)).contacts.find((c) => c.name === '바')!
    expect(deleteContact(fund, gone.id)).toBeNull()
    // 이미 지운 사람은 수에 넣지 않는다.
    expect(ok(undoImport(fund, lastImport(fund)!.id))).toEqual({
      removed_orgs: 1,
      removed_contacts: 1,
      kept_orgs: 0,
      kept_contacts: 0,
    })
    expect(listOrgs({ q: '빈 껍데기 기관' })).toEqual([])
  })

  it('기관만 있는 행의 긴 메모는 미리보기에서 걸린다. 반영이 중간에 던지지 않는다', () => {
    const rows = [
      ['기관', '이름', '메모'],
      ['메모 멀쩡한 기관', '', '짧은 메모'],
      ['메모 긴 기관', '', 'x'.repeat(2001)],
    ]
    expect(ok(importContacts(fund, rows, true)).rows.map((r) => r.status)).toEqual(['ok', 'error'])
    expect(ok(importContacts(fund, rows, false))).toMatchObject({ new_orgs: 1 })
    expect(ok(undoImport(fund, lastImport(fund)!.id))).toMatchObject({ removed_orgs: 1 })
  })

  it('하루가 지나면 되돌릴 수 없다', () => {
    ok(
      importContacts(
        fund,
        [
          ['기관', '이름'],
          ['어제 가져온 기관', '아'],
        ],
        false,
      ),
    )
    const last = lastImport(fund)!
    vi.useFakeTimers({ now: Date.now() + (IMPORT_UNDO_HOURS + 1) * 3_600_000 })
    try {
      expect(lastImport(fund)).toBeNull()
      expect(undoImport(fund, last.id)).toMatchObject({ status: 409 })
    } finally {
      vi.useRealTimers()
    }
    expect(listOrgs({ q: '어제 가져온 기관' })).toHaveLength(1)
  })
})

describe('이미 쓰인 것은 등록한 사람도 못 지운다 (백엔드 #318 과 같은 판정)', () => {
  const deal = (name: string) =>
    ok(
      createDeal(fund, {
        kind: 'investment',
        name,
        org_id: 'org-4',
        owner_id: null,
        amount_krw: null,
        target_date: null,
        next_action: '',
        next_action_due: null,
      }),
    )

  it('안건: 끝났거나 남이 단계를 옮겼으면 임원만 지운다', () => {
    const dropped = deal('중단한 안건')
    ok(dropDeal(fund, dropped.id, { reason: '보류', version: dropped.version }))
    expect(ok(getDeal(fund, dropped.id)).can_delete).toBe(false)

    const moved = deal('남이 옮긴 안건')
    ok(updateDeal(infra, moved.id, { stage: 'screening', version: moved.version }))
    expect(ok(getDeal(fund, moved.id)).can_delete).toBe(false)
    expect(deleteDeal(fund, moved.id)).toMatchObject({ status: 403 })
    expect(deleteDeal(exec, moved.id)).toBeNull()

    // 내가 옮긴 것만 있으면 지운다.
    const mine = deal('내가 옮긴 안건')
    ok(updateDeal(fund, mine.id, { stage: 'screening', version: mine.version }))
    expect(deleteDeal(fund, mine.id)).toBeNull()
  })

  it('담당자: 남이 이직 처리했으면 임원만 지운다', () => {
    const contact = ok(
      createContact(fund, {
        org_id: 'org-4',
        name: '옮겨진 사람',
        title: '',
        phone: '',
        email: '',
        memo: '',
      }),
    )
    ok(updateContact(infra, contact.id, { org_id: 'org-2' }))
    expect(ok(getOrg(fund, 'org-2')).contacts.find((c) => c.id === contact.id)?.can_delete).toBe(
      false,
    )
    expect(deleteContact(fund, contact.id)).toMatchObject({ status: 403 })
    expect(deleteContact(exec, contact.id)).toBeNull()
  })

  it('가져오기 되돌리기: 누가 창구를 맡은 기관은 담당자째 남긴다', () => {
    ok(
      importContacts(
        fund,
        [
          ['기관', '이름'],
          ['창구 생긴 기관', '자'],
        ],
        false,
      ),
    )
    const org = listOrgs({ q: '창구 생긴 기관' })[0]!
    ok(updateOrg(infra, org.id, { owner_ids: [infra.id] }))
    expect(ok(undoImport(fund, lastImport(fund)!.id))).toMatchObject({
      removed_orgs: 0,
      kept_orgs: 1,
      kept_contacts: 1,
    })
  })
})
