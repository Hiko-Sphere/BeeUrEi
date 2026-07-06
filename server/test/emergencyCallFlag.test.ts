import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

// 紧急求助呼叫标志：盲人一键 SOS 呼叫亲友时被叫端能识别为**紧急**（突出显示/优先应答），区别于日常"帮我看一下"。
describe('/api/assist/call emergency 标志 → /api/assist/incoming', () => {
  async function setup() {
    const app = buildApp(new MemoryStore())
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const blind = await reg('ecfBlind', 'blind')
    const helper = await reg('ecfHelper', 'helper')
    // blind ↔ helper 建 accepted 绑定（呼叫前置：仅已接受联系人可呼）。
    const l = await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'ecfHelper', relation: '志愿者' } })
    await app.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: auth(helper.token) })
    return { app, blind, helper }
  }
  const incomingEmergency = async (app: ReturnType<typeof buildApp>, token: string) =>
    (await app.inject({ method: 'GET', url: '/api/assist/incoming', headers: auth(token) })).json().calls[0]?.emergency

  it('emergency:true → 被叫来电带 emergency:true', async () => {
    const { app, blind, helper } = await setup()
    const c = await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'sos-1', targetUserIds: [helper.user.id], emergency: true } })
    expect(c.statusCode).toBe(200)
    expect(await incomingEmergency(app, helper.token)).toBe(true)
    await app.close()
  })

  it('普通呼叫（不带 emergency）→ emergency:false（默认不误标紧急）', async () => {
    const { app, blind, helper } = await setup()
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'reg-1', targetUserIds: [helper.user.id] } })
    expect(await incomingEmergency(app, helper.token)).toBe(false)
    await app.close()
  })

  it('emergency:false 显式 → false；坏值不 400（可选标志退化）', async () => {
    const { app, blind, helper } = await setup()
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'reg-2', targetUserIds: [helper.user.id], emergency: false } })
    expect(await incomingEmergency(app, helper.token)).toBe(false)
    // 坏值（非布尔）→ 退化为 false、呼叫仍成功（不让一键求助因该可选标志 400）。
    const bad = await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'reg-3', targetUserIds: [helper.user.id], emergency: 'yes' } })
    expect(bad.statusCode).toBe(200)
    await app.close()
  })
})
