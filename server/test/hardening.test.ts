import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

describe('production hardening', () => {
  it('readiness probe returns ready', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/api/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ready: true })
    await a.close()
  })

  it('unknown route returns clean 404 JSON', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
    await a.close()
  })

  it('响应带安全头（nosniff / DENY / Referrer-Policy）', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/api/version' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    await a.close()
  })

  it('/admin 静态资源带 CSP 响应头（含 frame-ancestors/object-src，强于面板内 meta）', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/admin/' }) // 目录请求 → index.html
    expect(res.statusCode).toBe(200)
    const csp = res.headers['content-security-policy'] as string
    expect(csp).toBeTruthy()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'") // 无 'unsafe-inline'：面板用外链 app.js
    expect(csp).toContain("frame-ancestors 'none'") // meta 交付时被忽略，头交付才生效（防点击劫持）
    expect(csp).toContain("object-src 'none'")
    await a.close()
  })

  it('CORS 预检对白名单源放行含 PATCH 的方法集（覆盖 API 全部方法）', async () => {
    const a = app()
    const res = await a.inject({ method: 'OPTIONS', url: '/api/version', headers: { origin: 'http://localhost:5173' } })
    expect(res.statusCode).toBe(204)
    const methods = res.headers['access-control-allow-methods'] as string
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) expect(methods).toContain(m)
    await a.close()
  })
})
