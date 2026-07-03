import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

async function register(a: ReturnType<typeof buildApp>, username = 'rina') {
  const res = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return res.json() as { token: string; refreshToken: string; user: { id: string } }
}

describe('refresh token', () => {
  it('register/login return both access + refresh tokens', async () => {
    const a = app()
    const body = await register(a)
    expect(body.token).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.refreshToken.length).toBeGreaterThanOrEqual(32)
    await a.close()
  })

  it('refresh 换发新对并轮换；重放旧 token 触发整个会话族吊销（严格模式，重放检测见 refreshReuse.test）', async () => {
    process.env.REFRESH_REUSE_GRACE_MS = '0' // 严格：不留宽限窗（默认 30s 宽限容忍丢响应重试）
    try {
      const a = app()
      const { refreshToken } = await register(a)

      const r1 = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
      expect(r1.statusCode).toBe(200)
      const b1 = r1.json()
      expect(b1.token).toBeTruthy()
      expect(b1.refreshToken).toBeTruthy()
      expect(b1.refreshToken).not.toBe(refreshToken) // 轮换

      // 正路：未发生重放时，新 refresh 正常可用（链式续期）。
      const r2 = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: b1.refreshToken } })
      expect(r2.statusCode).toBe(200)

      // 重放最初的旧 refresh：401，且**整个会话族**被吊销（被窃信号，OWASP reuse detection）——
      // 不只是旧 token 无效，连链上最新一枚也随之失效，强制该设备重新登录。
      const reused = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
      expect(reused.statusCode).toBe(401)
      const r3 = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: r2.json().refreshToken } })
      expect(r3.statusCode).toBe(401)
      await a.close()
    } finally { delete process.env.REFRESH_REUSE_GRACE_MS }
  })

  it('invalid refresh token → 401', async () => {
    const a = app()
    const res = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: 'nope' } })
    expect(res.statusCode).toBe(401)
    await a.close()
  })

  it('logout revokes the refresh token', async () => {
    const a = app()
    const { refreshToken } = await register(a)
    const out = await a.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken } })
    expect(out.statusCode).toBe(204)
    const after = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(after.statusCode).toBe(401)
    await a.close()
  })
})
