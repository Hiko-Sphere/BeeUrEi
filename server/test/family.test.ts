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
    // 幂等：再删一次（已不存在）仍 204，而非 404（双击/重试不报错）
    expect((await a.inject({ method: 'DELETE', url: `/api/family/links/${id}`, headers: auth })).statusCode).toBe(204)
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

  it('拉黑后：来自被拉黑者的待确认请求不出现在收件箱，且接受被拒(403 blocked)', async () => {
    const { a, reg } = setup()
    const requester = await reg('reqr', 'helper') // 发起方
    const me = await reg('blkme', 'blind')         // 被请求方（稍后拉黑发起方）
    const link = await a.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${requester.token}` }, payload: { username: 'blkme' } })
    expect(link.statusCode).toBe(201)
    const linkId = link.json().link.id
    // me 拉黑发起方（请求是在拉黑前发出的）
    await a.inject({ method: 'POST', url: '/api/blocks', headers: { authorization: `Bearer ${me.token}` }, payload: { username: 'reqr' } })
    // 收件箱不再展示该请求
    const incoming = await a.inject({ method: 'GET', url: '/api/family/incoming', headers: { authorization: `Bearer ${me.token}` } })
    expect(incoming.json().links.length).toBe(0)
    // 接受被拒（不再建出"已接受却处处被拦"的死链）
    const accept = await a.inject({ method: 'POST', url: `/api/family/links/${linkId}/accept`, headers: { authorization: `Bearer ${me.token}` } })
    expect(accept.statusCode).toBe(403)
    expect(accept.json().error).toBe('blocked')
    await a.close()
  })

  it('接受好友请求 → 给发起者写持久通知（web-only 无 push 也能看到，非仅推送）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role?: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const requester = await reg('reqA', 'helper') // 发起者（设想为 web-only，无 apnsToken）
    await reg('blindA', 'blind')
    const link = await a.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${requester.token}` }, payload: { username: 'blindA' } })
    const blindLogin = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'blindA', password: 'secret123' } })
    await a.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${blindLogin.json().token}` } })
    // 发起者收到持久化的 friend_accepted 通知（不依赖 push）
    expect(store.notificationsForUser(requester.user.id).some((n) => n.kind === 'friend_accepted')).toBe(true)
    // 对称：被请求方(blindA)也应有持久化的 friend_request 通知（web-only 无 push 也能看到，附 linkId）
    const target = store.findByUsername('blindA')!
    const req = store.notificationsForUser(target.id).find((n) => n.kind === 'friend_request')
    expect(req).toBeTruthy()
    expect(req!.data?.linkId).toBe(link.json().link.id)
    expect(req!.body).toContain('reqA') // 含发起者名
    await a.close()
  })

  it('好友请求 relation 过内容审核：含违禁词被拒(403 content_blocked)，干净通过', async () => {
    const store = new MemoryStore()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['脏词'] } })
    const a = buildApp(store)
    const reg = async (u: string, role?: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const requester = await reg('reqR', 'helper')
    await reg('tgtR', 'blind')
    const auth = { authorization: `Bearer ${requester.token}` }
    // relation 含违禁词 → 拒（否则可经好友请求 relation 向陌生人发违禁内容）
    const bad = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'tgtR', relation: '脏词称呼' } })
    expect(bad.statusCode).toBe(403)
    expect((bad.json() as any).error).toBe('content_blocked')
    // 干净 relation → 通过
    const ok = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'tgtR', relation: '朋友' } })
    expect(ok.statusCode).toBe(201)
    await a.close()
  })

  it('重复接受好友请求幂等：第二次不再重复给发起者发"已接受"通知', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role?: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const requester = await reg('reqI', 'helper')
    await reg('blindI', 'blind')
    const link = await a.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${requester.token}` }, payload: { username: 'blindI' } })
    const blindLogin = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'blindI', password: 'secret123' } })
    const auth = { authorization: `Bearer ${blindLogin.json().token}` }
    const linkId = link.json().link.id
    expect((await a.inject({ method: 'POST', url: `/api/family/links/${linkId}/accept`, headers: auth })).statusCode).toBe(200)
    expect((await a.inject({ method: 'POST', url: `/api/family/links/${linkId}/accept`, headers: auth })).statusCode).toBe(200) // 幂等
    // 只通知过一次
    expect(store.notificationsForUser(requester.user.id).filter((n) => n.kind === 'friend_accepted').length).toBe(1)
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

  it('好友请求限流：单账号短时间内连发被 429（掐断"发满→删除→再发"的刷推送环路）', async () => {
    const { a, reg } = setup()
    const owner = await reg('rlowner', 'blind')
    await reg('rltarget', 'helper')
    const auth = { authorization: `Bearer ${owner.token}` }
    let handled = 0 // 进入处理器（201 首次 / 409 去重）
    let limited = 0 // 被限流 429
    for (let i = 0; i < 24; i++) {
      const res = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'rltarget' } })
      if (res.statusCode === 429) limited++
      else if (res.statusCode === 201 || res.statusCode === 409) handled++
    }
    expect(handled).toBeLessThanOrEqual(20) // 每分钟至多 20 次进入处理器
    expect(limited).toBeGreaterThan(0)      // 超额后触发限流（否则刷推送环路无界）
    await a.close()
  })

  it('可事后切换联系人的紧急标志（isEmergency）；仅 owner 可改，非 owner/member 403', async () => {
    const { a, reg } = setup()
    const owner = await reg('emgowner', 'blind')
    const contact = await reg('emgcontact', 'family')
    const stranger = await reg('emgstranger', 'helper')
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    // 建链时**非**紧急联系人
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'emgcontact', relation: '家人', isEmergency: false } })
    const id = l.json().link.id as string
    expect(l.json().link.isEmergency).toBe(false)
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/accept`, headers: auth(contact.token) })

    // owner 事后提升为紧急联系人
    const on = await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: true } })
    expect(on.statusCode).toBe(200)
    expect(on.json().link.isEmergency).toBe(true)
    // 列表反映
    const list = await a.inject({ method: 'GET', url: '/api/family/links', headers: auth(owner.token) })
    expect(list.json().links.find((x: any) => x.id === id).isEmergency).toBe(true)
    // 再降级
    const off = await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: false } })
    expect(off.json().link.isEmergency).toBe(false)

    // member（对方）不能改（仅 owner 指定其紧急联系人）
    const byMember = await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(contact.token), payload: { isEmergency: true } })
    expect(byMember.statusCode).toBe(403)
    // 陌生人 404（看不到该链）
    const bySelf = await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(stranger.token), payload: { isEmergency: true } })
    expect(bySelf.statusCode).toBe(403) // 存在但非 owner → 403（不泄漏存在性差异：非 owner 一律 403）
    // 非法 body 400
    expect((await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: {} })).statusCode).toBe(400)
    await a.close()
  })

  it('被设为紧急联系人时通知对方（仅 false→true 一次；取消/重复设 true 不扰）', async () => {
    const { a, reg } = setup()
    const owner = await reg('ecowner', 'blind')
    const contact = await reg('eccontact', 'family')
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'eccontact', relation: '家人', isEmergency: false } })
    const id = l.json().link.id as string
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/accept`, headers: auth(contact.token) })
    const setCount = async () => ((await a.inject({ method: 'GET', url: '/api/notifications', headers: auth(contact.token) })).json().notifications as { kind: string; body: string; data?: { linkId?: string } }[]).filter((n) => n.kind === 'emergency_contact_set')
    // 建链时 isEmergency:false → 尚无"紧急联系人"通知
    expect(await setCount()).toHaveLength(0)
    // false→true：通知对方一次，含 owner 名 + linkId
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: true } })
    const set = await setCount()
    expect(set).toHaveLength(1)
    expect(set[0].body).toContain('ecowner')     // owner displayName（缺省=username）
    expect(set[0].data?.linkId).toBe(id)
    // 重复设 true（已是 true）：不再通知
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: true } })
    expect(await setCount()).toHaveLength(1)
    // 取消 true→false：不通知
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: false } })
    expect(await setCount()).toHaveLength(1)
    // 再次 false→true：又通知一次（第二次真正新设）
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: true } })
    expect(await setCount()).toHaveLength(2)
    await a.close()
  })

  it('姊妹缺口：链建时即紧急（isEmergency:true）→ member 接受那刻收到 emergency_contact_set（不再默默担责）；非紧急链不发', async () => {
    const { a, reg } = setup()
    const owner = await reg('bootemgowner', 'blind')
    const contact = await reg('bootemgcontact', 'family')
    const plain = await reg('bootplaincontact', 'helper')
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    const setCount = async (t: string) => ((await a.inject({ method: 'GET', url: '/api/notifications', headers: auth(t) })).json().notifications as { kind: string; body: string; data?: { linkId?: string } }[]).filter((n) => n.kind === 'emergency_contact_set')
    // ① 建链时就 isEmergency:true —— 接受前不发（pending 链不参与紧急路由，紧急身份未生效）。
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'bootemgcontact', relation: '家人', isEmergency: true } })
    const id = l.json().link.id as string
    expect(await setCount(contact.token)).toHaveLength(0) // 仅 pending，尚未通知
    // 接受那刻生效 → member 收到一条 emergency_contact_set（含 owner 名 + linkId）。
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/accept`, headers: auth(contact.token) })
    const set = await setCount(contact.token)
    expect(set).toHaveLength(1)
    expect(set[0].body).toContain('bootemgowner')
    expect(set[0].data?.linkId).toBe(id)
    // 已是紧急，再 owner 切 true 不重复（既有 toggle 端点仅 false→true 才发）。
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: true } })
    expect(await setCount(contact.token)).toHaveLength(1)
    // ② 对照：**非**紧急链被接受 → member 不收 emergency_contact_set。
    const l2 = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'bootplaincontact', relation: '朋友', isEmergency: false } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l2.json().link.id}/accept`, headers: auth(plain.token) })
    expect(await setCount(plain.token)).toHaveLength(0)
    await a.close()
  })

  it('紧急标志切换端点有端级限流（挡刷 emergency_contact_set 推送骚扰；与 addLink 同 20/min）', async () => {
    const { a, reg } = setup()
    const owner = await reg('rlemgowner', 'blind')
    const contact = await reg('rlemgcontact', 'family')
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'rlemgcontact', relation: '家人', isEmergency: false } })
    const id = l.json().link.id as string
    await a.inject({ method: 'POST', url: `/api/family/links/${id}/accept`, headers: auth(contact.token) })
    // 端级 20/min：连打 22 次（true/false 交替，模拟刷推送环路）应在第 21 次起 429。默认全局 300 远松于此，
    // 改前无端级限流则 22 次全过、测即失败（同 email/verify 端级限流回归口径）。
    let limited = false
    for (let i = 0; i < 22; i++) {
      const r = await a.inject({ method: 'POST', url: `/api/family/links/${id}/emergency`, headers: auth(owner.token), payload: { isEmergency: i % 2 === 0 } })
      if (r.statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true)
    await a.close()
  })
})
