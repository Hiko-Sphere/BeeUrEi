import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 通话连接失败上报 /api/assist/call-failure：把客户端 ICE 失败（尤其 TURN relay 不可达）变成服务端可观测计数。
// 安全要点：reason 必须白名单枚举——绝不能拿客户端任意串拼 metric 名（注入/无界撑爆 counters map）。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function seed() {
  const app = buildApp(new MemoryStore())
  const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'callfail', password: 'secret123', role: 'helper' } })).json() as { token: string }
  const metricsText = async () => (await app.inject({ method: 'GET', url: '/metrics' })).body
  return { app, token: me.token, metricsText }
}

describe('通话连接失败上报 /api/assist/call-failure', () => {
  it('relay_unreachable → 200，且 /metrics 计数自增（静默 TURN 故障变可观测）', async () => {
    const { app, token, metricsText } = await seed()
    expect(await metricsText()).not.toContain('beeurei_call_ice_failure_relay_unreachable_total 1')
    const r = await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(token), payload: { reason: 'relay_unreachable', callId: 'c1' } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true })
    expect(await metricsText()).toContain('beeurei_call_ice_failure_relay_unreachable_total 1')
    // 再报一次 → 累加到 2（counter 语义）。
    await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(token), payload: { reason: 'relay_unreachable' } })
    expect(await metricsText()).toContain('beeurei_call_ice_failure_relay_unreachable_total 2')
    await app.close()
  })

  it('generic / signaling 各自独立计数', async () => {
    const { app, token, metricsText } = await seed()
    await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(token), payload: { reason: 'generic' } })
    await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(token), payload: { reason: 'signaling' } })
    const m = await metricsText()
    expect(m).toContain('beeurei_call_ice_failure_generic_total 1')
    expect(m).toContain('beeurei_call_ice_failure_signaling_total 1')
    await app.close()
  })

  it('非白名单 reason → 400，绝不拼进 metric 名（防注入/撑爆 counters）', async () => {
    const { app, token, metricsText } = await seed()
    const r = await app.inject({ method: 'POST', url: '/api/assist/call-failure', headers: auth(token), payload: { reason: 'relay_unreachable_total 999999\ninjected' } })
    expect(r.statusCode).toBe(400)
    // 注入串绝不出现在 /metrics 里。
    expect(await metricsText()).not.toContain('injected')
    await app.close()
  })

  it('未登录 → 401（需鉴权，防匿名刷计数）', async () => {
    const { app } = await seed()
    const r = await app.inject({ method: 'POST', url: '/api/assist/call-failure', payload: { reason: 'generic' } })
    expect(r.statusCode).toBe(401)
    await app.close()
  })
})
