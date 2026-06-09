import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { PushSender } from '../src/push/apns'

function capturingApp() {
  const sent: { token: string; callId: string; callerName: string; callerId: string }[] = []
  const pushSender: PushSender = {
    async sendCallInvite(token, callId, callerName, callerId) {
      sent.push({ token, callId, callerName, callerId })
    },
  }
  return { app: buildApp(new MemoryStore(), { pushSender }), sent }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const tick = () => new Promise((r) => setTimeout(r, 30))
const HEX_TOKEN = 'a1b2c3d4'.repeat(8) // 64 位十六进制（合法 VoIP token 形态）
const HEX_TOKEN2 = 'deadbeef'.repeat(8)

async function reg(a: ReturnType<typeof buildApp>, username: string, role = 'blind') {
  return (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })).json() as {
    token: string
    user: { id: string }
  }
}

describe('VoIP 推送（A1 后台来电）', () => {
  it('注册 VoIP token 后，定向呼叫向目标设备推送来电', async () => {
    const { app, sent } = capturingApp()
    const blind = await reg(app, 'pblind', 'blind')
    const helper = await reg(app, 'phelper', 'helper')

    // 绑定 + 接受
    const lk = await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'phelper' } })
    await app.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })

    // 协助者注册 VoIP token
    const regTok = await app.inject({ method: 'POST', url: '/api/push/register', headers: auth(helper.token), payload: { voipToken: HEX_TOKEN } })
    expect(regTok.statusCode).toBe(200)

    // 视障发起定向呼叫
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'push-call-1', targetUserIds: [helper.user.id] } })
    await tick()

    expect(sent.length).toBe(1)
    expect(sent[0].token).toBe(HEX_TOKEN)
    expect(sent[0].callId).toBe('push-call-1')
    expect(sent[0].callerName).toBe('pblind')
    await app.close()
  })

  it('目标未注册 token 则不推送（前台轮询会合仍可用）', async () => {
    const { app, sent } = capturingApp()
    const blind = await reg(app, 'pblind2', 'blind')
    const helper = await reg(app, 'phelper2', 'helper')
    const lk = await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'phelper2' } })
    await app.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'push-call-2', targetUserIds: [helper.user.id] } })
    await tick()
    expect(sent.length).toBe(0)
    await app.close()
  })

  it('注销 token 后不再推送', async () => {
    const { app, sent } = capturingApp()
    const blind = await reg(app, 'pblind3', 'blind')
    const helper = await reg(app, 'phelper3', 'helper')
    const lk = await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'phelper3' } })
    await app.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })
    await app.inject({ method: 'POST', url: '/api/push/register', headers: auth(helper.token), payload: { voipToken: HEX_TOKEN2 } })
    await app.inject({ method: 'DELETE', url: '/api/push/register', headers: auth(helper.token) })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'push-call-3', targetUserIds: [helper.user.id] } })
    await tick()
    expect(sent.length).toBe(0)
    await app.close()
  })

  it('push/register 需要登录', async () => {
    const { app } = capturingApp()
    expect((await app.inject({ method: 'POST', url: '/api/push/register', payload: { voipToken: HEX_TOKEN } })).statusCode).toBe(401)
    await app.close()
  })

  it('非十六进制 token 被拒（防注入 :path，见复审 #8）', async () => {
    const { app } = capturingApp()
    const u = await reg(app, 'pbad', 'helper')
    const bad = await app.inject({ method: 'POST', url: '/api/push/register', headers: auth(u.token), payload: { voipToken: '../../evil token' } })
    expect(bad.statusCode).toBe(400)
    const short = await app.inject({ method: 'POST', url: '/api/push/register', headers: auth(u.token), payload: { voipToken: 'abcd' } })
    expect(short.statusCode).toBe(400)
    await app.close()
  })
})
