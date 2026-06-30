import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function setup() {
  const a = buildApp(new MemoryStore())
  const reg = async (username: string, role?: string) =>
    (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })).json()
  return { a, reg }
}

describe('family + emergency', () => {
  it('add / list / delete links and emergency routing order', async () => {
    const { a, reg } = setup()
    const owner = await reg('alice')
    const mom = await reg('mom', 'family')
    const friend = await reg('friend', 'helper')
    const auth = { authorization: `Bearer ${owner.token}` }

    const l1 = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'mom', relation: '妈妈', isEmergency: true, phone: '13800000000' } })
    expect(l1.statusCode).toBe(201)
    expect(l1.json().link.memberName).toBe('mom')
    expect(l1.json().link.phone).toBe('13800000000') // 电话兜底

    const l2 = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'friend' } })

    // 双向同意：被绑定方(member)接受后绑定才生效（见审查 #6）。
    await a.inject({ method: 'POST', url: `/api/family/links/${l1.json().link.id}/accept`, headers: { authorization: `Bearer ${mom.token}` } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l2.json().link.id}/accept`, headers: { authorization: `Bearer ${friend.token}` } })

    const ghost = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'ghost' } })
    expect(ghost.statusCode).toBe(404)

    const list = await a.inject({ method: 'GET', url: '/api/family/links', headers: auth })
    expect(list.json().links.length).toBe(2)

    const trig = await a.inject({ method: 'POST', url: '/api/emergency/trigger', headers: auth })
    const targets = trig.json().targets
    expect(targets.length).toBe(2)
    expect(targets[0].memberName).toBe('mom')
    expect(targets[0].isEmergency).toBe(true)

    const id = list.json().links[0].id
    const del = await a.inject({ method: 'DELETE', url: `/api/family/links/${id}`, headers: auth })
    expect(del.statusCode).toBe(204)
    await a.close()
  })

  it('rejects duplicate link to same member (409)', async () => {
    const { a, reg } = setup()
    const owner = await reg('alice')
    await reg('mom', 'family')
    const auth = { authorization: `Bearer ${owner.token}` }
    expect((await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'mom' } })).statusCode).toBe(201)
    const dup = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'mom' } })
    expect(dup.statusCode).toBe(409) // 去重，不会无界增长
    await a.close()
  })

  it('caps the initiator side too: non-blind requester cannot fan out unbounded requests (422)', async () => {
    // 非盲发起方时 ownerId=target(盲)，owner 维度上限约束不到发起方自身——不补上限则单账号可向无数
    // 不同目标发 pending 请求（无界增长 + 群发好友请求推送骚扰）。验证发起方自身满 200 时被挡。
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (username: string, role?: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })).json()
    const helper = await reg('helperx', 'helper') // 非盲发起方（member 侧）
    await reg('blindy', 'blind')                   // 全新盲人目标（其 owner 维度为空）
    for (let i = 0; i < 200; i++)                  // 预置发起方作为 member 的 200 条 link
      store.createLink({ id: `seed-${i}`, ownerId: `owner-${i}`, memberId: helper.user.id, relation: '亲友', isEmergency: false, createdAt: i, status: 'accepted', requestedBy: helper.user.id })
    const auth = { authorization: `Bearer ${helper.token}` }
    const res = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'blindy' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('too_many_links')
    await a.close()
  })

  it('username lookup is case-insensitive (no impersonation by case)', async () => {
    const { a, reg } = setup()
    const owner = await reg('alice')
    await reg('Mom', 'family')
    const auth = { authorization: `Bearer ${owner.token}` }
    // 用不同大小写绑定应命中同一用户（而非 404 或新建混淆账号）。
    const r = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'MOM' } })
    expect(r.statusCode).toBe(201)
    expect(r.json().link.memberName).toBe('Mom')
    // 注册同名不同大小写应被拒(用户名已占用)。
    const taken = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ALICE', password: 'secret123' } })
    expect(taken.statusCode).toBe(409)
    await a.close()
  })

  it('pending link does not participate until member accepts (bidirectional consent #6)', async () => {
    const { a, reg } = setup()
    const owner = await reg('blindx', 'blind')
    const helper = await reg('helperx', 'helper')
    const oAuth = { authorization: `Bearer ${owner.token}` }
    const hAuth = { authorization: `Bearer ${helper.token}` }

    const lk = await a.inject({ method: 'POST', url: '/api/family/links', headers: oAuth, payload: { username: 'helperx', isEmergency: true } })
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: hAuth, payload: { available: true } })

    // 未接受(pending)：探测不到在线状态、紧急不收录、呼叫被拒——杜绝单向绑定探测/强推（见审查 #6）。
    expect((await a.inject({ method: 'POST', url: '/api/assist/match', headers: oAuth, payload: { emergency: false } })).json().count).toBe(0)
    expect((await a.inject({ method: 'POST', url: '/api/emergency/trigger', headers: oAuth })).json().count).toBe(0)
    expect((await a.inject({ method: 'POST', url: '/api/assist/call', headers: oAuth, payload: { callId: 'cx', targetUserIds: [helper.user.id] } })).statusCode).toBe(403)

    // helper 接受后 → 绑定生效。
    const acc = await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: hAuth })
    expect(acc.statusCode).toBe(200)
    expect((await a.inject({ method: 'POST', url: '/api/assist/match', headers: oAuth, payload: { emergency: false } })).json().count).toBe(1)
    expect((await a.inject({ method: 'POST', url: '/api/assist/call', headers: oAuth, payload: { callId: 'cx2', targetUserIds: [helper.user.id] } })).statusCode).toBe(200)
    await a.close()
  })

  it('rejects linking self and requires auth', async () => {
    const { a, reg } = setup()
    const owner = await reg('alice')
    const auth = { authorization: `Bearer ${owner.token}` }
    const self = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'alice' } })
    expect(self.statusCode).toBe(400)

    const noAuth = await a.inject({ method: 'GET', url: '/api/family/links' })
    expect(noAuth.statusCode).toBe(401)
    await a.close()
  })
})
