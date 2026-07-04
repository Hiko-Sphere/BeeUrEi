import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 自助数据导出（GDPR 可携权）：本人拿得到自己的一切、拿不到别人的话、永远拿不到密钥类。
describe('GET /api/account/export', () => {
  it('含档案/亲友/路线/本人发出的文字消息；不含对方消息正文；绝无密码哈希与令牌', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const me = await reg('exportme', 'blind')
    const peer = await reg('exportpeer', 'helper')
    const auth = { authorization: `Bearer ${me.token}` }
    const pAuth = { authorization: `Bearer ${peer.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'exportpeer', relation: '志愿者', isEmergency: true } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: pAuth })
    // 双向消息：我发的进导出，对方发的不进
    await a.inject({ method: 'POST', url: '/api/messages', headers: auth, payload: { toId: peer.user.id, kind: 'text', text: '我的话-地址是幸福路1号' } })
    await a.inject({ method: 'POST', url: '/api/messages', headers: pAuth, payload: { toId: me.user.id, kind: 'text', text: '对方的话-秘密内容' } })
    // 我的路线
    await a.inject({ method: 'POST', url: '/api/routes', headers: auth, payload: { name: '回家', waypoints: [{ lat: 31.2, lng: 121.4 }, { lat: 31.21, lng: 121.41 }] } })
    // 一次带坐标的手动 SOS（本人事故记录 → 应进导出）
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'manual', lat: 31.2, lon: 121.4 } })
    // 群聊（本人为群主 → 应进导出的 groups；此前漏了群归属）
    const g = await a.inject({ method: 'POST', url: '/api/groups', headers: auth, payload: { name: '家庭群', memberIds: [peer.user.id] } })
    expect(g.statusCode).toBe(201)

    const res = await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('beeurei-my-data.json')
    const body = res.json()
    const raw = res.payload
    expect(body.profile.username).toBe('exportme')
    expect(body.familyLinks.length).toBe(1)
    expect(body.savedRoutes.length).toBe(1)
    expect(body.savedRoutes[0].waypoints.length).toBe(2)
    expect(body.emergencyEvents.length).toBe(1)
    expect(body.emergencyEvents[0]).toMatchObject({ kind: 'manual', lat: 31.2, contacts: 1 })
    expect(body.messagesSent.length).toBe(1)
    expect(body.messagesSent[0].text).toContain('幸福路')      // 自己的话，含正文
    // 群归属（回归：此前漏导出）
    expect(body.groups.length).toBe(1)
    expect(body.groups[0]).toMatchObject({ name: '家庭群', role: 'owner' })
    // 通知收件箱（回归：此前漏导出）——peer 接受我的好友请求 → 我(请求者)收到 friend_accepted
    expect(body.notifications.some((n: { kind: string }) => n.kind === 'friend_accepted')).toBe(true)
    expect(raw).not.toContain('秘密内容')                       // 对方的话绝不出现
    expect(raw).not.toContain('passwordHash')                   // 安全底线（底座保证）
    expect(raw.toLowerCase()).not.toContain('refreshtoken')
    // 未登录 401
    expect((await a.inject({ method: 'GET', url: '/api/account/export' })).statusCode).toBe(401)
    await a.close()
  })

  it('非文字消息只给元信息（data URL/mediaId 不内联）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const me = await reg('exportau', 'blind')
    const peer = await reg('exportau2', 'helper')
    const auth = { authorization: `Bearer ${me.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'exportau2', relation: '亲友' } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: { authorization: `Bearer ${peer.token}` } })
    await a.inject({ method: 'POST', url: '/api/messages', headers: auth, payload: { toId: peer.user.id, kind: 'audio', text: 'data:audio/mp4;base64,AAAA' } })
    const res = await a.inject({ method: 'GET', url: '/api/account/export', headers: auth })
    const m = res.json().messagesSent[0]
    expect(m.kind).toBe('audio')
    expect(m.text).toBeNull()                       // 元信息 only
    expect(res.payload).not.toContain('base64,AAAA') // data URL 绝不内联
    await a.close()
  })
})
