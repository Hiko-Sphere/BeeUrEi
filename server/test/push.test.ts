import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { PushSender } from '../src/push/apns'

function capturingApp() {
  const sent: { token: string; callId: string; callerName: string; callerId: string }[] = []
  const alerts: { token: string; title: string; body: string }[] = []
  const pushSender: PushSender = {
    async sendCallInvite(token, callId, callerName, callerId) {
      sent.push({ token, callId, callerName, callerId })
    },
    async sendAlert(token, title, body) {
      alerts.push({ token, title, body })
    },
  }
  return { app: buildApp(new MemoryStore(), { pushSender }), sent, alerts }
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

describe('提醒类推送（软件外通知）', () => {
  it('好友请求向被请求方推送提醒；接受后向发起方推送', async () => {
    const { app, alerts } = capturingApp()
    const blind = await reg(app, 'naBlind', 'blind')
    const helper = await reg(app, 'naHelper', 'helper')
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(helper.token), payload: { token: HEX_TOKEN } })
    await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(blind.token), payload: { token: HEX_TOKEN2 } })
    // blind 发起 → 推给 helper
    const lk = await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'naHelper' } })
    await tick()
    expect(alerts.some((a) => a.token === HEX_TOKEN && a.title.includes('好友请求'))).toBe(true)
    // helper 接受 → 推给 blind(发起者)
    await app.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })
    await tick()
    expect(alerts.some((a) => a.token === HEX_TOKEN2)).toBe(true)
    await app.close()
  })

  it('注册/注销普通 APNs token（非法格式被拒）', async () => {
    const { app } = capturingApp()
    const u = await reg(app, 'naTok', 'blind')
    expect((await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(u.token), payload: { token: 'xyz' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(u.token), payload: { token: HEX_TOKEN } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: '/api/push/apns-register', headers: auth(u.token) })).statusCode).toBe(200)
    await app.close()
  })
})

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
