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

  it('业务计数：发起公开求助后 /metrics 反映 help_requests_total', async () => {
    const a = buildApp(new MemoryStore())
    const reg = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mblind', password: 'secret123', role: 'blind' } })).json()
    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: { authorization: `Bearer ${reg.token}` }, payload: { callId: 'm-1' } })
    const m = await a.inject({ method: 'GET', url: '/metrics' })
    expect(m.body).toContain('beeurei_help_requests_total 1')
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
})
