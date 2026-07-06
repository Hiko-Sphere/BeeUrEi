import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 会话列表显示对端是否在线待命（与亲友列表 online 同口径）：盲人在聊天列表就能分清"在线可即时呼叫"与"离线只能留言"。
describe('GET /api/conversations 含对端在线状态', () => {
  it('对端心跳在线→online:true；下线→false', async () => {
    const app = buildApp(new MemoryStore())
    const reg = async (u: string, role: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'strong-pass-9x', role } })).json()
    const blind = await reg('cvblind', 'blind')
    const helper = await reg('cvhelper', 'helper')
    const bh = { authorization: `Bearer ${blind.token}` }
    const hh = { authorization: `Bearer ${helper.token}` }
    const heartbeat = (available: boolean) => app.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: hh, payload: { available } })
    const myConvos = async () => (await app.inject({ method: 'GET', url: '/api/conversations', headers: bh })).json().conversations

    // 建链 + 接受（发消息前须为已建立关系）。
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: bh, payload: { username: 'cvhelper', relation: '志愿者', isEmergency: false } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: hh })
    // 盲人给 helper 发一条消息 → 会话建立。
    const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: bh, payload: { toId: helper.user.id, kind: 'text', text: '你在吗' } })
    expect(sent.statusCode).toBe(201)

    // 对端在线 → online:true。
    await heartbeat(true)
    const c1 = (await myConvos())[0]
    expect(c1.peer.id).toBe(helper.user.id)
    expect(c1.online).toBe(true)

    // 对端下线 → online:false（会话本身仍在）。
    await heartbeat(false)
    const c2 = (await myConvos())[0]
    expect(c2.peer.id).toBe(helper.user.id)
    expect(c2.online).toBe(false)
    await app.close()
  })

  it('从未上线的对端→online:false（默认离线，不误显在线）', async () => {
    const app = buildApp(new MemoryStore())
    const reg = async (u: string, role: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'strong-pass-9x', role } })).json()
    const blind = await reg('cvblind2', 'blind')
    const helper = await reg('cvhelper2', 'helper')
    const bh = { authorization: `Bearer ${blind.token}` }
    const hh = { authorization: `Bearer ${helper.token}` }
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: bh, payload: { username: 'cvhelper2', relation: '志愿者', isEmergency: false } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: hh })
    await app.inject({ method: 'POST', url: '/api/messages', headers: bh, payload: { toId: helper.user.id, kind: 'text', text: 'hi' } })
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: bh })).json().conversations[0].online).toBe(false)
    await app.close()
  })
})
