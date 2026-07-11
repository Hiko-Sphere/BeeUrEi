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

  it('/api/* 响应带 Cache-Control: no-store（令牌/PII 不被 bfcache 或代理缓存）', async () => {
    const a = app()
    // 携带令牌的认证响应：登录返回 token，绝不应被缓存。
    const reg = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'cacheu', password: 'secret123', role: 'helper' } })
    expect(reg.headers['cache-control']).toBe('no-store')
    // 普通 GET API 也一并 no-store（统一口径，无 /api 端点需要缓存）。
    const ver = await a.inject({ method: 'GET', url: '/api/version' })
    expect(ver.headers['cache-control']).toBe('no-store')
    await a.close()
  })

  it('静态资源(/admin)不被 no-store 波及——仍可缓存（只 gate /api/*）', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/admin/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).not.toBe('no-store') // 静态资源缓存策略不受影响
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

  it('/admin 静态资源带 Permissions-Policy：仅放行麦克风(观察者开麦)，禁用其余浏览器功能（最高权限面最小化功能面）', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/admin/' })
    expect(res.statusCode).toBe(200)
    const pp = res.headers['permissions-policy'] as string
    expect(pp).toBeTruthy()
    expect(pp).toContain('microphone=(self)') // 观察者"开麦说话" getUserMedia(audio) 需要——显式放行(不靠浏览器默认，防误破)
    expect(pp).not.toContain('microphone=()')  // 反面锁死：绝不能禁掉麦克风(否则开麦静默失效，同 geolocation 类 bug)
    expect(pp).toContain('camera=()')          // 观察者只收对端视频、自身仅发音频，不用本机摄像头
    expect(pp).toContain('geolocation=()')     // 面板不用定位
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
