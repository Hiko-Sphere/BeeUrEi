import { describe, it, expect } from 'vitest'
import { Metrics } from '../src/metrics/metrics'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

describe('Metrics', () => {
  it('renders prometheus format: uptime, request classes, counters, gauges', () => {
    const m = new Metrics(1000)
    m.observeResponse(200)
    m.observeResponse(201)
    m.observeResponse(404)
    m.observeResponse(500)
    m.inc('help_requests_total')
    m.inc('help_requests_total', 2)
    const out = m.render({ nowMs: 6000, gauges: { users_total: 3 } })
    expect(out).toContain('beeurei_uptime_seconds 5')
    expect(out).toContain('beeurei_http_requests_total{class="2xx"} 2')
    expect(out).toContain('beeurei_http_requests_total{class="4xx"} 1')
    expect(out).toContain('beeurei_http_requests_total{class="5xx"} 1')
    expect(out).toContain('beeurei_help_requests_total 3')
    expect(out).toContain('beeurei_users_total 3')
  })

  it('GET /metrics 暴露文本格式（无 token 时开放）', async () => {
    const a = buildApp(new MemoryStore())
    const r = await a.inject({ method: 'GET', url: '/metrics' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/plain')
    expect(r.body).toContain('beeurei_uptime_seconds')
    expect(r.body).toContain('beeurei_http_requests_total')
    await a.close()
  })

  it('users_total 走 store.userCount()（O(1) 计数）且与实际用户数一致', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const base = store.userCount() // 可能含 seed 的管理员，故用增量断言
    for (const u of ['mua', 'mub', 'muc']) await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role: 'blind' } })
    expect(store.userCount()).toBe(base + 3)
    expect(store.userCount()).toBe(store.allUsers().length) // 与全量口径一致
    expect((await a.inject({ method: 'GET', url: '/metrics' })).body).toContain(`beeurei_users_total ${base + 3}`)
    await a.close()
  })

  it('业务计数：发起公开求助后 /metrics 反映 help_requests_total', async () => {
    const a = buildApp(new MemoryStore())
    const reg = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mblind', password: 'secret123', role: 'blind' } })).json()
    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: { authorization: `Bearer ${reg.token}` }, payload: { callId: 'm-1' } })
    const m = await a.inject({ method: 'GET', url: '/metrics' })
    expect(m.body).toContain('beeurei_help_requests_total 1')
    await a.close()
  })

  it('紧急链路"人响应"漏斗计数：0 基线预置 + ack/all-clear 增量反映在 /metrics', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('mfowner', 'blind')
    const h1 = await reg('mfh1', 'helper')
    const h2 = await reg('mfh2', 'helper')
    const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
    // 0 基线：新增 series 自启动即存在（Prometheus rate() 不断档）。
    const base = (await a.inject({ method: 'GET', url: '/metrics' })).body
    for (const s of ['emergency_acks_total', 'emergency_responding_total', 'emergency_allclears_total',
                     'emergency_escalations_total', 'safety_checkin_fires_total', 'safety_checkin_reminders_total']) {
      expect(base).toContain(`beeurei_${s} 0`)
    }
    // 两位亲友接受绑定
    for (const u of ['mfh1', 'mfh2']) {
      const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: bearer(owner.token), payload: { username: u, relation: '家人', isEmergency: true } })
      await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: bearer(u === 'mfh1' ? h1.token : h2.token) })
    }
    const ownerId = store.findByUsername('mfowner')!.id
    // 告警 → h1 确认（首个响应者：ack + responding 各 +1）→ 报平安（allclear +1）
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: bearer(owner.token), payload: { kind: 'manual' } })
    const eventId = store.emergencyEventsForUser(ownerId)[0].id
    await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(h1.token), payload: { fromId: ownerId, eventId } })
    await a.inject({ method: 'POST', url: '/api/emergency/all-clear', headers: bearer(owner.token), payload: { alertId: 'ac1' } })
    const out = (await a.inject({ method: 'GET', url: '/metrics' })).body
    expect(out).toContain('beeurei_emergency_alerts_total 1')
    expect(out).toContain('beeurei_emergency_acks_total 1')
    expect(out).toContain('beeurei_emergency_responding_total 1') // 首个响应者触发协调广播
    expect(out).toContain('beeurei_emergency_allclears_total 1')
    await a.close()
  })

  it('设了 METRICS_TOKEN 时 /metrics 需 Bearer 鉴权', async () => {
    process.env.METRICS_TOKEN = 'secret-scrape'
    try {
      const a = buildApp(new MemoryStore())
      expect((await a.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401)
      const ok = await a.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer secret-scrape' } })
      expect(ok.statusCode).toBe(200)
      await a.close()
    } finally {
      delete process.env.METRICS_TOKEN
    }
  })

  it('setNote/getNote：字符串便签存取（供 admin 面板呈现失败原因），值截断 200、未设→null', () => {
    const m = new Metrics(1000)
    expect(m.getNote('mail_last_error')).toBeNull()
    m.setNote('mail_last_error', '535 authentication failed', 2000)
    expect(m.getNote('mail_last_error')).toEqual({ value: '535 authentication failed', at: 2000 })
    // 超长值截断到 200，防日志膨胀。
    m.setNote('x', 'a'.repeat(500), 3000)
    expect(m.getNote('x')!.value.length).toBe(200)
    // 后写覆盖前写。
    m.setNote('mail_last_error', 'ECONNREFUSED', 4000)
    expect(m.getNote('mail_last_error')).toEqual({ value: 'ECONNREFUSED', at: 4000 })
  })
})
